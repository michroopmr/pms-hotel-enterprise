/* ================= IMPORTS ================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const webpush = require("web-push");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

/* ================= APP ================= */
const SECRET = "mollyhelpers_secret";
const app = express();
const server = http.createServer(app);

app.use(express.json());


app.use(cors({
  origin: "*",
  credentials: false,
  methods: ["GET","POST","PUT","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

const DEPARTMENTS = [
  "Recepción",
  "Mantenimiento",
  "Operaciones",
  "Spa",
  "Housekeeping",
  "Alimentos_Bebidas",
  "Cocina",
  "Tabaqueria",
  "Gerencia General"
];
function authMiddleware(req,res,next){

 const authHeader = req.headers.authorization;

 if(!authHeader) return res.sendStatus(401);

 const token = authHeader.split(" ")[1];

 try{
   req.user = jwt.verify(token, SECRET);
   next();
 }catch{
   return res.sendStatus(403);
 }

}
app.get("/departments", authMiddleware, (req,res)=>{
  res.json(DEPARTMENTS);
});

const io = new Server(server,{
  cors:{ origin:"*" }
});

app.use(express.static(__dirname));

/* ================= DATABASE (POSTGRESQL) ================= */

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:{ rejectUnauthorized:false }
});

async function initDB(){

 await db.query(`
   CREATE TABLE IF NOT EXISTS tasks(
     id SERIAL PRIMARY KEY,
     title TEXT,
     description TEXT,
     department TEXT,
     status TEXT,
     created_by TEXT,
     created_at TIMESTAMP DEFAULT NOW(),
     due_date TIMESTAMP
   )
 `);
 await db.query(`
  ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS comments TEXT;
`);
 await db.query(`
   CREATE TABLE IF NOT EXISTS push_subscriptions(
     id SERIAL PRIMARY KEY,
     endpoint TEXT UNIQUE,
     department TEXT,
     subscription TEXT
   )
 `);
 // 👇 USERS DENTRO DE LA FUNCION
 await db.query(`
   CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  password TEXT,
  role TEXT,
  department TEXT
)
 `);
}


initDB();

/* ================= WEB PUSH ================= */

webpush.setVapidDetails(
  "mailto:admin@mollyhelpers.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/* ================= SOCKET ================= */

const onlineDepartments = {};

io.on("connection",(socket)=>{

 const token = socket.handshake.auth?.token;
 const department = socket.handshake.query?.department;

 try{

   const decoded = jwt.verify(token, SECRET);
   socket.user = decoded;

   if(department){
     socket.join(department);
     onlineDepartments[department] = true;
     console.log(`🟢 ${department} online`);
   }

   // 🔥 sistemas escucha todos los departamentos
   if(decoded.role === "sistemas"){
  DEPARTMENTS.forEach(dep=>{
    socket.join(dep);
  });
}

 }catch(e){

   console.log("⛔ Socket no autorizado");
   socket.disconnect();
   return;

 }

 socket.on("disconnect",()=>{

   if(department){
     delete onlineDepartments[department];
     console.log(`🔴 ${department} offline`);
   }

 });

});
/* ================= PUSH HELPER ================= */

async function sendPushByDepartment(department,title,message,taskId){

 if(onlineDepartments[department]){
   console.log(`⚡ ${department} online → solo socket`);
   return;
 }

 const payload = JSON.stringify({
   title,
   body:message,
   taskId
 });

 const result = await db.query(
   "SELECT subscription FROM push_subscriptions WHERE department=$1",
   [department]
 );

 for(const row of result.rows){

   const sub = JSON.parse(row.subscription);

   webpush.sendNotification(sub,payload)
   .catch(async e=>{

     console.log("Push error:",e.message);

     if(e.statusCode===410 || e.statusCode===404){
       await db.query(
         "DELETE FROM push_subscriptions WHERE endpoint=$1",
         [sub.endpoint]
       );
     }

   });

 }

}

/* ================= SUBSCRIBE ================= */

app.post("/subscribe", async (req,res)=>{

 const subscription = req.body;
 const endpoint = subscription.endpoint;
 const department = subscription.department || "general";

 await db.query(
   `INSERT INTO push_subscriptions(endpoint,department,subscription)
    VALUES($1,$2,$3)
    ON CONFLICT(endpoint) DO NOTHING`,
   [endpoint,department,JSON.stringify(subscription)]
 );

 console.log(`🔥 Subscription guardada (${department})`);

 res.sendStatus(201);

});
// ================= SETTINGS =================

let settingsMemory = [];

app.get("/settings",(req,res)=>{
 res.json(settingsMemory);
});

app.post("/settings",(req,res)=>{

 const { key, value } = req.body;

 const index = settingsMemory.findIndex(s=>s.key===key);

 if(index !== -1){
   settingsMemory[index].value = value;
 }else{
   settingsMemory.push({key,value});
 }

 res.json({ok:true});

});
/* ================= CREATE TASK ================= */
app.post("/tasks", authMiddleware, async (req,res)=>{

 const { title, description, department, due_date, user } = req.body;

 // 🔒 Validar que el departamento exista
 if(!DEPARTMENTS.includes(department)){
   return res.status(400).send("Departamento inválido");
 }

 const result = await db.query(
   `INSERT INTO tasks(title,description,department,status,created_by,due_date)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING *`,
   [title,description,department,"abierto",user,due_date]
 );

 const nuevaTarea = result.rows[0];

 io.to(department).emit("task_update", nuevaTarea);

 await sendPushByDepartment(
   department,
   "Nueva tarea",
   `${title} - ${department}`,
   nuevaTarea.id
 );

 res.json({ok:true});

});

app.put("/tasks/:id", authMiddleware, async (req,res)=>{

 try{

   const id = req.params.id;
   const { status, comments } = req.body;

   if(status !== undefined){
     await db.query(
       "UPDATE tasks SET status=$1 WHERE id=$2",
       [status,id]
     );
   }

   if(comments !== undefined){
     await db.query(
       "UPDATE tasks SET comments=$1 WHERE id=$2",
       [JSON.stringify(comments), id]
     );
   }

   const result = await db.query(
     "SELECT * FROM tasks WHERE id=$1",
     [id]
   );

  const tareaActualizada = result.rows[0];
  io.to(tareaActualizada.department)
  .emit("task_update", tareaActualizada);

   if(status !== undefined){
     await sendPushByDepartment(
       tareaActualizada.department,
       "Estado actualizado",
       `Nuevo estado: ${status}`,
       id
     );
   }

   res.json(tareaActualizada);

 }catch(err){
   console.error(err);
   res.status(500).json({error:"Error actualizando tarea"});
 }

});

/* ================= CHANGE PASSWORD ================= */

app.post("/change-password", authMiddleware, async (req,res)=>{
  if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
}

 try{

   const { username, newPassword } = req.body;

   await db.query(
     "UPDATE users SET password=$1 WHERE username=$2",
     [newPassword, username]
   );

   res.json({ok:true});

 }catch(err){

   console.log(err);
   res.status(500).send("Error cambiando password");

 }

});
app.post("/users", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const { username, password, role, department } = req.body;

await db.query(
  `INSERT INTO users(username,password,role,department)
   VALUES($1,$2,$3,$4)
   ON CONFLICT (username) DO NOTHING`,
  ["sistemas","1234","sistemas","sistemas"]
);

   res.json({ok:true});

 }catch(err){

   console.log(err);
   res.status(500).send("Error creando usuario");

 }

});
// ================= GET TASKS =================

app.get("/tasks/:department", authMiddleware, async (req,res)=>{

 try{

   const department = req.params.department;

   const result = await db.query(
     "SELECT * FROM tasks WHERE department=$1 ORDER BY id DESC",
     [department]
   );

   res.json(result.rows);

 }catch(err){

   console.log(err);
   res.status(500).send("Error obteniendo tareas");

 }

});
/* ================= GET ALL TASKS ================= */

app.get("/tasks", authMiddleware, async (req,res)=>{

 try{

   const result = await db.query(
     "SELECT * FROM tasks ORDER BY id DESC"
   );

   res.json(result.rows);

 }catch(err){

   console.log(err);
   res.status(500).send("Error obteniendo tareas");

 }

});
// ===== CREAR USUARIO SISTEMAS (TEMPORAL) =====
app.get("/create-sistemas", async (req,res)=>{

 try{

   await db.query(
     `INSERT INTO users(username,password,role)
      VALUES($1,$2,$3)
      ON CONFLICT (username) DO NOTHING`,
     ["sistemas","1234","sistemas"]
   );

   res.send("Usuario sistemas creado");

 }catch(err){

   console.log(err);
   res.status(500).send("Error creando usuario");

 }

});   
/* ================= LOGIN ================= */
app.post("/login", async (req,res)=>{

 try{

   const { username, password } = req.body;

   const result = await db.query(
     "SELECT * FROM users WHERE username=$1 AND password=$2",
     [username, password]
   );

   if(result.rows.length === 0){
     return res.sendStatus(401);
   }

   const usuario = result.rows[0];

const token = jwt.sign(
  {
    id: usuario.id,
    username: usuario.username,
    role: usuario.role
  },
  SECRET,
  { expiresIn:"8h" }
);

res.json({
  token,
  user:{
    id: usuario.id,
    username: usuario.username,
    role: usuario.role,
    department: usuario.department
  }
});

 }catch(err){

   console.log(err);
   res.sendStatus(500);

 }

});
/* ================= START ================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
 console.log("🚀 Server running on port",PORT);
});


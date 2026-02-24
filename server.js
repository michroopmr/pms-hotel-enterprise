/* ================= IMPORTS ================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const webpush = require("web-push");
const cors = require("cors");
const { Pool } = require("pg");

/* ================= APP ================= */

const app = express();
const server = http.createServer(app);

const io = new Server(server,{
  cors:{ origin:"*" }
});

app.use(express.json());

app.use(cors({
  origin:"*",
  methods:["GET","POST","PUT"],
  allowedHeaders:["Content-Type"]
}));

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
     role TEXT
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

 const department = socket.handshake.query.department;

 if(department){
   onlineDepartments[department] = true;
   console.log(`🟢 ${department} online`);
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

/* ================= CREATE TASK ================= */

app.post("/tasks", async (req,res)=>{

 const { title, description, department, due_date, user } = req.body;

 const result = await db.query(
   `INSERT INTO tasks(title,description,department,status,created_by,due_date)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING *`,
   [title,description,department,"abierto",user,due_date]
 );

 const nuevaTarea = result.rows[0];

 io.emit("task_update", nuevaTarea);

 await sendPushByDepartment(
   department,
   "Nueva tarea",
   `${title} - ${department}`,
   nuevaTarea.id
 );

 res.json({ok:true});

});

/* ================= UPDATE TASK ================= */

app.put("/tasks/:id", async (req,res)=>{

 const id = req.params.id;
 const { status } = req.body;

 await db.query(
   "UPDATE tasks SET status=$1 WHERE id=$2",
   [status,id]
 );

 io.emit("task_update",{ id:Number(id), status });

 const result = await db.query(
   "SELECT department FROM tasks WHERE id=$1",
   [id]
 );

 if(result.rows.length){

   await sendPushByDepartment(
     result.rows[0].department,
     "Estado actualizado",
     `Nuevo estado: ${status}`,
     id
   );

 }

 res.json({ok:true});

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

   res.json(result.rows[0]);

 }catch(err){

   console.log(err);
   res.sendStatus(500);

 }

});
/* ================= CHANGE PASSWORD ================= */

app.post("/change-password", async (req,res)=>{

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
// ================= GET TASKS =================

app.get("/tasks/:department", async (req,res)=>{

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
// ===== CREAR USUARIO SISTEMAS (TEMPORAL) =====

app.get("/create-sistemas", async (req,res)=>{

 try{

   await db.query(`
     CREATE TABLE IF NOT EXISTS users(
       id SERIAL PRIMARY KEY,
       username TEXT UNIQUE,
       password TEXT,
       role TEXT
     )
   `);

   await db.query(
     `INSERT INTO users(username,password,role)
      VALUES($1,$2,$3)
      ON CONFLICT (username) DO NOTHING`,
     ["sistemas","1234","sistemas"]
   );

   res.send("Usuario sistemas creado con password 1234");

 }catch(err){
   console.log(err);
   res.status(500).send("Error creando usuario");
 }

});
/* ================= START ================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
 console.log("🚀 Server running on port",PORT);
});

app.get("/settings",(req,res)=>{
  res.sendFile(__dirname + "/settings.html");
});
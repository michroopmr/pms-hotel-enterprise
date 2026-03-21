/* ================= IMPORTS ================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const webpush = require("web-push");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const path = require("path");




/* ================= APP ================= */
const SECRET = process.env.JWT_SECRET;
if(!SECRET){
 console.error("JWT_SECRET no definido");
 process.exit(1);
}
const app = express();
const server = http.createServer(app);

app.use((req,res,next)=>{

 const host = req.headers.host;

 if(
  host &&
  host.includes("onrender.com") &&
  req.method === "GET" &&
  !req.url.includes("socket.io")
 ){
   return res.redirect(301,"https://mollyhelpers.com");
 }

 next(); // 🔥 ESTO ES CLAVE

});

console.log("Cloudinary:", process.env.CLOUDINARY_CLOUD_NAME);

app.use(express.json());


const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:{ rejectUnauthorized:false }
});

// 🔥 HELPER MULTIEMPRESA
async function getCompanyId(code){

 const result = await db.query(
  "SELECT id FROM companies WHERE code=$1",
  [code]
 );

 if(result.rows.length === 0){
  throw new Error("Empresa no encontrada");
 }

 return result.rows[0].id;
}

app.post("/guest/task", async (req,res)=>{
 try{

  const {title, description, department, guest_name, room, company_code } = req.body;

  if(!company_code){
  return res.status(400).json({error:"Empresa requerida"});
}
  const company_id = await getCompanyId(company_code); // 🔥 AQUÍ

  const result = await db.query(
   `INSERT INTO tasks
    (title, description, department, status, created_by, company_id)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING *`,
   [
    title,
    description,
    department,
    "abierto",
    guest_name + " - Hab " + room,
    company_id
   ]
  );

  io.to("admin_" + company_code).emit("new_guest_task", result.rows[0]);

  res.json(result.rows[0]);

 }catch(err){
  console.error(err);
  res.status(500).json({error:"Error creando tarea"});
 }
});

// ==========================
// CHATBOT - HUÉSPEDES
// ==========================

// Registrar huésped
app.post("/guest/login", async (req,res)=>{
 try{

  const { name, room, company_code } = req.body;

  if(!name || !room || !company_code){
   return res.status(400).json({error:"Datos incompletos"});
  }

  const company_id = await getCompanyId(company_code);

  const result = await db.query(
   "INSERT INTO guests (name, room, company_id) VALUES ($1,$2,$3) RETURNING *",
   [name, room, company_id]
  );

  res.json(result.rows[0]);

 }catch(err){
  console.error("ERROR guest/login:", err);
  res.status(500).json({error:"Error creando huésped"});
 }
});

// Guardar mensaje
app.post("/chat/message", async (req,res)=>{
 try{

  const {guest_id, message, sender} = req.body;

  if(!guest_id || !message || !sender){
  return res.status(400).json({error:"Datos incompletos"});
}

if(sender !== "guest" && sender !== "staff" && sender !== "bot"){
  return res.status(400).json({error:"Sender inválido"});
}

  await db.query(
   "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,$3)",
   [guest_id, message, sender]
  );
  io.to("guest_" + guest_id).emit("new_message", {
  guest_id,
  message,
  sender
});

const guestRes = await db.query(
  "SELECT company_id FROM guests WHERE id=$1",
  [guest_id]
);

if(guestRes.rows.length === 0){
  return res.status(404).json({error:"Guest no encontrado"});
}
const company_id = guestRes.rows[0].company_id;

const companyRes = await db.query(
  "SELECT code FROM companies WHERE id=$1",
  [company_id]
);

const company_code = companyRes.rows[0].code;

io.to("admin_" + company_code).emit("new_message", {
  guest_id,
  message,
  sender
});


  res.json({ok:true});

 }catch(err){
  console.error("ERROR chat/message:", err);
  res.status(500).json({error:"Error guardando mensaje"});
 }
});

// Obtener chat
app.get("/chat/:guest_id", async (req,res)=>{
 try{

  const result = await db.query(
   "SELECT * FROM messages WHERE guest_id=$1 ORDER BY created_at",
   [req.params.guest_id]
  );

  res.json(result.rows);

 }catch(err){
  console.error("ERROR chat:", err);
  res.status(500).json({error:"Error obteniendo chat"});
 }
});

// Lista de huéspedes
app.get("/guests/:company_code", async (req,res)=>{
 try{

  const company_id = await getCompanyId(req.params.company_code);

  const result = await db.query(
   "SELECT * FROM guests WHERE active=true AND company_id=$1 ORDER BY created_at DESC",
   [company_id]
  );

  res.json(result.rows);

 }catch(err){
  console.error("ERROR guests:", err);
  res.status(500).json({error:"Error obteniendo huéspedes"});
 }
});

/* 🔥 evitar cache HTML */
app.use((req,res,next)=>{
 if(req.url.endsWith(".html")){
   res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");
   res.setHeader("Pragma","no-cache");
   res.setHeader("Expires","0");
 }
 next();
});

app.use(express.static(path.join(__dirname, "public")));

app.use(cors({
  origin: ["https://mollyhelpers.com"],
  credentials: false,
  methods: ["GET","POST","PUT","DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"]
}));

const DEPARTMENTS = [
  "Recepción",
  "Mantenimiento",
  "Operaciones",
  "Spa",
  "Housekeeping",
  "Alimentos Bebidas",
  "Cocina",
  "Tabaqueria",
  "Gerencia General"
];
function authMiddleware(req, res, next){

 const authHeader = req.headers.authorization;

 if(!authHeader){
   return res.status(401).json({ error:"Token requerido" });
 }

 const token = authHeader.split(" ")[1];

 try{
   req.user = jwt.verify(token, SECRET);
   next();
 }catch(err){
   return res.status(401).json({ error:"Token expirado o inválido" });
 }

}
app.get("/departments", authMiddleware, (req,res)=>{
  res.json(DEPARTMENTS);
});

const io = new Server(server,{
  cors:{
    origin: ["https://mollyhelpers.com"],
    methods: ["GET","POST"],
    credentials: true
  }
});


/* ================= DATABASE (POSTGRESQL) ================= */

console.log("DATABASE_URL =", process.env.DATABASE_URL);

async function initDB(){

  await db.query(`
 CREATE TABLE IF NOT EXISTS companies(
   id SERIAL PRIMARY KEY,
   name TEXT,
   code TEXT UNIQUE,
   created_at TIMESTAMP DEFAULT NOW()
 )
 `);

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
CREATE TABLE IF NOT EXISTS task_evidences(
 id SERIAL PRIMARY KEY,
 task_id INTEGER,
 image_url TEXT,
 uploaded_by TEXT,
 uploaded_at TIMESTAMP DEFAULT NOW()
)
`);
 await db.query(`
  ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS comments TEXT;
`);
await db.query(`
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS company_id INTEGER
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
 await db.query(`
ALTER TABLE users
ADD COLUMN IF NOT EXISTS company_id INTEGER
`);

await db.query(`
CREATE TABLE IF NOT EXISTS guests(
 id SERIAL PRIMARY KEY,
 name TEXT,
 room TEXT,
 active BOOLEAN DEFAULT true,
 created_at TIMESTAMP DEFAULT NOW()
)
`);

await db.query(`
ALTER TABLE guests
ADD COLUMN IF NOT EXISTS company_id INTEGER
`);
}


initDB();

/* ================= WEB PUSH ================= */

if (
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    "mailto:admin@mollyhelpers.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log("✅ VAPID configurado");
} else {
  console.log("⚠ VAPID no configurado, push notifications desactivadas");
}

/* ================= SOCKET ================= */

const onlineDepartments = {};

io.on("connection",(socket)=>{

  socket.on("join_admin", (company_code)=>{
  socket.join("admin_" + company_code);
});

  socket.on("join_guest", (guest_id)=>{
  socket.join("guest_" + guest_id);
});
socket.on("call_staff", (data) => {

  console.log("🔔 Solicitud de staff:", data);

  io.to("admin_" + data.company_code).emit("staff_alert", {
    guest_id: data.guest_id,
    message: data.message,
    company_code: data.company_code
  });

});

const token = socket.handshake.auth?.token;
const department = socket.handshake.query?.department;

if(!token){
  console.log("👤 Guest conectado");
  return;
}

let decoded;

try{
  decoded = jwt.verify(token, SECRET);
  socket.user = decoded;
}catch(e){
  console.log("⛔ Socket no autorizado");
  socket.disconnect();
  return;
}

// 🔥 unir a departamento
if(department){
  socket.join(department);
  onlineDepartments[department] = true;
  console.log(`🟢 ${department} online`);
}

// 🔥 sistemas escucha todo
if(decoded.role === "sistemas"){
  DEPARTMENTS.forEach(dep=>{
    socket.join(dep);
  });
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

 let sub;

 try{
   sub = JSON.parse(row.subscription);
 }catch(e){
   console.log("⚠ Suscripción inválida (JSON corrupto)");
   continue;
 }

 // 🔒 validar endpoint
 if(!sub || !sub.endpoint){
   console.log("⚠ Suscripción sin endpoint, ignorada");
   continue;
 }

 webpush.sendNotification(sub,payload)
 .catch(async e=>{

   console.log("Push error:",e.message);

   if(e.statusCode === 410 || e.statusCode === 404){

     await db.query(
       "DELETE FROM push_subscriptions WHERE endpoint=$1",
       [sub.endpoint]
     );

     console.log("🧹 Suscripción eliminada");

   }

 });

}
} 


/* ================= SUBSCRIBE ================= */

app.post("/subscribe", authMiddleware, async (req,res)=>{

 try{

   const { subscription, department, username, device } = req.body;

   if(!subscription?.endpoint){
     return res.status(400).json({error:"Invalid subscription"});
   }

   await db.query(`
 INSERT INTO push_subscriptions
 (endpoint, subscription, department)
 VALUES ($1,$2,$3)
 ON CONFLICT (endpoint)
 DO UPDATE SET
   department = EXCLUDED.department
`,
[
 subscription.endpoint,
 JSON.stringify(subscription),
 department
]);

   res.json({ok:true});

 }catch(err){

   console.error("Subscribe error:",err);
   res.status(500).json({error:"subscribe failed"});

 }

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
  `INSERT INTO tasks
  (title,description,department,status,created_by,due_date,company_id)
  VALUES($1,$2,$3,$4,$5,$6,$7)
  RETURNING *`,
  [
    title,
    description,
    department,
    "abierto",
    user,
    due_date,
    req.user.company_id
  ]
);

 const nuevaTarea = result.rows[0];
 // 🔥 obtener empresa
const companyRes = await db.query(
  "SELECT code FROM companies WHERE id=$1",
  [req.user.company_id]
);

const company_code = companyRes.rows[0].code;

// 🔥 emitir SOLO a esa empresa
app.post("/guest/task", async (req,res)=>{

 const nuevaTarea = await crearTarea(req.body);

 io.to("admin_" + req.body.company_code).emit("task_update", nuevaTarea);

 res.json(nuevaTarea);
});



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

  let updateQuery = "UPDATE tasks SET status=$1";
  let values = [status];
  let index = 2;

  // 🔥 Si pasa a proceso → guardar hora inicio
  if(status === "proceso"){
    updateQuery += ", started_at=NOW()";
  }

  // 🔥 Si se cierra → guardar hora cierre
  if(status === "terminado"){
    updateQuery += ", closed_at=NOW()";
  }

  updateQuery += ` WHERE id=$${index} AND company_id=$${index+1}`;
values.push(id, req.user.company_id);

  await db.query(updateQuery, values);
}   

   if(comments !== undefined){
     await db.query(
       "UPDATE tasks SET comments=$1 WHERE id=$2",
       [JSON.stringify(comments), id]
     );
   }

   const result = await db.query(
 "SELECT * FROM tasks WHERE id=$1 AND company_id=$2",
 [id, req.user.company_id]
);

  const tareaActualizada = result.rows[0];

  const evidences = await db.query(
  "SELECT * FROM task_evidences WHERE task_id=$1 ORDER BY uploaded_at DESC",
  [id]
);

tareaActualizada.evidences = evidences.rows;

const companyRes = await db.query(
  "SELECT code FROM companies WHERE id=$1",
  [req.user.company_id]
);

const company_code = companyRes.rows[0].code;

io.to("admin_" + company_code)
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
 `INSERT INTO users(username,password,role,department,company_id)
  VALUES($1,$2,$3,$4,$5)
  ON CONFLICT (username) DO NOTHING`,
 [username, password, role, department, req.user.company_id]
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

   const rolesFullAccess = ["sistemas","admin","recepcion"];

   // roles que pueden consultar cualquier departamento
   if(rolesFullAccess.includes(req.user.role)){

     const result = await db.query(
 "SELECT * FROM tasks WHERE department=$1 AND company_id=$2 ORDER BY id DESC",
 [department, req.user.company_id]
);

     return res.json(result.rows);

   }

   // seguridad: evitar que otro departamento consulte
   if(req.user.department !== department){
     return res.status(403).send("No autorizado");
   }

   const result = await db.query(
 "SELECT * FROM tasks WHERE department=$1 AND company_id=$2 ORDER BY id DESC",
 [department, req.user.company_id]
);

   res.json(result.rows);

 }catch(err){

   console.log(err);
   res.status(500).send("Error obteniendo tareas");

 }

});

app.get("/tasks/:id/evidences", authMiddleware, async (req,res)=>{

  try{

    const result = await db.query(
`
SELECT e.*
FROM task_evidences e
JOIN tasks t ON e.task_id = t.id
WHERE e.task_id=$1
AND t.company_id=$2
ORDER BY uploaded_at DESC
`,
[req.params.id, req.user.company_id]
);

    res.json(result.rows);

  }catch(err){

    console.error(err);
    res.status(500).json({error:"Error obteniendo evidencias"});

  }

});
/* ================= GET ALL TASKS ================= */

app.get("/tasks", authMiddleware, async (req,res)=>{

 try{

   const rolesFullAccess = ["sistemas","admin","recepcion"];

   if(rolesFullAccess.includes(req.user.role)){

   const result = await db.query(`
SELECT
 t.*,
 COALESCE(
   json_agg(e.*) FILTER (WHERE e.id IS NOT NULL),
   '[]'
 ) AS evidences
FROM tasks t
LEFT JOIN task_evidences e
 ON e.task_id = t.id
WHERE t.company_id = $1
GROUP BY t.id
ORDER BY t.id DESC
`,
[req.user.company_id]
);

     return res.json(result.rows);

   }
const result = await db.query(`
SELECT
 t.*,
 COALESCE(
   json_agg(e.*) FILTER (WHERE e.id IS NOT NULL),
   '[]'
 ) AS evidences
FROM tasks t
LEFT JOIN task_evidences e
 ON e.task_id = t.id
WHERE t.department = $1
AND t.company_id = $2
GROUP BY t.id
ORDER BY t.id DESC
`,
[req.user.department, req.user.company_id]
);
   

   res.json(result.rows);

 }catch(err){

   console.log(err);
   res.status(500).send("Error obteniendo tareas");

 }

});

// ===== KPIs DASHBOARD =====
app.get("/kpis", authMiddleware, async (req,res)=>{

 try{

   const result = await db.query(`
    SELECT
    COUNT(*) FILTER (WHERE status='abierto') AS abiertas,
    COUNT(*) FILTER (WHERE status='proceso') AS proceso,
    COUNT(*) FILTER (
    WHERE status!='terminado'
    AND due_date IS NOT NULL
    AND due_date < NOW()
    ) AS vencidas,
    COUNT(*) FILTER (WHERE status='terminado') AS cerradas
    FROM tasks
    WHERE company_id = $1
    `,
    [req.user.company_id]);

   res.json(result.rows[0]);

 }catch(err){

   console.error("Error KPIs:",err);
   res.status(500).json({error:"Error obteniendo KPIs"});

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
/* ================= GET COMPANIES ================= */

app.get("/admin/companies", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const result = await db.query(
     "SELECT * FROM companies ORDER BY id DESC"
   );

   res.json(result.rows);

 }catch(err){

   console.log(err);
   res.status(500).send("Error obteniendo empresas");

 }

});

/* ================= CREATE COMPANY ================= */

app.post("/admin/companies", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const { name, code } = req.body;

   const result = await db.query(
   `
   INSERT INTO companies(name,code)
   VALUES($1,$2)
   RETURNING *
   `,
   [name,code]
   );

   res.json(result.rows[0]);

 }catch(err){

   console.log(err);
   res.status(500).send("Error creando empresa");

 }

});
/* ================= CREATE COMPANY ADMIN ================= */

app.post("/admin/company-admin", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const { username, password, company_id } = req.body;

   await db.query(
   `
   INSERT INTO users(username,password,role,company_id)
   VALUES($1,$2,'admin',$3)
   `,
   [username,password,company_id]
   );

   res.json({ok:true});

 }catch(err){

   console.log(err);
   res.status(500).send("Error creando admin");

 }

});
app.get("/users", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const result = await db.query(
     "SELECT id, username, role, department FROM users ORDER BY id DESC"
   );

   res.json(result.rows);

 }catch(err){
   console.log(err);
   res.status(500).send("Error obteniendo usuarios");
 }

});

app.delete("/users/:id", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const id = req.params.id;

   // 🔒 Evitar que se elimine a sí mismo
   if(Number(id) === req.user.id){
     return res.status(400).send("No puedes eliminarte a ti mismo");
   }

   await db.query(
     "DELETE FROM users WHERE id=$1",
     [id]
   );

   res.json({ok:true});

 }catch(err){
   console.log(err);
   res.status(500).send("Error eliminando usuario");

 }

});

/* ================= LOGIN ================= */
app.post("/login", async (req,res)=>{

 try{

   const { company_code, username, password } = req.body;

const result = await db.query(
`
SELECT u.*, c.code
FROM users u
JOIN companies c ON u.company_id = c.id
WHERE u.username=$1
AND u.password=$2
AND c.code=$3
`,
[username, password, company_code]
);

   if(result.rows.length === 0){
     return res.sendStatus(401);
   }

   const usuario = result.rows[0];

const token = jwt.sign(
{
  id: usuario.id,
  username: usuario.username,
  role: usuario.role,
  department: usuario.department,
  company_id: usuario.company_id
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
console.log("Starting server...");
server.listen(PORT,()=>{
 console.log("🚀 Server running on port",PORT);
});

const multer = require("multer");
const cloudinary = require("./config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }
});

app.post("/tasks/:id/evidence", authMiddleware, upload.single("image"), async (req,res)=>{
  try{

    const taskCheck = await db.query(
 "SELECT * FROM tasks WHERE id=$1 AND company_id=$2",
 [req.params.id, req.user.company_id]
);

if(taskCheck.rows.length === 0){
 return res.status(403).json({error:"No autorizado"});
}

    if(!req.file){
      return res.status(400).json({error:"No image provided"});
    }

    const result = await new Promise((resolve,reject)=>{
      cloudinary.uploader.upload_stream(
        {
          folder:"molly-evidences",
          resource_type:"image",
          transformation:[{ width:1200, quality:"auto" }]
        },
        (error,result)=>{
          if(error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    await db.query(
      `INSERT INTO task_evidences(task_id,image_url,uploaded_by)
       VALUES($1,$2,$3)`,
      [req.params.id, result.secure_url, req.user.username]
    );

    res.json({ ok:true, url: result.secure_url });

  }catch(err){
    console.error(err);
    res.status(500).json({error:"Error subiendo evidencia"});
  }
});
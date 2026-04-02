/* ================= IMPORTS ================= */

const express = require("express");
const app = express();

const http = require("http");
const { Server } = require("socket.io");

const webpush = require("web-push");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const path = require("path");
const { processMessage } = require("./chatbot");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const pino = require("pino");

const logger = pino();

// 🔥 SERVER + SOCKET

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://mollyhelpers.com"]
  }
});

// 🔥 DISPONIBLE EN TODAS LAS RUTAS
app.set("io", io);


/* ================= APP ================= */
const SECRET = process.env.JWT_SECRET;
if(!SECRET){
 console.error("JWT_SECRET no definido");
 process.exit(1);
}

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

app.use("/chat", rateLimit({
 windowMs: 60 * 1000,
 max: 40
}));

app.use("/guest", rateLimit({
 windowMs: 60 * 1000,
 max: 20
}));


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

  const io = req.app.get("io");

io.to("admin_" + company_code).emit("task_update", result.rows[0]);

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
app.post("/chat/message", async (req, res) => {
 try{

  const io = req.app.get("io");

  const { guest_id, message, sender, company_code } = req.body;

  if(!guest_id || !company_code){
 return res.status(400).json({error:"Datos incompletos"});
}

const company_id = await getCompanyId(company_code);

const guestCheck = await db.query(
 "SELECT * FROM guests WHERE id=$1 AND company_id=$2",
 [guest_id, company_id]
);

if(guestCheck.rows.length === 0){
 return res.status(403).json({error:"Acceso inválido"});
}
   await db.query(
 "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,$3)",
 [guest_id, message, sender]
);

io.to("admin_" + company_code).emit("new_message", {
  guest_id,
  message,
  sender
});

// 🔥 SOLO SI ES MENSAJE DEL HUÉSPED
if(sender === "guest"){
  console.log("Mensaje:", message);


  // obtener guest con company_id
  const guestRes = await db.query(
    "SELECT * FROM guests WHERE id=$1",
    [guest_id]
  );

  const guestData = guestRes.rows[0];

 // ================= IA =================
const ai = await detectarIntencion(message, company_id);

// 🔥 RESPONDER PRIMERO
if(ai.texto){

 await db.query(
  "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,'bot')",
  [guest_id, ai.texto]
 );

 io.to("guest_" + guest_id).emit("new_message",{
  guest_id,
  message: ai.texto,
  sender: "bot"
 });

 io.to("admin_" + company_code).emit("new_message",{
  guest_id,
  message: ai.texto,
  sender: "bot"
 });

 // 🔥 SI ES SOLO INFO → TERMINAR AQUÍ
 if(ai.ticket === false){
   return res.json({ ok:true, ia:true });
 }

 // 🔥 SOLO AQUÍ CREAS TASK
 if(ai.ticket){

   await crearTicket({
     guest_id,
     room: guestData.room,
     tipo:"servicio",
     prioridad: ai.prioridad || "normal"
   });

   const task = await db.query(`
     INSERT INTO tasks
     (title, description, department, status, created_by, company_id)
     VALUES($1,$2,$3,$4,$5,$6)
     RETURNING *
   `,
   [
     "Solicitud habitación " + guestData.room,
     message,
     ai.departamento || "Recepción",
     "abierto",
     guestData.name + " - Hab " + guestData.room,
     guestData.company_id
   ]);

   io.to("admin_" + company_code).emit("task_update", task.rows[0]);

   io.to("admin_" + company_code).emit("nuevo_ticket",{
     guest_id,
     room: guestData.room
   });

   return res.json({ ok:true, ia:true });
 }

}

io.to("guest_" + guest_id).emit("typing");

// 🔥 evitar doble procesamiento si IA ya respondió
if(ai.texto){
  return res.json({ ok:true });
}

  const result = await processMessage(db, message, guestData);
  console.log("Resultado:", result);

  // 🔥 RESPUESTA BOT
  await db.query(
    "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,'bot')",
    [guest_id, result.reply]
  );

  io.to("guest_" + guest_id).emit("new_message", {
    guest_id,
    message: result.reply,
    sender: "bot"
  });
io.to("admin_" + company_code).emit("new_message", {
  guest_id,
  message: result.reply,
  sender: "bot"
});
  // 🔥 CREAR TAREA SI ES FALLA
  if(result.type === "falla" || result.type === "servicio"){

    const task = await db.query(`
      INSERT INTO tasks
      (title, description, department, status, created_by, company_id)
      VALUES($1,$2,$3,$4,$5,$6)
      RETURNING *
    `,
    [
      "Reporte habitación " + guestData.room,
      message,
      result.department,
      "abierto",
      guestData.name,
      guestData.company_id
    ]);

    io.to("admin_" + company_code).emit("task_update", task.rows[0]);
  }
}

res.json({
  ok: true,
  message
});
} catch(err){
  console.error(err);
  res.status(500).json({error:"Error en chat"});
}
});

// Obtener chat
app.get("/chat/:guest_id", async (req,res)=>{
 try{

  const { company_code } = req.query;

  if(!company_code){
    return res.status(400).json({error:"company_code requerido"});
  }

  const company_id = await getCompanyId(company_code);

  const guestCheck = await db.query(
    "SELECT * FROM guests WHERE id=$1 AND company_id=$2",
    [req.params.guest_id, company_id]
  );

  if(guestCheck.rows.length === 0){
    return res.status(403).json({error:"Acceso inválido"});
  }

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
app.get("/tickets/:company_code", async (req,res)=>{

 const r = await db.query(`
  SELECT * FROM tickets
  ORDER BY created_at DESC
 `);

 res.json(r.rows);

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
 console.error("ERROR chat:", err);
 res.status(500).json({error:"Error obteniendo chat"});
}
});

 
app.get("/admin/services", authMiddleware, async (req,res)=>{

  if(!["admin","recepcion"].includes(req.user.role)){
  return res.status(403).json({ error: "Sin permisos" });
}
  const result = await db.query(
    "SELECT * FROM service_catalog WHERE company_id=$1",
    [req.user.company_id]
  );
  res.json(result.rows);
});
app.get("/services/:company_code", async (req,res)=>{
 try{
  const company_id = await getCompanyId(req.params.company_code);

  const result = await db.query(
    "SELECT name, auto_response as description FROM service_catalog WHERE company_id=$1",
    [company_id]
  );

  res.json(result.rows);

 }catch(err){
  console.error(err);
  res.status(500).json({error:"services error"});
 }
});
app.get("/quick-replies/:company_code", async (req,res)=>{
 try{
  const company_id = await getCompanyId(req.params.company_code);

  const result = await db.query(
    "SELECT trigger as title, response as text FROM bot_flows WHERE company_id=$1",
    [company_id]
  );

  res.json(result.rows);

 }catch(err){
  console.error(err);
  res.status(500).json({error:"quick replies error"});
 }
});

app.post("/admin/services", authMiddleware, async (req,res)=>{
  const { name, keywords, department, type, auto_response } = req.body;

  await db.query(`
    INSERT INTO service_catalog(name,keywords,department,type,auto_response,company_id)
    VALUES($1,$2,$3,$4,$5,$6)
  `,[name, keywords, department, type, auto_response, req.user.company_id]);

  res.json({ok:true});
});

app.delete("/admin/services/:id", authMiddleware, async (req,res)=>{
  await db.query(
    "DELETE FROM service_catalog WHERE id=$1 AND company_id=$2",
    [req.params.id, req.user.company_id]
  );
  res.json({ok:true});
});
app.get("/admin/flows", authMiddleware, async (req,res)=>{

  if(!["admin","recepcion"].includes(req.user.role)){
  return res.status(403).json({ error: "Sin permisos" });
}
  const result = await db.query(
    "SELECT * FROM bot_flows WHERE company_id=$1",
    [req.user.company_id]
  );
  res.json(result.rows);
});

app.post("/admin/flows", authMiddleware, async (req,res)=>{
  const { trigger, response } = req.body;

  await db.query(`
    INSERT INTO bot_flows(trigger,response,company_id)
    VALUES($1,$2,$3)
  `,[trigger,response,req.user.company_id]);

  res.json({ok:true});
});

app.delete("/admin/flows/:id", authMiddleware, async (req,res)=>{
 await db.query(
  "DELETE FROM bot_flows WHERE id=$1 AND company_id=$2",
  [req.params.id, req.user.company_id]
 );
 res.json({ok:true});
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
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS comments TEXT;
  `);

  await db.query(`
  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id INTEGER
  `);

  await db.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions(
    id SERIAL PRIMARY KEY,
    endpoint TEXT UNIQUE,
    department TEXT,
    subscription TEXT
  )
  `);

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
  ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id INTEGER
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
  ALTER TABLE guests ADD COLUMN IF NOT EXISTS company_id INTEGER
  `);

  // 🔥 ✅ AQUÍ VA messages
  await db.query(`
  CREATE TABLE IF NOT EXISTS messages(
    id SERIAL PRIMARY KEY,
    guest_id INTEGER,
    message TEXT,
    sender TEXT,
    created_at TIMESTAMP DEFAULT NOW()
  )
  `);

await db.query(`
CREATE TABLE IF NOT EXISTS service_catalog (
  id SERIAL PRIMARY KEY,
  name TEXT,
  keywords TEXT[],
  department TEXT,
  type TEXT,
  auto_response TEXT,
  company_id INTEGER
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS bot_flows (
  id SERIAL PRIMARY KEY,
  trigger TEXT,
  response TEXT,
  company_id INTEGER
)
  `);
  await db.query(`
CREATE TABLE IF NOT EXISTS settings(
 key TEXT,
 value TEXT,
 company_id INTEGER
)
`);
await db.query(`
CREATE TABLE IF NOT EXISTS tickets(
 id SERIAL PRIMARY KEY,
 guest_id INT,
 room TEXT,
 type TEXT,
 status TEXT DEFAULT 'pendiente',
 priority TEXT DEFAULT 'normal',
 created_at TIMESTAMP DEFAULT NOW()
)
`);

await db.query(`CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id)`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_messages_guest ON messages(guest_id)`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_guests_company ON guests(company_id)`);
  }

initDB();

// 🔥 MIGRACIÓN DE PASSWORDS (TEMPORAL)
(async ()=>{

 try{

   const users = await db.query("SELECT * FROM users");

   for(const u of users.rows){

     if(!u.password.startsWith("$2b$")){

       const hash = await bcrypt.hash(u.password, 10);

       await db.query(
         "UPDATE users SET password=$1 WHERE id=$2",
         [hash, u.id]
       );

       console.log("✔ Usuario actualizado:", u.username);
     }

   }

   console.log("🔥 Migración de passwords completada");

 }catch(err){
   console.error("❌ Error migrando passwords:", err);
 }

})();

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
socket.on("admin_send_message", async (data)=>{

 const { guest_id, message, company_code } = data;

 // guardar mensaje
 await db.query(
  "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,'admin')",
  [guest_id, message]
 );

 // enviar al huésped
 io.to("guest_" + guest_id).emit("new_message",{
  guest_id,
  message,
  sender:"bot"
 });

 // actualizar admin (otros paneles)
 io.to("admin_" + company_code).emit("new_message",{
  guest_id,
  message,
  sender:"bot"
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

async function detectarIntencion(msg, company_id){

 msg = msg.toLowerCase();

 // 🔥 buscar en servicios
 const services = await db.query(
  "SELECT * FROM service_catalog WHERE company_id=$1",
  [company_id]
 );

 for(const s of services.rows){
   if(s.keywords.some(k => msg.includes(k.trim().toLowerCase()))){

  // 🔥 SI ES SOLO INFO → NO TASK
  if(s.type === "info"){
    return {
      texto: s.auto_response,
      ticket: false
    };
  }

  // 🔥 SI ES SERVICIO → TASK
  return {
    texto: s.auto_response,
    ticket: true,
    departamento: s.department,
    prioridad: "normal"
  };
}
 }

 // 🔥 quick replies
 const flows = await db.query(
  "SELECT * FROM bot_flows WHERE company_id=$1",
  [company_id]
 );

 for(const f of flows.rows){
   if(msg.includes(f.trigger.toLowerCase())){
   return { texto: f.response, ticket:false };
   }
 }

 return { texto:null, ticket:false };
}

async function crearTicket({guest_id, room, tipo, prioridad="normal"}){
 await db.query(`
  INSERT INTO tickets (guest_id, room, type, priority)
  VALUES ($1,$2,$3,$4)
 `,[guest_id, room, tipo, prioridad]);
}

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

app.get("/settings", authMiddleware, async (req,res)=>{
 const result = await db.query(
  "SELECT key,value FROM settings WHERE company_id=$1",
  [req.user.company_id]
 );
 res.json(result.rows);
});


app.post("/settings", authMiddleware, async (req,res)=>{

 const { key, value } = req.body;

 await db.query(`
 INSERT INTO settings(key,value,company_id)
 VALUES($1,$2,$3)
 ON CONFLICT (key,company_id)
 DO UPDATE SET value=EXCLUDED.value
 `,
 [key,value,req.user.company_id]);

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


  // 🔥 ESTA LÍNEA ES LA CLAVE
  io.to("admin_" + company_code).emit("task_update", nuevaTarea);

  await sendPushByDepartment(
  department,
  "Nueva tarea",
  `${title} - ${department}`,
  nuevaTarea.id
);

  res.json(nuevaTarea);
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

   if(!username || !newPassword){
     return res.status(400).json({error:"Datos incompletos"});
   }

   const hashed = await bcrypt.hash(newPassword, 10);

   await db.query(
     "UPDATE users SET password=$1 WHERE username=$2",
     [hashed, username]
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

   if(!username || !password){
     return res.status(400).json({error:"Datos incompletos"});
   }

   const hashedPassword = await bcrypt.hash(password, 10);

   await db.query(
     `INSERT INTO users (username,password,role,department,company_id)
      VALUES($1,$2,$3,$4,$5)`,
     [username, hashedPassword, role, department, req.user.company_id]
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

   const [username, hashedPassword, company_id] = req.body;

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
   AND c.code=$2
   `,
   [username, company_code]
   );

   if(result.rows.length === 0){
     return res.sendStatus(401);
   }

   const usuario = result.rows[0];

   // 🔐 VALIDACIÓN SEGURA
   const valid = await bcrypt.compare(password, usuario.password);

   if(!valid){
     return res.sendStatus(401);
   }

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
  },
  company_code: usuario.code   // 🔥 ESTA ES LA CLAVE
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

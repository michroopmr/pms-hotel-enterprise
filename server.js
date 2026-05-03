/* ================= IMPORTS ================= */

const express = require("express");
const cors = require("cors");

const app = express();


// 🔥 1. CORS (PEGAR AQUÍ)
app.use((req, res, next) => {

  const origin = req.headers.origin;

  const allowedOrigins = [
  "https://mollyhelpers.com",
  "https://www.mollyhelpers.com",
  "https://pms-hotel-enterprise.onrender.com"
];

  // 🔥 SOLO permitir si coincide
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});


// 🔥 2. LOG (INMEDIATAMENTE DESPUÉS)
app.use((req,res,next)=>{
  console.log("🌐 REQUEST:", req.method, req.path);
  next();
});


// 🔥 3. BODY PARSER (DESPUÉS)
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.set('trust proxy', true);


const http = require("http");
const { Server } = require("socket.io");

const webpush = require("web-push");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const path = require("path");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const pino = require("pino");
const multer = require("multer");
const cloudinary = require("./config/cloudinary");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 }
});

const logger = pino();

// 🔥 PROTECCIÓN GLOBAL DE ERRORES
process.on("uncaughtException", err => {
  console.error("💥 UNCAUGHT ERROR REAL:");
  console.error(err);
});

process.on("unhandledRejection", err => {
  console.error("💥 PROMISE ERROR DETALLE:");
  console.error(err);
});

// 🔥 SERVER + SOCKET

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://mollyhelpers.com"]
  }
});
// 🔥 VALIDACIÓN DE SOCKET (AQUÍ VA)
io.use((socket, next) => {

  const token = socket.handshake.auth?.token;

  if(!token){
    return next(new Error("No autorizado"));
  }

  try{
    const decoded = jwt.verify(token, SECRET);
    socket.user = decoded;
    next();
  }catch(err){
    return next(new Error("Token inválido"));
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
  const url = req.originalUrl; // 🔥 usar originalUrl

  const esHTML =
    url === "/" ||
    url.endsWith(".html");

 const pathname = req.path;

const esAPI =
  pathname.startsWith("/task-templates") ||
  pathname.startsWith("/tasks") ||
  pathname.startsWith("/login") ||
  pathname.startsWith("/chat") ||
  pathname.startsWith("/guest") ||
  pathname.startsWith("/socket.io");

// 🔥 SOLO REDIRIGIR HTML REAL
if(
  host &&
  host.includes("onrender.com") &&
  req.method === "GET" &&
  !req.path.startsWith("/api") &&
  !req.path.startsWith("/task-templates") &&
  !req.path.startsWith("/tasks") &&
  !req.path.startsWith("/departments") && // 👈 AGREGAR
  !req.path.startsWith("/login") &&
  !req.path.startsWith("/chat") &&
  !req.path.startsWith("/guest") &&
  !req.path.startsWith("/socket.io") &&
  (req.path === "/" || req.path.endsWith(".html"))
){
}

  next();
});

console.log("Cloudinary:", process.env.CLOUDINARY_CLOUD_NAME);


app.use("/chat", rateLimit({
 windowMs: 60 * 1000,
 max: 200
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
// ================= ONBOARDING DEMO =================

const DEMO_CODE = "DEMO01";

async function getDemoCompanyId(){
  const r = await db.query(
    "SELECT id FROM companies WHERE code=$1",
    [DEMO_CODE]
  );

  if(r.rows.length === 0){
    throw new Error("DEMO01 no existe");
  }

  return r.rows[0].id;
}

async function cloneTable(table, newCompanyId){

  const demoId = await getDemoCompanyId();
  if(!demoId) return;

  const result = await db.query(
    `SELECT * FROM ${table} WHERE company_id=$1`,
    [demoId]
  );

  for(const row of result.rows){

    try{

      delete row.id;
      row.company_id = newCompanyId;

      const fields = Object.keys(row);
      const values = Object.values(row);

      const placeholders = fields.map((_,i)=>`$${i+1}`).join(",");

      await db.query(
        `INSERT INTO ${table}(${fields.join(",")})
         VALUES(${placeholders})`,
        values
      );

    }catch(err){
      console.error(`❌ Error insert en ${table}:`, err.message);
    }

  }
}

async function cloneMasterUser(newCompanyId){

  const demoId = await getDemoCompanyId();

  const r = await db.query(
    `SELECT * FROM users 
     WHERE username='mromero'
     AND company_id=$1`,
    [demoId]
  );

  if(r.rows.length === 0){
    console.log("⚠ mromero no existe en DEMO");
    return;
  }

  const user = r.rows[0];

  await db.query(`
    INSERT INTO users(username,password,role,department,company_id)
    VALUES($1,$2,$3,$4,$5)
  `,
  [
    user.username,
    user.password,
    user.role,
    user.department,
    newCompanyId
  ]);

  console.log("✅ mromero clonado correctamente");
}

async function cloneDemoData(newCompanyId){

  console.log("🚀 Iniciando onboarding para empresa:", newCompanyId);

  try{
    console.log("👉 Clonando service_catalog");
    await cloneTable("service_catalog", newCompanyId);
  }catch(e){
    console.error("❌ service_catalog:", e);
  }

  try{
    console.log("👉 Clonando bot_flows");
    await cloneTable("bot_flows", newCompanyId);
  }catch(e){
    console.error("❌ bot_flows:", e);
  }

  try{
    console.log("👉 Clonando settings");
    await cloneTable("settings", newCompanyId);
  }catch(e){
    console.error("❌ settings:", e);
  }

  try{
    console.log("👉 Clonando usuario mromero");
    await cloneMasterUser(newCompanyId);
  }catch(e){
    console.error("❌ user:", e);
  }

  console.log("✅ Onboarding terminado");
}
app.post("/save-subscription", authMiddleware, async (req,res)=>{
  try{

    const { subscription } = req.body;

    if(!subscription || !subscription.endpoint){
      return res.status(400).json({error:"Subscription inválida"});
    }

    if(!req.user?.id){
      return res.status(400).json({error:"Usuario inválido"});
    }

    await db.query(`
      INSERT INTO push_subscriptions
      (endpoint, subscription, department, company_id, user_id)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (endpoint)
      DO UPDATE SET
        subscription = EXCLUDED.subscription,
        department = EXCLUDED.department,
        company_id = EXCLUDED.company_id,
        user_id = EXCLUDED.user_id
    `,
    [
      subscription.endpoint,
      JSON.stringify(subscription),
      req.user.department,
      req.user.company_id,
      req.user.id
    ]);

    console.log("✅ Push guardado:", {
      endpoint: subscription.endpoint,
      user: req.user.id,
      dept: req.user.department
    });

    res.json({ ok:true });

  }catch(err){
    console.error(err);
    res.status(500).json({error:"Error guardando push"});
  }
});

app.post("/guest/task", async (req,res)=>{
 try{

  const {title, description, department, guest_name, room, company_code } = req.body;

  // 🔥 VALIDACIÓN
  if(!title || !description || !department || !guest_name || !room || !company_code){
    return res.status(400).json({error:"Datos incompletos"});
  }

  const company_id = await getCompanyId(company_code);

  // 🔥 SLA
  const minutos = 15; // 🔥 SLA BASE GLOBAL

  const dueDate = new Date();
  dueDate.setMinutes(dueDate.getMinutes() + minutos);

  console.log("📅 SLA MIN:", minutos);
  console.log("📅 DUE DATE:", dueDate);

  const result = await db.query(
    `INSERT INTO tasks
     (title, description, department, status, created_by, company_id, due_date)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      title,
      description,
      department,
      "abierto",
      guest_name + " - Hab " + room,
      company_id,
      dueDate
    ]
  );

  const io = req.app.get("io");

  if(!io){
    console.error("❌ IO NO DEFINIDO");
  }

  io.to("admin_" + company_code).emit("task_update", result.rows[0]);

  await sendPushByDepartment(
  department,
  "Nueva tarea",
  title,
  result.rows[0].id,
  company_id
);

  res.json(result.rows[0]);

 }catch(err){
  console.error("❌ ERROR CREANDO TASK:", err);
  res.status(500).json({error:"Error creando tarea"});
 }
});
// ==========================
// EVIDENCIAS
// ==========================

app.post("/assign", authMiddleware, async (req,res)=>{
 try{

  const { guest_id, staff } = req.body;

  await db.query(
    "UPDATE guests SET assigned_to=$1 WHERE id=$2",
    [staff, guest_id]
  );

  res.json({ ok:true });

 }catch(err){
  console.error("ERROR assign:", err);
  res.status(500).json({error:"Error asignando staff"});
 }
});
// ==========================
// CHATBOT - HUÉSPEDES
// ==========================

// Registrar huésped
app.post("/guest/login", async (req,res)=>{
 try{

  const { name, room, company_code, lang } = req.body;

  if(!name || !room || !company_code){
   return res.status(400).json({error:"Datos incompletos"});
  }

  const company_id = await getCompanyId(company_code);

  const result = await db.query(
   "INSERT INTO guests (name, room, company_id, lang) VALUES ($1,$2,$3,$4) RETURNING *",
   [name, room, company_id, lang || "es"]
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

  console.log("📩 REQUEST:", {
    guest_id,
    message,
    sender,
    company_code
  });
  if(!message){
  console.error("❌ MENSAJE VACÍO DETECTADO");
}

  // 🔥 VALIDACIÓN
  if(!guest_id || !company_code || !sender || !message?.trim()){
    return res.status(400).json({error:"Datos incompletos"});
  }

  // 🔥 EMPRESA (PROTEGIDO)
let company_id;

try{
  company_id = await getCompanyId(company_code);
}catch(err){
  console.error("❌ ERROR EMPRESA:", err.message);
  return res.status(400).json({error:"Empresa inválida"});
}

  // 🔥 VALIDAR GUEST
  const guestCheck = await db.query(
    "SELECT * FROM guests WHERE id=$1 AND company_id=$2",
    [guest_id, company_id]
  );

  if(guestCheck.rows.length === 0){
    return res.status(403).json({error:"Acceso inválido"});
  }

  const guestData = guestCheck.rows[0];
  const guestLang = guestData.lang || "es";

  // 🔥 GUARDAR MENSAJE (PROTEGIDO)
try{
  await db.query(
    "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,$3)",
    [guest_id, message, sender]
  );
}catch(err){
  console.error("❌ ERROR INSERT MESSAGE:", err);
  return res.status(500).json({error:"Error guardando mensaje"});
}

  // 🔥 ACTUALIZAR TIMESTAMP
  await db.query(
    "UPDATE guests SET last_message_at=NOW() WHERE id=$1",
    [guest_id]
  );

  // 🔥 SOCKETS
  io.to("admin_" + company_code).emit("new_message", {
    guest_id,
    message,
    sender
  });

  io.to("guest_" + guest_id).emit("new_message", {
    guest_id,
    message,
    sender
  });

  // 🔥 SI ES ADMIN → TERMINA AQUÍ
  if(sender === "admin"){
    await db.query(`
      UPDATE guests 
      SET last_response_at = NOW()
      WHERE id=$1
    `,[guest_id]);

    return res.json({ ok:true });
  }

  // 🔥 SOLO SI ES GUEST → IA
 if(sender === "guest"){

  let ai;

  try{
    ai = await detectarIntencion(message, company_id);
  }catch(e){
    ai = { texto:"Error IA", ticket:false };
  }

  if(!ai || !ai.texto){
    return res.json({ ok:true, ia:false });
  }

  // 🔥 CREAR TASK SI APLICA
  let taskCreada = null;

  if(ai.ticket === true){
    try{

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

      taskCreada = task.rows[0];

      io.to("admin_" + company_code).emit("task_update", taskCreada);

      io.to("admin_" + company_code).emit("staff_alert",{
        guest_id,
        guest_name: guestData.name,
        room: guestData.room,
        message
      });await sendPushByDepartment(
  taskCreada.department,
  "Nueva tarea",
  message,
  taskCreada.id,
  guestData.company_id
);


    }catch(err){
      console.error("❌ ERROR CREANDO TASK:", err);
    }
  }

  // 🔥 obtener idioma del huésped
  
let textoFinal = ai.texto;

// 🔥 traducir con IA SOLO si no es español
if(guestLang !== "es" && process.env.OPENAI_API_KEY){
  textoFinal = await traducirIA(ai.texto, guestLang);
}

// 🔥 DEBUG AQUÍ
console.log("🌐 LANG:", guestLang);
console.log("🤖 RESPUESTA ORIGINAL:", ai.texto);
console.log("🌍 RESPUESTA FINAL:", textoFinal);

await db.query(
  "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,'bot')",
  [guest_id, textoFinal]
);

  io.to("guest_" + guest_id).emit("new_message",{
    guest_id,
    message: textoFinal,
    sender: "bot"
  });

  io.to("admin_" + company_code).emit("new_message",{
    guest_id,
    message: ai.texto,
    sender: "bot"
  });

  return res.json({
    ok:true,
    ia:true,
    task: !!taskCreada
  });
}

  return res.json({ ok:true });

 } catch(err){
  console.error("❌ ERROR /chat/message:", err);
  return res.status(500).json({
    error:"Error en chat",
    detalle: err.message
  });
 }
});

app.get("/users", authMiddleware, async (req,res)=>{
  try{

    // 🔍 DEBUG AQUÍ
    console.log("👤 USER:", req.user);
    console.log("🏢 company_id:", req.user.company_id);

    const result = await db.query(`
      SELECT id, username, department, role
      FROM users
      WHERE company_id=$1
      ORDER BY username
    `, [req.user.company_id]);

    res.json(result.rows);

  }catch(err){
    console.error("❌ ERROR /users:", err);
    res.status(500).json({ error: "Error obteniendo usuarios" });
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
}
  catch(err){
  console.error("ERROR chat:", err);
  res.status(500).json({error:"Error obteniendo chat"});
 }
});
app.get("/company", authMiddleware, async (req,res)=>{
  try{

    const result = await db.query(
      "SELECT name FROM companies WHERE id=$1",
      [req.user.company_id]
    );

    if(result.rows.length === 0){
      return res.status(404).json({ error:"Empresa no encontrada" });
    }

    res.json(result.rows[0]);

  }catch(err){
    console.error("Error /company:", err);
    res.status(500).json({error:"Error obteniendo empresa"});
  }
});
app.get("/tickets/:company_code", async (req,res)=>{
 try{

  console.log("Company code:", req.params.company_code);

  const company_id = await getCompanyId(req.params.company_code);

  const r = await db.query(`
    SELECT * FROM tickets
    WHERE company_id=$1
    ORDER BY created_at DESC
  `,[company_id]);

  res.json(r.rows);

 }catch(err){
  console.error("❌ ERROR /tickets:", err.message);
  res.status(200).json([]); // 🔥 NO rompe frontend
 }
});

// Lista de huéspedes
app.get("/guests/:company_code", async (req,res)=>{
 try{

  const company_id = await getCompanyId(req.params.company_code);
  const { from, to, date } = req.query;

  let query = `
    SELECT *
    FROM guests
    WHERE active=true
    AND company_id=$1
  `;

  let params = [company_id];

  // 🔥 FILTRO POR RANGO
 if(from && to){
  query += `
    AND (
      DATE(created_at) BETWEEN $2 AND $3
      OR DATE(last_message_at) BETWEEN $2 AND $3
    )
  `;
  params.push(from, to);
}

  // 🔥 FILTRO HOY
  else if(date === "today"){
    query += `
      AND (
        last_message_at >= CURRENT_DATE
        OR (last_message_at IS NULL AND created_at >= CURRENT_DATE)
      )
    `;
  }

  query += ` ORDER BY COALESCE(last_message_at, created_at) DESC`;

  console.log("🧠 QUERY:", query);
  console.log("📊 PARAMS:", params);

  const result = await db.query(query, params);

  res.json(result.rows);

 }catch(err){
  console.error("ERROR guests:", err);
  res.status(500).json({error:"Error obteniendo guests"});
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
app.get("/dashboard/:company_code", async (req,res)=>{
 try{

  const company_id = await getCompanyId(req.params.company_code);

  const guests = await db.query(
  "SELECT COUNT(*) FROM guests WHERE company_id=$1 AND active=true",
  [company_id]
);

 const tickets = await db.query(
  "SELECT COUNT(*) FROM tasks WHERE company_id=$1",
  [company_id]
);

  const messages = await db.query(`
  SELECT COUNT(*) 
  FROM messages m
  INNER JOIN guests g ON m.guest_id = g.id
  WHERE g.company_id=$1
`,[company_id]);

  const pendientes = await db.query(`
    SELECT COUNT(*) FROM guests
    WHERE company_id=$1
    AND last_message_at IS NOT NULL
    AND last_response_at IS NULL
  `,[company_id]);

  res.json({
    guests: Number(guests.rows?.[0]?.count || 0),
    tickets: Number(tickets.rows?.[0]?.count || 0),
    messages: Number(messages.rows?.[0]?.count || 0),
    pending: Number(pendientes.rows?.[0]?.count || 0)
  });

 }catch(err){
  console.error("🔥 DASHBOARD ERROR:", err);

  // 🔥 nunca romper frontend
  res.status(200).json({
    guests: 0,
    tickets: 0,
    messages: 0,
    pending: 0
  });
 }
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


const DEPARTMENTS = [
  "Recepción",
  "Mantenimiento",
  "Housekeeping",
  "Operaciones",
  "Seguridad",
  "Spa",
  "Alimentos Bebidas",
  "Cocina",
  "Room Service",
  "Eventos",
  "Ventas",
  "Recursos Humanos",
  "Finanzas",
  "Gerencia General"
];
async function traducirIA(texto, idioma){

  if(!texto) return texto;

  // 🔥 si es español, no traduce
  if(idioma === "es") return texto;

  try{

    const res = await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + process.env.OPENAI_API_KEY
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `Translate the following text to ${idioma}. Keep tone natural and friendly.`
          },
          {
            role: "user",
            content: texto
          }
        ]
      })
    });

    const data = await res.json();

    // 🔥 DEBUG OPENAI
    console.log("🧠 OPENAI RAW:", data);

    // 🔥 VALIDAR ERROR
    if(data.error){
      console.error("❌ OPENAI ERROR:", data.error);
      return texto;
    }

    return data.choices?.[0]?.message?.content || texto;

  }catch(err){
    console.error("❌ ERROR TRADUCCIÓN:", err);
    return texto;
  }
}
function authMiddleware(req, res, next){

  // 🔥 PERMITIR PREFLIGHT
  if (req.method === "OPTIONS") {
    return next();
  }

  const authHeader = req.headers.authorization;

  console.log("🔐 SECRET:", SECRET);
  console.log("📩 AUTH HEADER:", authHeader);

  if(!authHeader){
    return res.status(401).json({ error:"Token requerido" });
  }

  const token = authHeader.split(" ")[1];

  console.log("🎫 TOKEN RECIBIDO:", token);

  try{
    req.user = jwt.verify(token, SECRET);

    console.log("✅ TOKEN OK:", req.user);

    next();

  }catch(err){

    console.error("❌ JWT ERROR:", err.message);

    return res.status(401).json({ error:"Token inválido o expirado" });
  }
}
// ================= TEMPLATES =================

// 🔥 👉 PEGA AQUÍ
app.get("/departments", authMiddleware, (req,res)=>{
  res.json([
    "Recepción",
  "Mantenimiento",
  "Housekeeping",
  "Operaciones",
  "Seguridad",
  "Spa",
  "Alimentos Bebidas",
  "Cocina",
  "Room Service",
  "Eventos",
  "Ventas",
  "Recursos Humanos",
  "Finanzas",
  "Gerencia General"
  ]);
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
CREATE TABLE IF NOT EXISTS task_templates (
  id SERIAL PRIMARY KEY,
  title TEXT,
  description TEXT,
  department TEXT,
  priority TEXT DEFAULT 'normal',
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'unique_settings'
  ) THEN
    ALTER TABLE settings
    ADD CONSTRAINT unique_settings UNIQUE (key, company_id);
  END IF;
END
$$;
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
await db.query(`
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS company_id INTEGER
`);

await db.query(`
  ALTER TABLE guests ADD COLUMN IF NOT EXISTS assigned_to TEXT
`);
await db.query(`
  ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_response_at TIMESTAMP
`);

await db.query(`
  ALTER TABLE guests ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP
`);

await db.query(`
  ALTER TABLE guests ADD COLUMN IF NOT EXISTS fail_count INTEGER DEFAULT 0
`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_tasks_company ON tasks(company_id)`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_messages_guest ON messages(guest_id)`);
await db.query(`CREATE INDEX IF NOT EXISTS idx_guests_company ON guests(company_id)`);
  }

const PORT = process.env.PORT || 3000;

(async () => {
  try{
    console.log("⏳ Inicializando DB...");

    await initDB();

    console.log("✅ DB lista");

    server.listen(PORT,()=>{
      console.log("🚀 Server running on port",PORT);
    });

    console.log("🔥 DB INIT COMPLETADO");

  }catch(err){
    console.error("💥 ERROR INIT DB:", err);
  }
})();

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

// 🔥 GLOBAL (arriba del archivo)
const onlineDepartments = {}; // existente
const onlineUsers = {}; // 🔥 NUEVO (solo UNA vez)

function emitirUsuariosOnline(io){

  const activos = Object.keys(onlineUsers).map(id => String(id));

  io.emit("online_users_update", activos);

}

setInterval(()=>{

  const ahora = Date.now();

  Object.keys(onlineUsers).forEach(id=>{
    if(ahora - onlineUsers[id] > 30000){
      delete onlineUsers[id];
    }
  });

},10000);



// ================= SOCKET =================
io.on("connection",(socket)=>{

  // ================= AUTH =================
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

  if(!socket.user){
    console.log("❌ Socket sin usuario, desconectando");
    socket.disconnect();
    return;
  }

  // ================= PRESENCIA =================

  // 🔥 Usuario activo por user_id
  let lastEmit = 0;

socket.on("heartbeat", ()=>{

  if(socket.user?.id){
    onlineUsers[socket.user.id] = Date.now();
  }

  if(Date.now() - lastEmit > 3000){
    emitirUsuariosOnline(io);
    lastEmit = Date.now();
  }

});

  // 🔥 App background / foreground (departamento)
  socket.on("app_background", (department)=>{
    onlineDepartments[department] = 0;
    console.log("📴 Background:", department);
  });

  socket.on("app_foreground", (department)=>{
    onlineDepartments[department] = Date.now();
    console.log("📱 Foreground:", department);
  });

  // ================= ROOMS =================

  if(department){
    socket.join(department);
    onlineDepartments[department] = Date.now();
    console.log(`🟢 ${department} online`);
  }

  if(decoded.role === "sistemas"){
    DEPARTMENTS.forEach(dep=>{
      socket.join(dep);
    });
  }

  socket.on("join_admin", (company_code)=>{
    socket.join("admin_" + company_code);
  });

  socket.on("join_guest", (guest_id)=>{
    socket.join("guest_" + guest_id);
  });

  // ================= EVENTOS =================

  socket.on("typing", (data)=>{

    const { guest_id, company_code } = data;

    socket.to("admin_" + company_code).emit("typing",{
      guest_id
    });

  });

  socket.on("admin_typing", (data)=>{

    const { guest_id } = data;

    socket.to("guest_" + guest_id).emit("typing_admin");

  });

  socket.on("message_read",(data)=>{
    io.to("admin_" + data.company_code).emit("message_read", data);
  });

  socket.on("call_staff", (data) => {

    io.to("admin_" + data.company_code).emit("staff_alert", {
      guest_id: data.guest_id,
      message: data.message,
      company_code: data.company_code
    });

  });

  socket.on("admin_send_message", async (data)=>{

    const { guest_id, message, company_code } = data;

    if(!guest_id || !message || !company_code){
      console.error("❌ Datos incompletos admin_send_message:", data);
      return;
    }

    try{

      await db.query(
        "INSERT INTO messages (guest_id, message, sender) VALUES ($1,$2,'admin')",
        [guest_id, message]
      );

      await db.query(
        "UPDATE guests SET last_response_at=NOW() WHERE id=$1",
        [guest_id]
      );

      io.to("guest_" + guest_id).emit("message_delivered",{ guest_id });

      io.to("guest_" + guest_id).emit("new_message",{
        guest_id,
        message,
        sender:"admin"
      });

      io.to("admin_" + company_code).emit("new_message",{
        guest_id,
        message,
        sender:"admin"
      });

    }catch(err){

      console.error("❌ ERROR admin_send_message:", err);

      io.to("admin_" + company_code).emit("error_message",{
        error:"No se pudo enviar el mensaje"
      });

    }

  });

  socket.on("logout", ()=>{
    console.log("🔌 Socket cerrado por logout");
    socket.disconnect(true);
  });

  // ================= DISCONNECT =================

  socket.on("disconnect",()=>{

  if(socket.user?.id){
    delete onlineUsers[socket.user.id];
  }

  emitirUsuariosOnline(io);

  if(department){
    onlineDepartments[department] = 0;
    console.log(`🔴 ${department} offline`);
  }

});
});


function normalizar(msg){
 return msg
  .toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"") // quita acentos
}

async function detectarIntencion(msg, company_id){

  msg = normalizar(msg);

  // ================= RESPUESTAS RÁPIDAS (DB) =================
  const flows = await db.query(
    "SELECT * FROM bot_flows WHERE company_id=$1",
    [company_id]
  );

  for(const f of flows.rows){
    const trigger = normalizar(f.trigger);
    if(msg.includes(trigger)){
      return {
        texto: f.response,
        ticket: false
      };
    }
  }

  // 🔥 1. FALLAS (PRIORIDAD ALTA)
  const semantica = detectarIntencionSemantica(msg);

  if(semantica.ticket === true){
    return semantica;
  }

  // ================= RESPUESTAS FIJAS HOTEL =================
  const RESPUESTAS_HOTEL = [
    {
      keywords: ["spa","masaje","temazcal","vapor"],
      texto: `💆‍♀️ Spa
🕘 9:00 a.m. a 5:00 p.m.
✨ Masajes.
Cabina de vapor.
Temazcal
📅 Todos los servicios requieren reservación previa`
    },
    {
      keywords: ["boutique","tienda"],
      texto: `🛍️ Boutique
🕘 9:00 a.m. a 5:00 p.m.
🚫 Cerrado los miércoles`
    },
    {
      keywords: ["padel","pádel","cancha"],
      texto: `🎾 Cancha de pádel
🕘 8:00 a.m. a 7:00 p.m.
📅 Uso con previa reservación`
    },
    {
      keywords: ["arqueria","arco"],
      texto: `🏹 Arquería
📅 Disponible bajo reservación`
    },
    {
      keywords: ["alberca","piscina","pool","kasuko"],
      texto: `🏊‍♀️ Alberca KASUKO
🕘 11:00 a.m. a 7:00 p.m.
📅 Disponible de viernes a domingo`
    },
    {
      keywords: ["restaurante","comida","desayuno","cena","yo"],
      texto: `🍽️ Restaurante YO

🥐 Desayuno: 8:00 a.m. a 12:30 p.m.
🍝 Comida y cena: 1:00 p.m. a 10:00 p.m.`
    },
    {
      keywords: ["menu","servicios","info","informacion","hotel"],
      texto: `¡Hola! 😊 Con gusto te comparto nuestros servicios:\n\n
• 🛍️ Boutique  
• 💆‍♀️ Spa  
• 🎾 Actividades deportivas  
• 🏊‍♀️ Alberca KASUKO  
• 🍽️ Restaurante  

👉 Escribe el servicio que te interese 😉`
    }
  ];

  for(const r of RESPUESTAS_HOTEL){
    const match = r.keywords.some(k => msg.includes(k));
    if(match){
      return {
        texto: r.texto,
        ticket: false
      };
    }
  }

  // 🔥 2. CATÁLOGO DINÁMICO (DB)
  const services = await db.query(
    "SELECT * FROM service_catalog WHERE company_id=$1",
    [company_id]
  );

  for(const s of services.rows){

    const keywords = (s.keywords || []).map(k => normalizar(k));

    let match = keywords.some(k => msg.includes(k));

    if(!match){
      const nombre = normalizar(s.name || "");
      match = msg.includes(nombre);
    }

    if(match){

      const response = {
        texto: s.auto_response,
        ticket: false
      };

      if(s.type === "info"){
        return response;
      }

      if(s.type === "request" || s.type === "issue"){
        return {
          ...response,
          ticket: true,
          departamento: s.department,
          prioridad: detectarPrioridad(msg, s.type)
        };
      }
    }
  }

  // 🔥 FALLBACK FINAL
  const defaultResponse = detectarIntencionSemantica(msg);

  if(defaultResponse.texto && defaultResponse.ticket === true){
    return defaultResponse;
  }

  return {
    texto: "¿Podrías darme más detalles para ayudarte?",
    ticket: false
  };
}

function detectarIntencionSemantica(msg){

 // 🔴 FALLAS
 if(
  msg.includes("tv") ||
  msg.includes("tina") ||
  msg.includes("baño") || 
  msg.includes("wc") ||
  msg.includes("foco") ||
  msg.includes("lampara") ||
  msg.includes("puerta") ||
  msg.includes("inodoro") ||
  msg.includes("sanitario") ||
  msg.includes("regadera") ||
  msg.includes("drenaje") ||
  msg.includes("tapada") ||
  msg.includes("no funciona") ||
  msg.includes("no sirve") ||
  msg.includes("esta roto") ||
  msg.includes("tele") ||
msg.includes("pantalla") ||
msg.includes("no prende") ||
msg.includes("no enciende") ||
  msg.includes("falla")
){
   return {
     texto: "Hemos notificado al área correspondiente, en breve estaran asistiendo a tu habitación",
     ticket: true,
     departamento: "Mantenimiento",
     prioridad: "alta"
   };
 }
// 🧹 HOUSEKEEPING DIRECTO
if(
 msg.includes("toalla") ||
 msg.includes("toallas") ||
 msg.includes("limpieza") ||
 msg.includes("limpiar") ||
 msg.includes("almohada") ||
 msg.includes("almohadas") ||
 msg.includes("sabana") ||
 msg.includes("sabanas")
){
 return {
   texto: "Enviamos al equipo de housekeeping",
   ticket: true,
   departamento: "Housekeeping",
   prioridad: "normal"
 };
}
 // 🟢 INFORMACIÓN (SUBIR PRIORIDAD)
if(
  msg.includes("horario") ||
  msg.includes("donde") ||
  msg.includes("informacion") ||
  msg.includes("restaurante") ||
  msg.includes("menu")
){
  return {
    texto: "Claro 🙌 ¿Sobre qué servicio necesitas información?",
    ticket: false
  };
}

// 🔵 SOLICITUDES (BAJAR PRIORIDAD)
if(
  msg.includes("mandar") ||
  msg.includes("enviar") ||
  msg.includes("necesito") 
){
  return {
    texto: "Tu solicitud ha sido registrada",
    ticket: true,
    departamento: "Recepción",
    prioridad: "normal"
  };
}

 return { texto:null, ticket:false };
}

function detectarPrioridad(msg, tipo){

 if(tipo === "issue") return "alta";

 if(msg.includes("urgente") || msg.includes("ya")){
   return "alta";
 }

 return "normal";
}

async function crearTicket({guest_id, room, tipo, prioridad="normal", company_id}){

 await db.query(`
  INSERT INTO tickets (guest_id, room, type, priority, company_id)
  VALUES ($1,$2,$3,$4,$5)
 `,[guest_id, room, tipo, prioridad, company_id]);

}

/* ================= PUSH HELPER ================= */

async function sendPushByDepartment(department, title, message, taskId, companyId){

  // 🔥 DEBUG INICIAL (SIEMPRE)
  console.log("🚀 PUSH INTENTO");
  console.log("Dept:", department);
  console.log("Company:", companyId);

  // ⚠️ DESACTIVAR TEMPORALMENTE BLOQUEO
  // (esto está rompiendo iPhone background)
  /*
  const lastSeen = onlineDepartments[department];

  if(lastSeen && (Date.now() - lastSeen < 10000)){
    console.log(`⚡ ${department} activo → solo socket`);
    return;
  }
  */

  const payload = JSON.stringify({
  title: title,
  body: message,
  taskId: taskId,
  sound: "default"
});

  const result = await db.query(
    `
    SELECT subscription, user_id
    FROM push_subscriptions
    WHERE department = $1 AND company_id = $2
    `,
    [department, companyId]
  );

  console.log("📦 Subs encontradas:", result.rows.length);

  if(result.rows.length === 0){
    console.log(`⚠ No hay subs para ${department}`);
    return;
  }

  await Promise.all(result.rows.map(async (row) => {

    let sub;

    try{
      sub = JSON.parse(row.subscription);
    }catch(e){
      console.log("⚠ Suscripción inválida");
      return;
    }

    if(!sub?.endpoint){
      console.log("⚠ Sin endpoint");
      return;
    }

    try{

      console.log("📤 Enviando push a:", sub.endpoint);

      await webpush.sendNotification(sub, payload);

    }catch(e){

      console.log("❌ Push error:", e.message);

      if(e.statusCode === 410 || e.statusCode === 404){

        await db.query(
          "DELETE FROM push_subscriptions WHERE endpoint = $1",
          [sub.endpoint]
        );

        console.log("🧹 Eliminada:", sub.endpoint);
      }

    }

  }));

}

/* ================= SUBSCRIBE ================= */

app.post("/subscribe", authMiddleware, async (req,res)=>{

 try{

   const { subscription, department } = req.body;

   if(!subscription?.endpoint){
     return res.status(400).json({error:"Invalid subscription"});
   }

   const dept = department || "general";

   await db.query(`
     INSERT INTO push_subscriptions
     (endpoint, subscription, department, company_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint)
     DO UPDATE SET
       department = EXCLUDED.department,
       company_id = EXCLUDED.company_id
   `,
   [
     subscription.endpoint,
     JSON.stringify(subscription),
     dept,
     req.user.company_id
   ]);

   res.json({ok:true});

 }catch(err){
   console.error(err);
   res.status(500).json({error:"Error saving subscription"});
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
 try{

   const { key, value } = req.body;

   console.log("📦 BODY SETTINGS:", req.body);

   console.log("⚙️ SETTINGS:", {
     key,
     size: value?.length,
     company: req.user.company_id
   });

   await db.query(`
     INSERT INTO settings(key,value,company_id)
     VALUES($1,$2,$3)
     ON CONFLICT (key,company_id)
     DO UPDATE SET value=EXCLUDED.value
   `,
   [key,value,req.user.company_id]);

   res.json({ok:true});

 }catch(err){
   console.error("❌ ERROR SETTINGS:", err);
   res.status(500).json({
     error:"Error guardando settings",
     detalle: err.message
   });
 }
});
/* ================= CREATE TASK ================= */
app.post("/tasks", authMiddleware, async (req,res)=>{

  try{

    const { title, description, departments, due_date, user } = req.body;

    if(!departments || !Array.isArray(departments) || departments.length === 0){
      return res.status(400).send("Debes seleccionar al menos un departamento");
    }

    let dueDateFinal;

    if(due_date){
      dueDateFinal = new Date(due_date);
    }else{
      dueDateFinal = new Date();
      dueDateFinal.setMinutes(
        dueDateFinal.getMinutes() + 15
      );
    }

    const tareasCreadas = [];

    const companyRes = await db.query(
      "SELECT code FROM companies WHERE id=$1",
      [req.user.company_id]
    );

    const company_code = companyRes.rows[0].code;

    for(const department of departments){

      if(!DEPARTMENTS.includes(department)){
        continue;
      }

      const result = await db.query(
        `
        INSERT INTO tasks
        (
          title,
          description,
          department,
          status,
          created_by,
          due_date,
          company_id
        )
        VALUES($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [
          title,
          description,
          department,
          "abierto",
          user,
          dueDateFinal,
          req.user.company_id
        ]
      );

      const nuevaTarea = result.rows[0];

      tareasCreadas.push(nuevaTarea);

      // 🔥 SOCKET (igual que antes)
      io.to("admin_" + company_code)
        .emit("task_update", nuevaTarea);

      // 🔥 PUSH (FIX APLICADO)
      await sendPushByDepartment(
        department,
        "Nueva tarea",
        `${title} - ${department}`,
        nuevaTarea.id,
        nuevaTarea.company_id // 👈 ESTE ES EL FIX
      );

    }

    res.json(tareasCreadas);

  }catch(err){

    console.error("Error creando tareas:", err);
    res.status(500).send("Error creando tareas");

  }

});
app.put("/admin/services/:id", authMiddleware, async (req,res)=>{

  const { name, keywords, department, type, auto_response } = req.body;

  await db.query(`
    UPDATE service_catalog
    SET name=$1,
        keywords=$2,
        department=$3,
        type=$4,
        auto_response=$5
    WHERE id=$6 AND company_id=$7
  `,
  [name, keywords, department, type, auto_response, req.params.id, req.user.company_id]);

  res.json({ok:true});
});
app.put("/tasks/:id", authMiddleware, async (req,res)=>{

 try{

   const id = req.params.id;
   const { status, comments, due_date } = req.body;

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
   updateQuery += ", closed_at=NOW(), closed_by=$" + index;
   values.push(req.user.username);
   index++;
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

   // 🔥 POSTERGAR TAREA
if(due_date !== undefined){
  await db.query(
    "UPDATE tasks SET due_date=$1 WHERE id=$2 AND company_id=$3",
    [due_date, id, req.user.company_id]
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
  `UPDATE users
   SET password=$1
   WHERE username=$2
   AND company_id=$3`,
  [hashed, username, req.user.company_id]
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
AND (
  (due_date IS NOT NULL AND due_date < NOW())
  OR
  (due_date IS NULL AND NOW() - created_at > interval '15 minutes')
)
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
// ===== LOGOUT DEVICE (PUSH CLEANUP) =====
app.post(
  "/logout-device",
  authMiddleware,
  async(req,res)=>{
    try{

      const { endpoint } = req.body;

      // 🔥 ELIMINAR SUSCRIPCIÓN PUSH REAL
      if(endpoint){
        await db.query(
          "DELETE FROM push_subscriptions WHERE endpoint=$1",
          [endpoint]
        );

        console.log("🧹 Push eliminado:", endpoint);
      }

      res.json({ ok:true });

    }catch(err){
      console.log(err);
      res.status(500).send("Error logout");
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

 const client = await db.connect();

 try{

   const { name, code } = req.body;

   await client.query("BEGIN");

   const result = await client.query(
     `
     INSERT INTO companies(name,code)
     VALUES($1,$2)
     RETURNING *
     `,
     [name,code]
   );

   const newCompany = result.rows[0];

   // 🔥 ONBOARDING AUTOMÁTICO
   await cloneDemoData(newCompany.id);

   await client.query("COMMIT");

   res.json(newCompany);

 }catch(err){

   await client.query("ROLLBACK");

   console.error(err);
   res.status(500).send("Error creando empresa");

 }finally{
   client.release();
 }

});
/* ================= RESET DEMO ================= */

app.post("/admin/reset-demo", authMiddleware, async (req,res)=>{

  if(req.user.role !== "sistemas"){
    return res.status(403).send("No autorizado");
  }

  const client = await db.connect();

  try{

    await client.query("BEGIN");

    const demo = await client.query(
      "SELECT id FROM companies WHERE code=$1",
      ["DEMO01"]
    );

    if(demo.rows.length === 0){
      throw new Error("DEMO01 no existe");
    }

    const demoId = demo.rows[0].id;

    console.log("🧹 Limpiando DEMO:", demoId);

    await client.query(`
      DELETE FROM task_evidences
      WHERE task_id IN (
        SELECT id FROM tasks WHERE company_id=$1
      )
    `,[demoId]);

    await client.query(
      "DELETE FROM tasks WHERE company_id=$1",
      [demoId]
    );

    await client.query(`
      DELETE FROM messages
      WHERE guest_id IN (
        SELECT id FROM guests WHERE company_id=$1
      )
    `,[demoId]);

    await client.query(
      "DELETE FROM guests WHERE company_id=$1",
      [demoId]
    );

    await client.query(
      "DELETE FROM tickets WHERE company_id=$1",
      [demoId]
    );

    await client.query("COMMIT");

    res.json({ ok:true, message:"DEMO reiniciado correctamente" });

  }catch(err){

    await client.query("ROLLBACK");

    console.error("❌ ERROR RESET DEMO:", err);

    res.status(500).json({
      error:"Error limpiando DEMO",
      detalle: err.message
    });

  }finally{
    client.release();
  }

});
/* ================= CREATE COMPANY ADMIN ================= */

app.post("/admin/company-admin", authMiddleware, async (req,res)=>{

 if(req.user.role !== "sistemas"){
   return res.status(403).send("No autorizado");
 }

 try{

   const { username, password, company_id } = req.body;

   if(!username || !password || !company_id){
     return res.status(400).json({
       error:"Datos incompletos"
     });
   }

   const hashedPassword = await bcrypt.hash(password,10);

   await db.query(
   `
   INSERT INTO users(
     username,
     password,
     role,
     company_id
   )
   VALUES($1,$2,'admin',$3)
   `,
   [
     username,
     hashedPassword,
     company_id
   ]
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
  `
  SELECT id, username, role, department
  FROM users
  WHERE company_id = $1
  ORDER BY id DESC
  `,
  [req.user.company_id]
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
  "DELETE FROM users WHERE id=$1 AND company_id=$2",
  [id, req.user.company_id]
);

   res.json({ok:true});

 }catch(err){
   console.log(err);
   res.status(500).send("Error eliminando usuario");

 }

});
app.get("/services/:company_code", async (req,res)=>{

 const company_id = await getCompanyId(req.params.company_code);

 const r = await db.query(
  "SELECT * FROM services WHERE company_id=$1 ORDER BY id DESC",
  [company_id]
 );

 res.json(r.rows);
});
app.post("/services", async (req,res)=>{
 try{

  const { name, keywords, response, department, requires_ticket } = req.body;

  const company_code = req.headers["x-company"] || req.body.company_code;

  const company_id = await getCompanyId(company_code);

  const r = await db.query(`
    INSERT INTO services
    (name, keywords, response, department, requires_ticket, company_id)
    VALUES($1,$2,$3,$4,$5,$6)
    RETURNING *
  `,
  [
    name,
    keywords || [],
    response,
    department,
    requires_ticket || false,
    company_id
  ]);

  res.json(r.rows[0]);

 }catch(err){
  console.error("❌ ERROR /services:", err);
  res.status(500).json({error:"Error creando servicio"});
 }
});

/* ================= LOGIN ================= */
app.get("/users", authMiddleware, async (req, res) => {

  try {

    const companyId = Number(req.user.company_id);

    if (!companyId) {
      return res.status(400).json({ error: "company_id inválido" });
    }

    // 🔐 opcional: control de acceso
    if(req.user.role !== "admin"){
      return res.status(403).json({ error: "Sin permisos" });
    }

    const result = await db.query(
      `
      SELECT id, username, department, role
      FROM users
      WHERE company_id = $1
      ORDER BY username
      `,
      [companyId]
    );

    res.json(result.rows);

  } catch (err) {

    console.error("❌ ERROR /users:", err);
    res.status(500).json({ error: "Error obteniendo usuarios" });

  }

});

// ================= UPLOAD CONFIG =================
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
app.use((err, req, res, next) => {
  res.header("Access-Control-Allow-Origin","https://mollyhelpers.com");
  res.status(500).json({ error: err.message });
});

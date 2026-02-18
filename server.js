const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const twilio = require("twilio");
require('dotenv').config();


const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./database.db", (err) => {
 if(err){
   console.log("DB error:", err);
 } else {
   console.log("DB conectada");
   initDatabase();
 }
});




const server = http.createServer(app);

const io = new Server(server,{
  cors:{
    origin:"*"
  }
});
// ================= PMS WHATSAPP ALERT =================

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;


const clientTwilio = twilio(accountSid, authToken);

const WHATSAPP_FROM = "whatsapp:+14155238886"; // sandbox
const WHATSAPP_TO = "whatsapp:+525531005532"; // tu celular

// ================= USERS =================
db.run(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT UNIQUE,
 password TEXT,
 role TEXT,
 department TEXT
)
`);

// ================= TASKS =================
db.run(`
CREATE TABLE IF NOT EXISTS tasks(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT,
 description TEXT,
 department TEXT,
 status TEXT DEFAULT 'abierto',
 created_by TEXT,
 created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
 due_date TEXT
)
`);

// 🔥 AGREGAR COLUMNA COMMENTS SI NO EXISTE
db.run("ALTER TABLE tasks ADD COLUMN comments TEXT",()=>{});

// ================= SETTINGS =================
db.run(`
CREATE TABLE IF NOT EXISTS settings(
 key TEXT PRIMARY KEY,
 value TEXT
)
`);

// ================= USERS DEMO =================
db.run(`
INSERT OR IGNORE INTO users(username,password,role,department)
VALUES
('sistemas','admin123','sistemas',NULL),
('gerencia','1234','gerencia','gerencia'),
('operaciones','1234','operaciones','operaciones'),
('mantenimiento','1234','mantenimiento','mantenimiento'),
('recepcion','1234','recepcion','recepcion'),
('cocina','1234','cocina','cocina')
`);
async function enviarAlertaPMS(department, mensaje){

 console.log("📲 ALERTA PMS:", department, mensaje);

 db.all(
   "SELECT phone FROM users WHERE department=? AND phone IS NOT NULL",
   [department],
   async (err,rows)=>{

     console.log("Usuarios encontrados:", rows);

     if(err){
       console.log("DB error:", err);
       return;
     }

     if(!rows || rows.length === 0){
       console.log("⚠️ No hay teléfonos registrados para:", department);
       return;
     }

     for(const u of rows){

       try{

         console.log("📤 Enviando a:", u.phone);

         await clientTwilio.messages.create({
           from: WHATSAPP_FROM,
           to: "whatsapp:"+u.phone,
           body: mensaje
         });

         console.log("✅ WhatsApp enviado");

       }catch(e){

         console.log("❌ Twilio error:", e.message);

       }

     }

   }
 );
}


// ================= LOGIN =================
app.post("/login",(req,res)=>{
 const {username,password}=req.body;
 db.get(
  "SELECT username,role,department FROM users WHERE username=? AND password=?",
  [username,password],
  (err,user)=>{
    if(!user) return res.status(401).send("Login incorrecto");
    res.json(user);
  });
});

// ================= GET TASKS =================

app.get("/tasks/:role",(req,res)=>{

 const role = req.params.role;

 const isAdmin = ["sistemas","gerencia","operaciones"].includes(role);

 const query = isAdmin
   ? "SELECT * FROM tasks ORDER BY created_at DESC"
   : "SELECT * FROM tasks WHERE LOWER(department)=LOWER(?) ORDER BY created_at DESC";

 const params = isAdmin ? [] : [role];

 db.all(query, params, (e,rows)=>{

   if(e){
     console.log(e);
     res.status(500).json(e);
     return;
   }

   // 🔥 FIX PRO — CONVERTIR COMMENTS JSON

   rows.forEach(t=>{

     try{

       if(t.comments){

         // si viene como texto JSON desde SQLite
         if(typeof t.comments === "string"){
           t.comments = JSON.parse(t.comments);
         }

       }else{

         t.comments = [];

       }

     }catch(err){

       console.log("Error parse comments:", err);
       t.comments = [];

     }

   });

   res.json(rows);

 });

});

 // ================= CREATE TASK =================
app.post("/tasks",(req,res)=>{

 const {title,description,department,due_date,user}=req.body;

 const now = new Date();

 const created_at =
  now.getFullYear() + "-" +
  String(now.getMonth()+1).padStart(2,'0') + "-" +
  String(now.getDate()).padStart(2,'0') + " " +
  String(now.getHours()).padStart(2,'0') + ":" +
  String(now.getMinutes()).padStart(2,'0') + ":" +
  String(now.getSeconds()).padStart(2,'0');

 db.run(
  `INSERT INTO tasks(title,description,department,due_date,created_by,created_at)
   VALUES(?,?,?,?,?,?)`,
  [title,description,department,due_date,user,created_at],
  function(err){

    if(err){
      console.log(err);
      return res.status(500).send(err);
    }

    res.json({ok:true});

    io.emit("task_update");

    enviarAlertaPMS(
department,
`🆕 Nueva tarea PMS
Depto: ${department}
Título: ${title}
Usuario: ${user}`
);

  });

});

// ================= UPDATE STATUS REAL =================

app.put("/tasks/:id",(req,res)=>{

 const id = req.params.id;
 const {status} = req.body;

 db.run(
   "UPDATE tasks SET status=? WHERE id=?",
   [status,id],
   function(err){

     if(err){
       console.log(err);
       return res.status(500).send(err);
     }

     res.json({ok:true});

     io.emit("task_update");

     // 🔥 obtener department antes de enviar alerta

     db.get(
       "SELECT department FROM tasks WHERE id=?",
       [id],
       (err,row)=>{

         if(row){

           enviarAlertaPMS(
             row.department,
             `🔄 Estado actualizado
Task ID: ${id}
Nuevo estado: ${status}`
           );

         }

       }
     );

   }
 );

});


// ================= UPDATE STATUS =================
app.put("/tasks/:id/comentario",(req,res)=>{io.emit("task_update");

 const {texto,user,fecha} = req.body;
 const id = req.params.id;

 db.get("SELECT comments FROM tasks WHERE id=?",[id],(err,row)=>{

   let comments=[];

   if(row && row.comments){

     try{
       comments=JSON.parse(row.comments);
     }catch(e){
       comments=[];
     }

   }

   comments.push({
     texto:texto,
     user:user,
     fecha:fecha
   });

   db.run(
     "UPDATE tasks SET comments=? WHERE id=?",
     [JSON.stringify(comments),id],
     ()=>res.json({ok:true})
   );

 });

});


// ================= CREATE USER =================
app.post("/users",(req,res)=>{

 const {username,password,role,phone}=req.body;

 db.run(
  "INSERT INTO users(username,password,role,department,phone) VALUES(?,?,?,?,?)",
  [username,password,role,role,phone],
  function(err){
    if(err) return res.status(500).send(err);
    res.json({ok:true});
  });

});


// ================= CHANGE PASSWORD =================
app.post("/change-password",(req,res)=>{

 const {username,newPassword}=req.body;

 db.run(
  "UPDATE users SET password=? WHERE username=?",
  [newPassword,username],
  ()=>res.json({ok:true})
 );

});

// ================= SETTINGS (LOGO) =================
app.post("/settings",(req,res)=>{

 const {key,value}=req.body;

 db.run(
  "INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
  [key,value],
  ()=>res.json({ok:true})
 );

});

app.get("/settings",(req,res)=>{

 db.all("SELECT * FROM settings",(e,rows)=>res.json(rows));

});

function initDatabase(){

 db.serialize(()=>{

   db.run(`
   CREATE TABLE IF NOT EXISTS users(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT UNIQUE,
     password TEXT,
     role TEXT,
     department TEXT,
     phone TEXT
   )
   `);

   db.run(`
   CREATE TABLE IF NOT EXISTS tasks(
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT,
     description TEXT,
     department TEXT,
     status TEXT DEFAULT 'abierto',
     created_by TEXT,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     due_date TEXT,
     comments TEXT
   )
   `);

   db.run(`
   CREATE TABLE IF NOT EXISTS settings(
     key TEXT PRIMARY KEY,
     value TEXT
   )
   `);

   db.run(`
   INSERT OR IGNORE INTO users(username,password,role,department)
   VALUES('sistemas','admin123','sistemas',NULL)
   `);

   console.log("Tablas creadas OK");

   startServer();

 });

}

function startServer(){

 const PORT = process.env.PORT || 5000;

 server.listen(PORT,()=>{
   console.log("Servidor SISTEMAS OK - PMS ENTERPRISE");
 });

}



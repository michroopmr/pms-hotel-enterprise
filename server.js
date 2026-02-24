const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const { Server } = require("socket.io");
const webpush = require("web-push");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

app.use(cors({
  origin: "*",
  methods: ["GET","POST","PUT"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.static(__dirname));

// ================= DATABASE =================

const db = new sqlite3.Database("./database.db");

db.serialize(()=>{

 db.run(`
 CREATE TABLE IF NOT EXISTS tasks(
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   title TEXT,
   department TEXT,
   status TEXT
 )`);

 db.run(`
 CREATE TABLE IF NOT EXISTS push_subscriptions(
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   endpoint TEXT UNIQUE,
   department TEXT,
   subscription TEXT
 )`);

});

// ================= WEB PUSH =================

webpush.setVapidDetails(
  "mailto:admin@mollyhelpers.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ================= SOCKET =================

io.on("connection",(socket)=>{
 console.log("🔥 cliente conectado:", socket.id);
});

// ================= PUSH HELPER (ENTERPRISE) =================

function sendPushByDepartment(department, title, message){

  const payload = JSON.stringify({
    title,
    body: message
  });

  db.all(
    "SELECT subscription FROM push_subscriptions WHERE department=?",
    [department],
    (err,rows)=>{

      if(err){
        console.log("Error leyendo subs:", err);
        return;
      }

      rows.forEach(r=>{
        const sub = JSON.parse(r.subscription);

        webpush.sendNotification(sub, payload)
        .catch(e=>console.log("Push error:", e.message));
      });

    }
  );
}

// ================= SUBSCRIBE =================

app.post('/subscribe', (req, res) => {

  const subscription = req.body;
  const endpoint = subscription.endpoint;
  const department = subscription.department || "general";

  db.run(
    `INSERT OR IGNORE INTO push_subscriptions(endpoint, department, subscription)
     VALUES(?,?,?)`,
    [endpoint, department, JSON.stringify(subscription)],
    (err) => {
      if(err){
        console.log("Error guardando subscription:", err);
        return res.sendStatus(500);
      }

      console.log("🔥 Nueva subscription guardada");
      res.sendStatus(201);
    }
  );
});

// ================= CREAR TAREA =================

app.post("/tasks",(req,res)=>{

 const { title, department } = req.body;

 db.run(
   "INSERT INTO tasks(title,department,status) VALUES(?,?,?)",
   [title, department, "abierto"],
   function(err){

     if(err){
       console.log(err);
       return res.sendStatus(500);
     }

     const tareaNueva = {
       id: this.lastID,
       title,
       department,
       status: "abierto"
     };

     // realtime
     io.emit("task_update", tareaNueva);

     // push inteligente
     sendPushByDepartment(
       department,
       "Nueva tarea",
       `Departamento: ${department} - ${title}`
     );

     res.json({ok:true});

   }
 );

});

// ================= ACTUALIZAR TAREA =================

app.put("/tasks/:id",(req,res)=>{

 const { status } = req.body;
 const id = req.params.id;

 db.run(
   "UPDATE tasks SET status=? WHERE id=?",
   [status,id],
   function(err){

     if(err){
       console.log(err);
       return res.sendStatus(500);
     }

     io.emit("task_update",{ id, status });

     res.json({ok:true});

     // obtener department real
     db.get(
       "SELECT department FROM tasks WHERE id=?",
       [id],
       (err,row)=>{

         if(err || !row) return;

         sendPushByDepartment(
           row.department,
           "Estado actualizado",
           `Nuevo estado: ${status}`
         );

       }
     );

   }
 );

});

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT, ()=>{
 console.log("🚀 Server running on port", PORT);
});
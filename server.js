const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const { Server } = require("socket.io");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

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
 "TU_PUBLIC_KEY",
 "TU_PRIVATE_KEY"
);

// ================= SOCKET =================

io.on("connection",(socket)=>{
 console.log("🔥 cliente conectado:", socket.id);
});

// ================= SUBSCRIBE =================

app.post("/subscribe",(req,res)=>{

 const { subscription, department } = req.body;

 db.run(
   "INSERT OR REPLACE INTO push_subscriptions(endpoint,department,subscription) VALUES(?,?,?)",
   [subscription.endpoint, department, JSON.stringify(subscription)],
   (err)=>{
     if(err){
       console.log("Error guardando push:", err);
       return res.sendStatus(500);
     }
     console.log("🔥 Push guardado enterprise");
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

     io.emit("task_update", tareaNueva);

     res.json({ok:true});

     // ===== PUSH SOLO A SU DEPARTAMENTO =====

     const payload = JSON.stringify({
       body: `Nueva tarea: ${title}`
     });

     db.all(
       "SELECT subscription FROM push_subscriptions WHERE department=?",
       [department],
       (err,rows)=>{

         if(err) return;

         rows.forEach(r=>{
           const sub = JSON.parse(r.subscription);

           webpush.sendNotification(sub, payload)
           .catch(e=>console.log("Push error:",e.message));
         });

       }
     );

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

     // Obtener department real
     db.get("SELECT department FROM tasks WHERE id=?",[id],(err,row)=>{

       if(err || !row) return;

       const department = row.department;

       const payload = JSON.stringify({
         body: `Estado actualizado: ${status}`
       });

       db.all(
         "SELECT subscription FROM push_subscriptions WHERE department=?",
         [department],
         (err,rows)=>{

           if(err) return;

           rows.forEach(r=>{
             const sub = JSON.parse(r.subscription);

             webpush.sendNotification(sub, payload)
             .catch(e=>console.log("Push error:",e.message));
           });

         }
       );

     });

   }
 );

});

// ================= START =================

const PORT = process.env.PORT || 3000;

server.listen(PORT, ()=>{
 console.log("🚀 Server running on port", PORT);
});
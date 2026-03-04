const user = JSON.parse(localStorage.getItem('user'));
if (!user) location.href = 'login.html';

const lista = document.getElementById('lista');
const historial = document.getElementById('historial');

const url = user.role === 'gerencia'
  ? 'http://localhost:5000/tasks'
  : `http://localhost:5000/tasks/department/${user.department_id}`;

fetch(url)
  .then(res => res.json())
  .then(tasks => {
    lista.innerHTML = '';
    tasks.forEach(t => {
      const li = document.createElement('li');
      li.className = t.status;
      li.innerHTML = `
        <strong>${t.title}</strong>
        <br>${t.description || ''}
        <br>Estado: ${t.status}
        ${t.department ? `<br>Depto: ${t.department}` : ''}
        <br>
        <button onclick="verHistorial(${t.id})">Ver historial</button>
        <button onclick="cambiarEstado(${t.id}, 'en_proceso')">En proceso</button>
        <button onclick="cambiarEstado(${t.id}, 'terminado')">Terminado</button>
      `;
      lista.appendChild(li);
    });
  });

function cambiarEstado(id, status) {
  fetch(`http://localhost:5000/tasks/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, user_id: user.id })
  }).then(() => location.reload());
}

function verHistorial(taskId) {
  fetch(`http://localhost:5000/tasks/${taskId}/history`)
    .then(res => res.json())
    .then(data => {
      historial.innerHTML = '';
      data.forEach(h => {
        const li = document.createElement('li');
        li.innerText = `${h.created_at} - ${h.name}: ${h.action}`;
        historial.appendChild(li);
      });
    });
}
function cargarUsuarios() {
  fetch("http://localhost:5000/users")
    .then(r => r.json())
    .then(data => {
      const ul = document.getElementById("usuarios");
      ul.innerHTML = "";
      data.forEach(u => {
        const li = document.createElement("li");
        li.innerText = `${u.username} (${u.role})`;
        ul.appendChild(li);
      });
    });
}

function crearUsuario() {
  fetch("http://localhost:5000/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: u.value,
      password: p.value,
      role: r.value
    })
  })
  .then(r => r.json())
  .then(resp => {
    if (resp.ok) {
      u.value = p.value = "";
      cargarUsuarios();
    } else {
      alert(resp.error);
    }
  });
}

cargarUsuarios();
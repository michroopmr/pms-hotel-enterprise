DROP TABLE IF EXISTS task_history;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  username TEXT,
  password TEXT,
  role TEXT,
  department_id INTEGER
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  description TEXT,
  department_id INTEGER,
  status TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER,
  user_id INTEGER,
  action TEXT,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO departments (name) VALUES
('Recepción'),
('Mantenimiento'),
('Ama de llaves'),
('Gerencia');

INSERT INTO users (name, username, password, role, department_id) VALUES
('Gerente General', 'gerencia', '1234', 'gerencia', 4),
('Recepción', 'recep', '1234', 'user', 1),
('Mantenimiento', 'manto', '1234', 'user', 2);

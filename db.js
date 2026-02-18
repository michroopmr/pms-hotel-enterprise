const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./hotel.db');

module.exports = db;

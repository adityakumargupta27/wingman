import db from '../lib/db.js';
const stmt = db.prepare('SELECT * FROM applications LIMIT 10');
const rows = [];
while (stmt.step()) rows.push(stmt.getAsObject());
stmt.free();
console.log('Applications in DB:', rows);

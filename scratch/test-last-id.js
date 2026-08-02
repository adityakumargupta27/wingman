import db from '../lib/db.js';

db.run('INSERT INTO applications (discord_id, company) VALUES (?, ?)', ['user123', 'CompanyABC']);
const res = db.exec('SELECT last_insert_rowid() AS id');
console.log('exec result:', JSON.stringify(res, null, 2));
console.log('row ID:', res[0].values[0][0]);

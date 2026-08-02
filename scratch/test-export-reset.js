import db from '../lib/db.js';

db.run('INSERT INTO applications (discord_id, company) VALUES (?, ?)', ['user123', 'CompanyABC']);
const resBefore = db.exec('SELECT last_insert_rowid() AS id');
console.log('ID before export:', resBefore[0].values[0][0]);

db.export();

const resAfter = db.exec('SELECT last_insert_rowid() AS id');
console.log('ID after export:', resAfter[0].values[0][0]);

import { saveApplication } from '../lib/db.js';
import db from '../lib/db.js';

const testApp = {
  discordId: 'user123',
  company: 'CompanyXYZ',
  role: 'Engineer',
  score: 9.0,
  archetype: 'Tech',
  legitimacy: 'High',
  jdSnippet: 'React',
  reportText: 'Good',
  storiesJson: '[]',
  threadId: '123'
};

const appId = saveApplication(testApp);
console.log('Returned App ID:', appId);

const stmt = db.prepare('SELECT last_insert_rowid() AS id');
stmt.step();
console.log('Direct prepare check:', stmt.getAsObject());
stmt.free();

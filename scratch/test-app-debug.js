import { saveApplication, getApplication } from '../lib/db.js';

const testUserId = 'test_user_999';
const testApp = {
  discordId: testUserId,
  company: 'TestCorp',
  role: 'Staff Engineer',
  score: 8.5,
  archetype: 'Technical Leader',
  legitimacy: 'High',
  jdSnippet: 'Need React and Node experience.',
  reportText: 'Good match on technical skills.',
  storiesJson: '[]',
  threadId: '123456789'
};

const appId = saveApplication(testApp);
console.log('Inserted App ID:', appId);

const retrievedApp = getApplication(appId);
console.log('Retrieved Application:', retrievedApp);

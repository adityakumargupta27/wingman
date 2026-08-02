import { 
  upsertUser, getUser, setCV, getCV, deleteCV, 
  saveGmailToken, getGmailToken, saveApplication, getApplication,
  addStory, getStories, deleteStory
} from '../lib/db.js';
import log from '../lib/logger.js';

async function testDBCrud() {
  console.log('--- Database CRUD Operations Verification ---');
  
  const testUserId = 'test_user_999';
  const testUsername = 'TestUserTag';

  try {
    // 1. User CRUD
    console.log('Testing User Upsert...');
    upsertUser(testUserId, testUsername);
    const user = getUser(testUserId);
    if (user && user.username === testUsername) {
      console.log('✅ User CRUD: PASS');
    } else {
      console.log('❌ User CRUD: FAIL');
    }

    // 2. Resume / CV Storage
    console.log('Testing CV Storage...');
    const dummyCVText = 'Experienced Node.js and React Developer.';
    setCV(testUserId, dummyCVText);
    const retrievedCV = getCV(testUserId);
    if (retrievedCV === dummyCVText) {
      console.log('✅ CV Storage CRUD: PASS');
    } else {
      console.log('❌ CV Storage CRUD: FAIL');
    }

    // 3. Gmail Token CRUD
    console.log('Testing Gmail Token Storage...');
    const dummyToken = 'dummy_refresh_token_xyz_123';
    saveGmailToken(testUserId, dummyToken);
    const retrievedToken = getGmailToken(testUserId);
    if (retrievedToken === dummyToken) {
      console.log('✅ Gmail Token Storage: PASS');
    } else {
      console.log('❌ Gmail Token Storage: FAIL');
    }

    // 4. Application Tracker CRUD
    console.log('Testing Application Tracking...');
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
    const retrievedApp = getApplication(appId);
    if (retrievedApp && retrievedApp.company === testApp.company && retrievedApp.score === testApp.score) {
      console.log('✅ Application CRUD: PASS');
    } else {
      console.log('❌ Application CRUD: FAIL');
    }

    // 5. STAR Stories CRUD
    console.log('Testing STAR Stories CRUD...');
    const title = 'Scaling Monorepos';
    const category = 'Technical';
    const storyText = 'Situation: Scaling cart operations... Task: Reduce lag... Action: Redesigned reducer... Result: 40% speedup.';
    addStory(testUserId, title, category, storyText);
    
    const stories = getStories(testUserId);
    if (stories.length > 0 && stories[0].title === title) {
      console.log('✅ STAR Story Insertion & Read: PASS');
      const storyId = stories[0].id;
      deleteStory(storyId, testUserId);
      const remainingStories = getStories(testUserId);
      if (remainingStories.length === 0) {
        console.log('✅ STAR Story Deletion: PASS');
      } else {
        console.log('❌ STAR Story Deletion: FAIL');
      }
    } else {
      console.log('❌ STAR Story CRUD: FAIL');
    }

    // Clean up CV for clean DB state
    deleteCV(testUserId);
    
  } catch (err) {
    console.error('❌ DB Verification Failed with Error:', err.message);
  }
}

testDBCrud();

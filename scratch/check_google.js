import { google } from 'googleapis';
import 'dotenv/config';

async function checkGoogle() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/callback';

  if (!clientId || !clientSecret) {
    console.error('❌ Google / Gmail Client ID or Secret is missing in .env');
    return;
  }

  console.log('Google Client ID:', clientId.slice(0, 15) + '...');
  console.log('Google Client Secret:', clientSecret.slice(0, 5) + '...');
  
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );

  try {
    // Generate Auth URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/gmail.readonly']
    });
    console.log('✅ Auth URL Generated successfully:', authUrl.slice(0, 60) + '...');

    // Try a dummy token exchange with an invalid code to test credentials validity
    // If the credentials are valid, it will throw "invalid_grant" (the authorization code is bad).
    // If the credentials are invalid (Client ID/Secret rejected), it will throw "unauthorized_client" or similar.
    console.log('Sending dummy token exchange to verify credentials with Google...');
    await oauth2Client.getToken('dummy_invalid_code');
  } catch (err) {
    console.log('Response status/message from Google:');
    if (err.message && err.message.includes('invalid_grant')) {
      console.log('✅ SUCCESS: Google OAuth credentials are VALID (rejected invalid code, but credentials accepted).');
    } else {
      console.log('❌ FAIL:', err.message);
    }
  }
}

checkGoogle();

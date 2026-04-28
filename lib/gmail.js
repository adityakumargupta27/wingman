/**
 * lib/gmail.js — Real Gmail API Integration
 */

import { google } from 'googleapis';
import { getGmailToken, saveGmailToken } from './db.js';
import log from './logger.js';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * Get OAuth2 Client
 */
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/callback'
  );
}

/**
 * Generate Auth URL
 */
export function getAuthUrl() {
  const oAuth2Client = getOAuthClient();
  return oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

/**
 * Exchange Code for Tokens
 */
export async function setRefreshToken(discordId, code) {
  const oAuth2Client = getOAuthClient();
  const { tokens } = await oAuth2Client.getToken(code);
  if (tokens.refresh_token) {
    saveGmailToken(discordId, tokens.refresh_token);
    return true;
  }
  return false;
}

/**
 * Scan Inbox for Job Opportunities
 */
export async function scanInbox(discordId) {
  const refreshToken = getGmailToken(discordId);
  if (!refreshToken) throw new Error('NOT_AUTHORIZED');

  const oAuth2Client = getOAuthClient();
  oAuth2Client.setCredentials({ refresh_token: refreshToken });

  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  
  // Search for common job alert patterns
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:("job alert" OR "application received" OR "opening") after:7d',
    maxResults: 10
  });

  const messages = res.data.messages || [];
  const foundJobs = [];

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({ userId: 'me', id: msg.id });
    const snippet = detail.data.snippet;
    const body    = detail.data.payload.parts ? detail.data.payload.parts[0].body.data : detail.data.payload.body.data;
    const decoded = Buffer.from(body || '', 'base64').toString();

    // Look for URLs (simplified)
    const urls = decoded.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const jobUrl = urls.find(u => u.includes('lever.co') || u.includes('greenhouse.io') || u.includes('careers.'));

    if (jobUrl) {
      foundJobs.push({
        snippet,
        url: jobUrl,
        date: new Date(parseInt(detail.data.internalDate)).toISOString()
      });
    }
  }

  return foundJobs;
}

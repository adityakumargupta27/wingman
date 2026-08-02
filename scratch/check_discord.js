import { Client, GatewayIntentBits } from 'discord.js';
import 'dotenv/config';

async function checkDiscord() {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ DISCORD_TOKEN is missing in .env');
    return;
  }
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    console.log('Logging into Discord...');
    await client.login(token);
    console.log('✅ SUCCESS: Discord token is VALID');
    console.log('Logged in as:', client.user.tag);
    console.log('Client ID:', client.user.id);
  } catch (err) {
    console.error('❌ FAIL: Discord login failed:', err.message);
  } finally {
    client.destroy();
  }
}

checkDiscord();

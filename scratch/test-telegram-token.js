import 'dotenv/config';
import fetch from 'node-fetch';

async function main() {
  const token = process.env.TELEGRAM_TOKEN;
  console.log(`Testing token from .env (length: ${token ? token.length : 0})`);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token.trim()}/getMe`);
    const data = await res.json();
    console.log('Result:', data);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();

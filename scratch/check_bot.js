import axios from 'axios';
import 'dotenv/config';

async function checkBot() {
  const token = process.env.TELEGRAM_TOKEN;
  try {
    const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    console.log(JSON.stringify(resp.data, null, 2));
  } catch (err) {
    console.error(err.response?.data || err.message);
  }
}

checkBot();

import axios from 'axios';
import 'dotenv/config';

async function fixBot() {
  const token = process.env.TELEGRAM_TOKEN;
  const baseURL = `https://api.telegram.org/bot${token}`;

  try {
    // 1. Set Name
    console.log("Setting name to 'Wingman AI'...");
    await axios.post(`${baseURL}/setMyName`, { name: "Wingman AI" });

    // 2. Set Description (About)
    console.log("Setting description...");
    await axios.post(`${baseURL}/setMyDescription`, { description: "Your AI Career Intelligence Wingman. Use /scan to find jobs or /pdf to tailor your resume." });

    // 3. Set Short Description (Bio)
    console.log("Setting bio...");
    await axios.post(`${baseURL}/setMyShortDescription`, { short_description: "Your AI Career Intelligence Wingman." });

    console.log("Bot profile updated successfully! ✅");
  } catch (err) {
    console.error("Error fixing bot profile:", err.response?.data || err.message);
  }
}

fixBot();

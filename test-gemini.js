import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = "AIzaSyAje4IwqySZ5h4Ucrwpewb_5zc5Aih9Feg";
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-flash-latest" });

async function test() {
  try {
    const result = await model.generateContent("Hello!");
    console.log("SUCCESS:", result.response.text());
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

test();

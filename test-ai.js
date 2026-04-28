/**
 * test-ai.js — Quick test for AI API key validity (OpenAI/OpenRouter)
 * 
 * Usage: node test-ai.js
 * Reads OPENAI_API_KEY and OPENAI_BASE_URL from .env file
 */

import 'dotenv/config';
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const modelName = process.env.AI_MODEL || 'gpt-4o-mini';

if (!apiKey) {
  console.error('❌ OPENAI_API_KEY not found in .env file');
  process.exit(1);
}

console.log(`🔑 Testing key: ${apiKey.slice(0, 12)}...`);
console.log(`🌐 Base URL: ${baseURL}`);
console.log(`🤖 Model: ${modelName}`);

const openai = new OpenAI({ 
  apiKey, 
  baseURL,
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/adity/wingman',
    'X-Title': 'Wingman Test Script',
  }
});

async function test() {
  try {
    const result = await openai.chat.completions.create({
      model: modelName,
      messages: [{ role: 'user', content: 'Say "Hello from Wingman AI!" and nothing else.' }],
      max_tokens: 20,
    });
    
    console.log('✅ SUCCESS:', result.choices[0]?.message?.content);
  } catch (err) {
    console.error('❌ FAIL:', err.message);

    if (err.status === 401) {
      console.error('\n🔑 Your API key is INVALID.');
    } else if (err.status === 402) {
      console.error('\n💳 Out of credits / Billing issue.');
    } else if (err.status === 404) {
      console.error('\n🤖 Model not found. Check AI_MODEL in .env');
    }
  }
}

test();

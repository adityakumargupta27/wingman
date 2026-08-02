import 'dotenv/config';
import { getCV, saveApplication } from '../lib/db.js';
import { buildEvaluationPrompt } from '../lib/prompt-engine.js';
import { evaluateJD } from '../lib/gemini.js';
import { fetchJobDescription } from '../lib/scraper.js';
import { parseScore } from '../lib/score-parser.js';

async function main() {
  try {
    const cvText = await getCV('test_user_777');
    console.log('CV Text length:', cvText ? cvText.length : 0);
    const jobUrl = 'https://boards.greenhouse.io/stripe/jobs/7954688';
    console.log('Scraping job...');
    const scraped = await fetchJobDescription(jobUrl);
    console.log('Scraped text length:', scraped.text.length);
    
    const systemPrompt = buildEvaluationPrompt(cvText);
    console.log('Calling evaluateJD...');
    const rawResponse = await evaluateJD({ systemPrompt, jdText: scraped.text });
    console.log('Evaluation Response length:', rawResponse ? rawResponse.length : 0);

    console.log('Calling parseScore...');
    const { company, role, score, archetype, legitimacy, rawReport } = parseScore(rawResponse);
    console.log('Parsed company:', company);
    console.log('Parsed role:', role);
    console.log('Parsed score:', score);

    console.log('Calling saveApplication...');
    saveApplication({
      discordId: 'test_user_777',
      company, role, score, archetype, legitimacy,
      jdSnippet: scraped.text.slice(0, 500),
      reportText: rawReport,
    });
    console.log('saveApplication succeeded!');
  } catch (err) {
    console.error('ERROR OCCURRED:', err);
    if (err && err.stack) {
      console.error(err.stack);
    }
  }
}

main();

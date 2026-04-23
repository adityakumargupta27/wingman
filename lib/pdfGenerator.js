import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../');

export async function generatePDF(evaluation, cvMarkdown, outputPath) {
  const company = (evaluation.company || 'Company').replace(/[^a-zA-Z0-9]/g, '-');
  const role = (evaluation.role || 'Role').replace(/[^a-zA-Z0-9]/g, '-');
  const filename = `Aditya-Resume-${company}-${role}.pdf`;
  const fullPath = outputPath || path.join(ROOT, 'output', filename);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const html = generateResumeHTML(evaluation, cvMarkdown || '');
  const tmpHtml = fullPath.replace('.pdf', '.html');
  fs.writeFileSync(tmpHtml, html);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: fullPath,
      format: 'A4',
      margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
      printBackground: true,
    });

    if (fs.existsSync(tmpHtml)) fs.unlinkSync(tmpHtml);
    return { path: fullPath, filename };
  } catch (err) {
    throw new Error(`PDF generation failed: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }
}

function generateResumeHTML(evaluation, cvMarkdown) {
  const role = evaluation.role || 'Software Engineer';
  const company = evaluation.company || 'Target Company';
  const hook = evaluation.cover_letter_hook || '';
  const tailoredSummary = `CS undergraduate at BMSCE with a track record of shipping real products — not just coursework. Built Starvis, a full-stack productivity app with Firebase auth, Gemini AI integration, and native Android deployment. Strong algorithmic fundamentals from competitive programming. Targeting ${role} at ${company}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Aditya - Resume for ${role} @ ${company}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1a1a2e; line-height: 1.5; background: white; }
  .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: white; padding: 20px 30px; }
  .header h1 { font-size: 24px; font-weight: 700; letter-spacing: 1px; }
  .header .title { font-size: 13px; color: #a8d8ea; margin-top: 3px; }
  .contact { display: flex; gap: 20px; margin-top: 8px; font-size: 10px; color: #ccc; flex-wrap: wrap; }
  .contact span::before { content: '• '; color: #0f3460; }
  .contact span:first-child::before { content: ''; }
  .body { padding: 20px 30px; }
  .section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: 700; color: #0f3460; text-transform: uppercase; letter-spacing: 1.5px; border-bottom: 1.5px solid #0f3460; padding-bottom: 3px; margin-bottom: 8px; }
  .summary { font-size: 11px; color: #333; font-style: italic; background: #f8f9ff; padding: 10px 12px; border-left: 3px solid #0f3460; border-radius: 0 4px 4px 0; }
  .job { margin-bottom: 10px; }
  .job-header { display: flex; justify-content: space-between; align-items: baseline; }
  .job-title { font-weight: 700; font-size: 12px; color: #1a1a2e; }
  .job-company { font-size: 11px; color: #0f3460; font-weight: 600; }
  .job-date { font-size: 10px; color: #888; }
  .job ul { margin-top: 4px; padding-left: 14px; }
  .job li { margin-bottom: 2px; color: #333; }
  .footer { margin-top: 16px; text-align: center; font-size: 9px; color: #bbb; border-top: 1px solid #eee; padding-top: 8px; }
</style>
</head>
<body>
<div class="header">
  <h1>ADITYA</h1>
  <div class="title">Software Developer &amp; AI Builder | BMSCE, Bangalore</div>
  <div class="contact">
    <span>aditya@bmsce.ac.in</span>
    <span>Bangalore, India</span>
    <span>github.com/adity</span>
    <span>linkedin.com/in/aditya</span>
  </div>
</div>
<div class="body">
  <div class="section">
    <div class="section-title">PROFESSIONAL SUMMARY</div>
    <div class="summary">${tailoredSummary}</div>
  </div>
  <div class="section">
    <div class="section-title">TECHNICAL PROJECTS</div>
    <div class="job">
      <div class="job-header">
        <span class="job-title">Starvis — AI Productivity Application</span>
        <span class="job-date">2024 – Present</span>
      </div>
      <div class="job-company">Full-Stack Web + Android App | Firebase, Gemini API, Capacitor</div>
      <ul>
        <li>Built and shipped complete productivity platform solo — web + native Android APK from a single codebase</li>
        <li>Integrated Gemini AI API for real-time study assistant with contextual chat functionality</li>
        <li>Implemented Google Sign-In restricted to @bmsce.ac.in domain using Firebase Authentication</li>
        <li>Deployed native Android via Capacitor; built Calendar, Settings pages with responsive mobile-first UI</li>
      </ul>
    </div>
    <div class="job">
      <div class="job-header">
        <span class="job-title">3D Immersive Portfolio Website</span>
        <span class="job-date">2024</span>
      </div>
      <div class="job-company">Three.js, Spline, GSAP, Vanilla JS</div>
      <ul>
        <li>Built interactive 3D portfolio with Japanese ramen shop and cyberpunk aesthetic themes</li>
        <li>Implemented scroll-triggered animations using GSAP and Intersection Observer API</li>
      </ul>
    </div>
    <div class="job">
      <div class="job-header">
        <span class="job-title">Competitive Programming</span>
        <span class="job-date">2022 – Present</span>
      </div>
      <div class="job-company">C++, Algorithmic Problem Solving</div>
      <ul>
        <li>Active on Codeforces; solved problems across DP, graph theory, game theory, binary search</li>
        <li>Derived and implemented Sprague-Grundy theorem solution for complex combinatorial game problem</li>
      </ul>
    </div>
  </div>
  <div class="section">
    <div class="section-title">TECHNICAL SKILLS</div>
    <ul style="list-style: none; padding-left: 0; font-size: 11px;">
      <li style="margin-bottom: 2px;"><strong>Languages:</strong> C++, JavaScript, Python, HTML, CSS</li>
      <li style="margin-bottom: 2px;"><strong>Frontend:</strong> React, Three.js, GSAP, Vanilla JS, Responsive CSS</li>
      <li style="margin-bottom: 2px;"><strong>Backend &amp; DB:</strong> Firebase, Firestore, Node.js, REST APIs</li>
      <li style="margin-bottom: 2px;"><strong>AI / Mobile:</strong> Gemini API, Prompt Engineering, Capacitor, Android Studio</li>
      <li style="margin-bottom: 2px;"><strong>Tools:</strong> Git, GitHub, Playwright, Vite, VS Code, Postman</li>
    </ul>
  </div>
  <div class="section">
    <div class="section-title">Education</div>
    <div class="job">
      <div class="job-header">
        <span class="job-title">BMS College of Engineering (BMSCE)</span>
        <span class="job-date">2022 – 2026 (Expected)</span>
      </div>
      <div class="job-company">B.E. Computer Science &amp; Engineering | Bangalore, India</div>
    </div>
  </div>
</div>
<div class="footer">
  Generated by Wingman | Tailored for ${role} @ ${company} | ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}
</div>
</body>
</html>`;
}


import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const MD_PATH = 'C:/Users/adity/.gemini/antigravity/brain/05353208-6e45-49a9-8775-0c6ce35f5aee/WINGMAN_DOCUMENTATION.md';
const PDF_OUTPUT = 'C:/Users/adity/wingman/WINGMAN_FINAL_BLUEPRINT_CLEAN.pdf';

async function generate() {
  const md = fs.readFileSync(MD_PATH, 'utf8');

  // Clean and Human-styled HTML conversion
  const htmlContent = md
    .replace(/^# (.*$)/gim, '<h1 class="main-title">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 class="section-title">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 class="sub-title">$1</h3>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^\* (.*$)/gim, '<li class="list-item">$1</li>')
    .replace(/^\| (.*) \|/gim, (match) => {
        if (match.includes('---')) return '';
        return `<tr>${match.split('|').filter(s => s.trim()).map(s => `<td>${s.trim()}</td>`).join('')}</tr>`;
    })
    .replace(/```mermaid([\s\S]*?)```/g, '<div class="mermaid">$1</div>')
    .replace(/```javascript([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>')
    .replace(/\n/g, '<br>');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Space+Mono&display=swap" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
      <style>
        :root {
          --primary: #0f172a;
          --accent: #3b82f6;
          --text: #334155;
          --bg: #ffffff;
          --code: #1e293b;
        }
        body { 
          font-family: 'Plus Jakarta Sans', sans-serif; 
          line-height: 2; 
          color: var(--text); 
          padding: 80px; 
          max-width: 850px; 
          margin: auto; 
          background: var(--bg);
          font-size: 16px;
        }
        .main-title { 
          color: var(--primary); 
          font-size: 48px; 
          font-weight: 800;
          letter-spacing: -0.04em;
          margin-bottom: 80px;
          line-height: 1.1;
          text-align: center;
        }
        .section-title { 
          color: var(--primary); 
          font-size: 28px; 
          font-weight: 700;
          margin-top: 100px; 
          border-bottom: 2px solid #e2e8f0;
          padding-bottom: 15px;
          margin-bottom: 40px;
        }
        .sub-title { 
          color: var(--primary); 
          font-size: 20px; 
          font-weight: 600;
          margin-top: 50px; 
        }
        .code-block { 
          background: var(--code); 
          color: #f8fafc;
          padding: 30px; 
          border-radius: 12px; 
          font-family: 'Space Mono', monospace; 
          font-size: 13px; 
          overflow-x: auto; 
          margin: 40px 0;
        }
        .mermaid {
          margin: 40px 0;
          text-align: center;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin: 40px 0; 
        }
        td { 
          border-bottom: 1px solid #e2e8f0; 
          padding: 20px 10px; 
          font-size: 16px; 
        }
        li { margin-bottom: 20px; }
        strong { color: var(--primary); font-weight: 700; }
        .footer { 
          margin-top: 150px; 
          text-align: center; 
          color: #94a3b8; 
          font-size: 12px; 
          border-top: 1px solid #f1f5f9;
          padding-top: 40px;
        }
        @media print {
          .section-title { page-break-before: always; }
          .main-title { page-break-after: always; }
        }
      </style>
      <script>
        mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
      </script>
    </head>
    <body>
      <div style="font-size: 10px; font-weight: 700; color: var(--accent); margin-bottom: 40px; text-align: center;">OFFICIAL PROJECT BLUEPRINT / WINGMAN-AI</div>
      ${htmlContent}
      <div class="footer">
        Authored by Aditya Kumar Gupta • Lead Architecture • Wingman AI Engine<br>
        This document contains proprietary logic and market analysis.
      </div>
    </body>
    </html>
  `;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html);
  
  // Wait for mermaid to render
  await page.waitForTimeout(3000);
  
  await page.pdf({
    path: PDF_OUTPUT,
    format: 'A4',
    margin: { top: '30mm', right: '30mm', bottom: '30mm', left: '30mm' },
    printBackground: true,
    displayHeaderFooter: true,
    footerTemplate: '<div style="font-family: Arial; font-size: 9px; width: 100%; text-align: center; color: #cbd5e1;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    headerTemplate: '<div></div>'
  });

  await browser.close();
  console.log('Final Blueprint with Diagrams Generated at ' + PDF_OUTPUT);
}

generate();

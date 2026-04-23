/**
 * lib/pdfGenerator.js — Dynamic ATS-optimized PDF resume generator
 *
 * Accepts structured resume data (parsed from real CV text) and renders
 * a polished, ATS-friendly PDF via Playwright headless Chromium.
 *
 * The calling command handles AI tailoring — this module only handles
 * parsing, layout, and rendering.
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import log from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../');

// ── PDF Generation ────────────────────────────────────────────────────────────

/**
 * Generate a PDF from structured resume data.
 * @param {object} resumeData - Structured resume (from parseCVText or AI tailoring)
 * @param {string} [outputPath] - Override file output path
 * @returns {{ path: string, filename: string }}
 */
export async function generatePDF(resumeData, outputPath) {
  const company  = (resumeData.targetCompany || 'Company').replace(/[^a-zA-Z0-9]/g, '-');
  const role     = (resumeData.targetRole    || 'Role').replace(/[^a-zA-Z0-9]/g, '-');
  const name     = (resumeData.name          || 'Candidate').replace(/\s+/g, '-');
  const filename = `${name}-Resume-${company}-${role}.pdf`;
  const fullPath = outputPath || path.join(ROOT, 'output', filename);

  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const html     = buildResumeHTML(resumeData);
  const startMs  = performance.now();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: fullPath,
      format: 'A4',
      margin: { top: '18mm', right: '18mm', bottom: '18mm', left: '18mm' },
      printBackground: true,
    });

    const durationMs = Math.round(performance.now() - startMs);
    log.info('PDF generated', { filename, durationMs });
    return { path: fullPath, filename };

  } catch (err) {
    log.error('PDF generation failed', { error: err.message });
    throw new Error(`PDF generation failed: ${err.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// ── CV Text Parser ────────────────────────────────────────────────────────────

/**
 * Parse a plain-text CV into structured sections.
 * Handles diverse formats: bullet lists, section headers, inline contact info.
 * @param {string} cvText - Raw CV text from db
 * @returns {object} Structured resume object
 */
export function parseCVText(cvText) {
  if (!cvText?.trim()) return null;

  const lines = cvText.split('\n').map(l => l.trim()).filter(Boolean);
  const text  = cvText;

  // ── Extract contact info ──────────────────────────────────────────────────
  const name   = lines[0] || 'Candidate';
  const email  = (text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i) || [])[0] || '';
  const github = (() => { const m = text.match(/github\.com\/([^\s/,)>\n]+)/i); return m ? `github.com/${m[1]}` : ''; })();
  const linkedin = (() => { const m = text.match(/linkedin\.com\/in\/([^\s/,)>\n]+)/i); return m ? `linkedin.com/in/${m[1]}` : ''; })();
  const location = (text.match(/\b(Bangalore|Bengaluru|Mumbai|Delhi|Hyderabad|Chennai|Pune|Kolkata|India|Remote)\b/i) || [])[0] || 'India';

  // ── Split into named sections ─────────────────────────────────────────────
  const HEADERS = [
    'summary', 'objective', 'profile', 'about',
    'experience', 'work experience', 'employment',
    'projects', 'technical projects', 'personal projects',
    'skills', 'technical skills', 'technologies', 'tech stack',
    'education', 'academics',
    'achievements', 'certifications', 'awards',
  ];

  const sections = {};
  let currentKey = '_header';
  sections[currentKey] = [];

  for (const line of lines) {
    const normalized = line.toLowerCase().replace(/[^a-z\s]/g, '').trim();
    const matched    = HEADERS.find(h => normalized === h || normalized.startsWith(h));

    if (matched) {
      currentKey = matched.split(' ')[0]; // "technical projects" → "technical"
      sections[currentKey] = [];
    } else {
      if (!sections[currentKey]) sections[currentKey] = [];
      sections[currentKey].push(line);
    }
  }

  // ── Build structured fields ───────────────────────────────────────────────
  const summaryLines = sections.summary || sections.objective || sections.profile || sections.about || [];
  const summary      = summaryLines.join(' ').slice(0, 500);

  const skillLines   = sections.skills || sections.technical || sections.technologies || sections.tech || [];
  const skills       = skillLines.join(' | ').replace(/\|+/g, '|').slice(0, 400) || '';

  const projectLines = sections.projects || sections.personal || [];
  const projects     = parseEntries(projectLines);

  const expLines     = sections.experience || sections.employment || sections.work || [];
  const experience   = parseEntries(expLines);

  const eduLines     = sections.education || sections.academics || [];
  const education    = parseEducation(eduLines);

  return {
    name,
    contact: { email, github, linkedin, location },
    summary,
    skills,
    projects,
    experience,
    education,
  };
}

// ── Section parsers ───────────────────────────────────────────────────────────

function parseEntries(lines) {
  if (!lines?.length) return [];
  const entries = [];
  let current   = null;

  for (const line of lines) {
    const isBullet = /^[•\-\*\d\u2022]/.test(line);
    if (!isBullet && line.length > 4 && line.length < 120) {
      if (current) entries.push(current);
      // Try to extract a date from the end of the line
      const dateMatch = line.match(/(\d{4}\s*[–\-]\s*(?:\d{4}|present|now)|\d{4})/i);
      current = {
        name   : line.replace(dateMatch ? dateMatch[0] : '', '').replace(/[|\-–]+$/, '').trim(),
        date   : dateMatch ? dateMatch[0] : '',
        bullets: [],
      };
    } else if (current && isBullet) {
      current.bullets.push(line.replace(/^[•\-\*\u2022\s]+/, '').trim());
    }
  }

  if (current) entries.push(current);
  return entries.slice(0, 5);
}

function parseEducation(lines) {
  if (!lines?.length) {
    return { institution: '', degree: '', period: '' };
  }
  return {
    institution: lines[0] || '',
    degree     : lines[1] || '',
    period     : lines[2] || '',
  };
}

// ── HTML Template ─────────────────────────────────────────────────────────────

function buildResumeHTML(data) {
  const {
    name           = 'Candidate',
    title          = 'Software Engineer',
    contact        = {},
    summary        = '',
    skills         = '',
    projects       = [],
    experience     = [],
    education      = {},
    targetCompany  = 'Target Company',
    targetRole     = 'Software Engineer',
  } = data;

  const contactItems = [
    contact.email,
    contact.location,
    contact.github    ? `<a href="https://${contact.github}" style="color:#93c5fd">${contact.github}</a>` : null,
    contact.linkedin  ? `<a href="https://${contact.linkedin}" style="color:#93c5fd">${contact.linkedin}</a>` : null,
  ].filter(Boolean);

  const renderEntries = (items, max = 4) => items.slice(0, max).map(e => `
    <div class="entry">
      <div class="entry-header">
        <span class="entry-title">${e.name || ''}</span>
        <span class="entry-date">${e.date || ''}</span>
      </div>
      ${e.tech ? `<div class="entry-sub">${e.tech}</div>` : ''}
      ${e.bullets?.length ? `<ul>${e.bullets.slice(0, 4).map(b => `<li>${b}</li>`).join('')}</ul>` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${name} — ${targetRole} @ ${targetCompany}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Inter',sans-serif; font-size:10px; color:#1e293b; line-height:1.6; background:#fff; -webkit-print-color-adjust: exact; }
  
  /* Layout */
  .header { border-bottom: 2px solid #0f172a; padding: 0 0 12px 0; margin-bottom: 18px; }
  .header-top { display: flex; justify-content: space-between; align-items: flex-end; }
  .header h1 { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.02em; }
  .header .role-title { font-size: 12px; font-weight: 600; color: #334155; margin-top: -2px; }
  
  .contacts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 9px; color: #475569; }
  .contacts a { color: inherit; text-decoration: none; }
  .contacts span::after { content: '•'; margin-left: 10px; color: #cbd5e1; }
  .contacts span:last-child::after { content: ''; }

  .body { display: grid; grid-template-columns: 1fr; gap: 16px; }
  
  .section { margin-bottom: 4px; }
  .section-title { 
    font-size: 9px; 
    font-weight: 700; 
    color: #1e40af; 
    text-transform: uppercase; 
    letter-spacing: 0.1em; 
    border-bottom: 1px solid #e2e8f0; 
    padding-bottom: 2px; 
    margin-bottom: 8px;
    display: flex;
    align-items: center;
  }
  .section-title::after { content: ""; flex: 1; height: 1px; background: #e2e8f0; margin-left: 10px; }

  .summary { font-size: 10px; color: #334155; margin-bottom: 12px; }
  
  .entry { margin-bottom: 10px; page-break-inside: avoid; }
  .entry-header { display: flex; justify-content: space-between; align-items: baseline; }
  .entry-title { font-weight: 700; font-size: 11px; color: #0f172a; }
  .entry-date { font-size: 9px; font-weight: 500; color: #64748b; font-variant-numeric: tabular-nums; }
  .entry-sub { font-size: 10px; color: #1e40af; font-weight: 600; margin-bottom: 2px; }
  
  .entry ul { margin-top: 4px; padding-left: 14px; }
  .entry li { margin-bottom: 2px; color: #334155; font-size: 10px; position: relative; }
  .entry li::marker { color: #94a3b8; font-size: 8px; }
  
  .skills-text { font-size: 10px; color: #334155; line-height: 1.8; }
  .skill-item { display: inline-block; background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 500; margin-right: 4px; margin-bottom: 4px; }

  .footer { margin-top: 20px; text-align: center; font-size: 8px; color: #94a3b8; padding-top: 10px; border-top: 0.5px solid #f1f5f9; }
  .badge { font-weight: 700; color: #1e40af; text-transform: uppercase; }
</style>
</head>
<body>

<div class="header">
  <div class="header-top">
    <h1>${name.toUpperCase()}</h1>
    <div class="role-title">${title}</div>
  </div>
  <div class="contacts">
    ${contactItems.map(c => `<span>${c}</span>`).join('')}
  </div>
</div>

<div class="body">

  ${summary ? `
  <div class="section">
    <div class="section-title">Summary</div>
    <div class="summary">${summary}</div>
  </div>` : ''}

  ${experience.length ? `
  <div class="section">
    <div class="section-title">Experience</div>
    ${renderEntries(experience, 3)}
  </div>` : ''}

  ${projects.length ? `
  <div class="section">
    <div class="section-title">Projects</div>
    ${renderEntries(projects, 4)}
  </div>` : ''}

  ${skills ? `
  <div class="section">
    <div class="section-title">Skills</div>
    <div class="skills-text">
      ${skills.split(/[|,\n]/).map(s => s.trim()).filter(Boolean).map(s => `<span class="skill-item">${s}</span>`).join('')}
    </div>
  </div>` : ''}

  ${education.institution ? `
  <div class="section">
    <div class="section-title">Education</div>
    <div class="entry">
      <div class="entry-header">
        <span class="entry-title">${education.institution}</span>
        <span class="entry-date">${education.period || ''}</span>
      </div>
      ${education.degree ? `<div class="entry-sub">${education.degree}</div>` : ''}
    </div>
  </div>` : ''}

</div>

<div class="footer">
  <span class="badge">✦ Tailored for ${targetRole} at ${targetCompany}</span>
  &nbsp; • &nbsp; Generated by Wingman AI 
  &nbsp; • &nbsp; ${new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })}
</div>

</body>
</html>`;
}

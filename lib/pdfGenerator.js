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
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:10.5px; color:#1e293b; line-height:1.55; background:#fff; }
  .header { background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%); color:#fff; padding:22px 28px 18px; }
  .header h1 { font-size:22px; font-weight:800; letter-spacing:2px; text-transform:uppercase; }
  .header .role { font-size:11px; color:#93c5fd; margin-top:2px; letter-spacing:0.5px; }
  .contacts { display:flex; flex-wrap:wrap; gap:14px; margin-top:8px; font-size:9.5px; color:#cbd5e1; }
  .contacts span::before { content:'◆ '; font-size:7px; color:#60a5fa; }
  .contacts span:first-child::before { content:''; }
  .body { padding:18px 28px; }
  .section { margin-bottom:14px; }
  .section-title { font-size:9px; font-weight:800; color:#1e3a5f; text-transform:uppercase; letter-spacing:2px; border-bottom:2px solid #1e3a5f; padding-bottom:3px; margin-bottom:8px; }
  .summary { font-size:10.5px; color:#334155; font-style:italic; background:#f0f7ff; padding:8px 12px; border-left:3px solid #2563eb; border-radius:0 3px 3px 0; }
  .entry { margin-bottom:9px; }
  .entry-header { display:flex; justify-content:space-between; align-items:baseline; }
  .entry-title { font-weight:700; font-size:10.5px; color:#0f172a; }
  .entry-sub { font-size:9.5px; color:#2563eb; font-weight:600; margin-top:1px; }
  .entry-date { font-size:9px; color:#94a3b8; white-space:nowrap; }
  .entry ul { margin-top:3px; padding-left:12px; }
  .entry li { margin-bottom:2px; color:#334155; font-size:10px; }
  .skills-text { font-size:10px; color:#334155; line-height:1.9; }
  .footer { margin-top:14px; text-align:center; font-size:8px; color:#94a3b8; border-top:1px solid #e2e8f0; padding-top:8px; }
  .badge { display:inline-block; background:#eff6ff; color:#2563eb; font-size:8px; font-weight:700; padding:1px 6px; border-radius:3px; letter-spacing:0.5px; }
</style>
</head>
<body>

<div class="header">
  <h1>${name.toUpperCase()}</h1>
  <div class="role">${title}</div>
  <div class="contacts">
    ${contactItems.map(c => `<span>${c}</span>`).join('')}
  </div>
</div>

<div class="body">

  ${summary ? `
  <div class="section">
    <div class="section-title">Professional Summary</div>
    <div class="summary">${summary}</div>
  </div>` : ''}

  ${projects.length ? `
  <div class="section">
    <div class="section-title">Technical Projects</div>
    ${renderEntries(projects, 4)}
  </div>` : ''}

  ${experience.length ? `
  <div class="section">
    <div class="section-title">Experience</div>
    ${renderEntries(experience, 3)}
  </div>` : ''}

  ${skills ? `
  <div class="section">
    <div class="section-title">Technical Skills</div>
    <div class="skills-text">${skills}</div>
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
  Generated by Wingman &nbsp;·&nbsp;
  <span class="badge">✦ TAILORED FOR ${targetRole.toUpperCase()} @ ${targetCompany.toUpperCase()}</span>
  &nbsp;·&nbsp; ${new Date().toLocaleDateString('en-IN', { year:'numeric', month:'long', day:'numeric' })}
</div>

</body>
</html>`;
}

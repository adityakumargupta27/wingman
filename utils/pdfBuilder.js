/**
 * utils/pdfBuilder.js — Generate ATS-friendly resume PDFs
 * 
 * Produces clean, single-column, serif-font PDFs that pass
 * Applicant Tracking Systems. No tables, no columns, no graphics.
 * 
 * Supports both raw Markdown text and structured JSON responses.
 */

import PDFDocument from 'pdfkit';
import log from '../lib/logger.js';

/**
 * Generates an ATS-friendly PDF buffer from structured resume text.
 * 
 * @param {string} resumeText - The AI-tailored resume content (Markdown or JSON)
 * @returns {Promise<Buffer>} PDF file as a Buffer
 */
export function generateResumePDF(resumeText) {
  return new Promise((resolve, reject) => {
    try {
      // 1. Detect if the input is JSON
      let data = null;
      try {
        const cleaned = resumeText.trim().replace(/^```json\s*|\s*```$/g, '');
        data = JSON.parse(cleaned);
      } catch (e) {
        // Not JSON, proceed with markdown-ish parsing
      }

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 55, right: 55 },
        info: {
          Title: 'ATS-Tailored Resume — Wingman AI',
          Author: 'Wingman Career Intelligence',
        }
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      if (data && data.name) {
        renderJsonResume(doc, data);
      } else {
        renderMarkdownResume(doc, resumeText);
      }

      doc.end();
    } catch (err) {
      log.error('PDF BUILDER ERROR:', { error: err.message, stack: err.stack });
      reject(err);
    }
  });
}

/**
 * Renders a resume from structured JSON data.
 */
function renderJsonResume(doc, data) {
  // 1. Header (Centered)
  doc.fontSize(20).font('Helvetica-Bold').text(data.name, { align: 'center' });
  
  const contact = data.contact || {};
  const contactParts = [
    contact.location,
    contact.phone,
    contact.email,
    contact.linkedin,
    contact.github
  ].filter(Boolean);
  
  doc.fontSize(9).font('Helvetica').fillColor('#333333').text(contactParts.join('  |  '), { align: 'center' });
  doc.moveDown(1);

  // 2. Summary
  renderSectionHeader(doc, 'Professional Summary');
  doc.fontSize(10).font('Helvetica').fillColor('#000000').text(data.summary, { lineGap: 2 });
  doc.moveDown(0.5);

  // 3. Skills
  renderSectionHeader(doc, 'Technical Skills');
  doc.fontSize(10).font('Helvetica').text(data.skills, { lineGap: 2 });
  doc.moveDown(0.5);

  // 4. Experience
  if (data.experience && data.experience.length > 0) {
    renderSectionHeader(doc, 'Professional Experience');
    for (const exp of data.experience) {
      doc.fontSize(11).font('Helvetica-Bold').text(exp.name);
      doc.fontSize(9).font('Helvetica-Oblique').text(exp.date);
      doc.moveDown(0.2);
      for (const bullet of exp.bullets || []) {
        doc.fontSize(10).font('Helvetica').text(`•  ${bullet}`, { indent: 10, lineGap: 2 });
      }
      doc.moveDown(0.5);
    }
  }

  // 5. Projects
  if (data.projects && data.projects.length > 0) {
    renderSectionHeader(doc, 'Key Projects');
    for (const proj of data.projects) {
      doc.fontSize(11).font('Helvetica-Bold').text(`${proj.name}  |  ${proj.tech || ''}`);
      doc.fontSize(9).font('Helvetica-Oblique').text(proj.date || '');
      doc.moveDown(0.2);
      for (const bullet of proj.bullets || []) {
        doc.fontSize(10).font('Helvetica').text(`•  ${bullet}`, { indent: 10, lineGap: 2 });
      }
      doc.moveDown(0.5);
    }
  }

  // 6. Education
  if (data.education) {
    renderSectionHeader(doc, 'Education');
    const edu = data.education;
    doc.fontSize(11).font('Helvetica-Bold').text(edu.institution);
    doc.fontSize(10).font('Helvetica').text(`${edu.degree}  (${edu.period || ''})`);
    if (edu.gpa) doc.fontSize(10).font('Helvetica').text(`GPA: ${edu.gpa}`);
    doc.moveDown(0.5);
  }

  // 7. Analysis (Bottom)
  doc.moveDown(1);
  doc.moveTo(doc.x, doc.y).lineTo(doc.x + 480, doc.y).lineWidth(0.5).stroke('#cccccc');
  doc.moveDown(0.5);
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#666666').text('WINGMAN AI ANALYSIS:');
  doc.fontSize(8).font('Helvetica').text(`✅ MATCHED KEYWORDS: ${(data.atsKeywordsMatched || []).join(', ')}`);
  if (data.atsKeywordsMissing && data.atsKeywordsMissing.length > 0) {
    doc.fontSize(8).font('Helvetica').text(`⚠️ MISSING/GAP KEYWORDS: ${data.atsKeywordsMissing.join(', ')}`);
  }
}

function renderSectionHeader(doc, title) {
  doc.moveDown(0.5);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text(title.toUpperCase());
  doc.moveTo(doc.x, doc.y).lineTo(doc.x + 480, doc.y).lineWidth(0.5).stroke('#333333');
  doc.moveDown(0.4);
}

/**
 * Renders a resume from Markdown-ish text.
 */
function renderMarkdownResume(doc, resumeText) {
  const lines = resumeText.split('\n');

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      doc.moveDown(0.4);
      continue;
    }

    // Section headers
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const heading = trimmed.replace(/^#{2,3}\s*/, '').replace(/\*\*/g, '').trim();
      renderSectionHeader(doc, heading);
      continue;
    }

    // Main title
    if (trimmed.startsWith('# ')) {
      const name = trimmed.replace(/^#\s*/, '').replace(/\*\*/g, '').trim();
      doc.fontSize(18).font('Helvetica-Bold').text(name, { align: 'center' });
      doc.moveDown(0.3);
      continue;
    }

    // Bullet points
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      const bulletContent = trimmed.replace(/^[-•*]\s*/, '');
      const clean = cleanMarkdown(bulletContent);
      doc.fontSize(10).font('Helvetica').text(`•  ${clean}`, { indent: 10, lineGap: 2 });
      continue;
    }

    // Bold lines
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      const boldText = trimmed.replace(/\*\*/g, '').trim();
      doc.fontSize(10.5).font('Helvetica-Bold').text(boldText);
      continue;
    }

    // Regular text
    const cleanText = cleanMarkdown(trimmed);
    doc.fontSize(10).font('Helvetica').text(cleanText, { lineGap: 2 });
  }
}

function cleanMarkdown(text) {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/__/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/`/g, '')
    .trim();
}

import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import log from '../lib/logger.js';

export async function generateResumeWord(resumeText) {
  try {
    let data = null;
    try {
      const cleaned = resumeText.trim().replace(/^```json\s*|\s*```$/g, '');
      data = JSON.parse(cleaned);
    } catch (e) {
      // Handle fallback to markdown if needed
    }

    if (data && data.name) {
      return await renderJsonWord(data);
    } else {
      return await renderMarkdownWord(resumeText);
    }
  } catch (err) {
    log.error('WORD BUILDER ERROR:', { error: err.message, stack: err.stack });
    throw err;
  }
}

async function renderJsonWord(data) {
  const children = [];

  // 1. Header
  children.push(new Paragraph({
    text: data.name,
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
  }));

  const contact = data.contact || {};
  const contactParts = [
    contact.location,
    contact.phone,
    contact.email,
    contact.linkedin,
    contact.github
  ].filter(Boolean);

  children.push(new Paragraph({
    children: [new TextRun({ text: contactParts.join('  |  '), size: 20 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 }
  }));

  // 2. Summary
  children.push(createSectionHeader('Professional Summary'));
  children.push(new Paragraph({
    children: [new TextRun({ text: data.summary, size: 22 })],
    spacing: { after: 200 }
  }));

  // 3. Skills
  children.push(createSectionHeader('Technical Skills'));
  children.push(new Paragraph({
    children: [new TextRun({ text: data.skills, size: 22 })],
    spacing: { after: 200 }
  }));

  // 4. Experience
  if (data.experience && data.experience.length > 0) {
    children.push(createSectionHeader('Professional Experience'));
    for (const exp of data.experience) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: exp.name, bold: true, size: 24 }),
          new TextRun({ text: `  |  ${exp.date}`, italics: true, size: 20 }),
        ],
        spacing: { before: 100 }
      }));
      for (const bullet of exp.bullets || []) {
        children.push(new Paragraph({
          text: bullet,
          bullet: { level: 0 },
          style: 'ListParagraph',
        }));
      }
      children.push(new Paragraph({ text: '' })); // Spacing
    }
  }

  // 5. Projects
  if (data.projects && data.projects.length > 0) {
    children.push(createSectionHeader('Key Projects'));
    for (const proj of data.projects) {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${proj.name}  |  ${proj.tech || ''}`, bold: true, size: 24 }),
          new TextRun({ text: `  |  ${proj.date || ''}`, italics: true, size: 20 }),
        ],
        spacing: { before: 100 }
      }));
      for (const bullet of proj.bullets || []) {
        children.push(new Paragraph({
          text: bullet,
          bullet: { level: 0 },
          style: 'ListParagraph',
        }));
      }
      children.push(new Paragraph({ text: '' }));
    }
  }

  // 6. Education
  if (data.education) {
    children.push(createSectionHeader('Education'));
    const edu = data.education;
    children.push(new Paragraph({
      children: [
        new TextRun({ text: edu.institution, bold: true, size: 24 }),
      ],
      spacing: { before: 100 }
    }));
    const eduDetails = [new TextRun({ text: `${edu.degree}  (${edu.period || ''})`, size: 22 })];
    if (edu.gpa) {
      eduDetails.push(new TextRun({ text: `  |  GPA: ${edu.gpa}`, size: 22 }));
    }
    children.push(new Paragraph({
      children: eduDetails,
      spacing: { after: 200 }
    }));
  }

  // 7. Analysis (Bottom)
  children.push(new Paragraph({
    children: [
      new TextRun({ text: 'WINGMAN AI ANALYSIS:', bold: true, color: '666666', size: 16 }),
    ],
    spacing: { before: 400 }
  }));
  children.push(new Paragraph({
    children: [
      new TextRun({ text: `✅ MATCHED KEYWORDS: ${(data.atsKeywordsMatched || []).join(', ')}`, size: 16 })
    ]
  }));
  if (data.atsKeywordsMissing && data.atsKeywordsMissing.length > 0) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `⚠️ MISSING/GAP KEYWORDS: ${data.atsKeywordsMissing.join(', ')}`, size: 16 })
      ]
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: children,
    }],
  });

  return await Packer.toBuffer(doc);
}

function createSectionHeader(title) {
  return new Paragraph({
    children: [new TextRun({ text: title.toUpperCase(), bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    border: {
      bottom: { color: "auto", space: 1, value: "single", size: 6 }
    },
    spacing: { before: 200, after: 100 }
  });
}

async function renderMarkdownWord(resumeText) {
  const children = [];
  const lines = resumeText.split('\n');

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      const heading = trimmed.replace(/^#{2,3}\s*/, '').replace(/\*\*/g, '').trim();
      children.push(createSectionHeader(heading));
      continue;
    }

    if (trimmed.startsWith('# ')) {
      const name = trimmed.replace(/^#\s*/, '').replace(/\*\*/g, '').trim();
      children.push(new Paragraph({
        text: name,
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }));
      continue;
    }

    if (trimmed.startsWith('- ') || trimmed.startsWith('• ') || trimmed.startsWith('* ')) {
      const bulletContent = trimmed.replace(/^[-•*]\s*/, '');
      const clean = cleanMarkdown(bulletContent);
      children.push(new Paragraph({
        text: clean,
        bullet: { level: 0 },
        style: 'ListParagraph',
      }));
      continue;
    }

    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      const boldText = trimmed.replace(/\*\*/g, '').trim();
      children.push(new Paragraph({
        children: [new TextRun({ text: boldText, bold: true, size: 22 })]
      }));
      continue;
    }

    const cleanText = cleanMarkdown(trimmed);
    children.push(new Paragraph({
      children: [new TextRun({ text: cleanText, size: 22 })]
    }));
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: children,
    }],
  });

  return await Packer.toBuffer(doc);
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

# ATS Resume Tailor v2

## Purpose
Rewrite a candidate's resume to maximize ATS pass rate and recruiter engagement for a specific role. Output structured JSON for PDF generation.

## Constraints
- Stay 100% truthful to original experience. Never fabricate.
- Reframe, don't invent. Emphasize what's relevant, de-emphasize what isn't.
- Mirror JD keywords exactly where candidate has the skill.
- If candidate lacks a required skill, do NOT add it. Note it as a gap.
- Output MUST be valid JSON. No markdown, no commentary outside the JSON block.

## Expected Input
- Original CV text (provided as user message)
- Target company name (via {{company}})
- Target role title (via {{role}})
- Job description text (via {{jd}})

## Process
1. Extract candidate identity (name, contact, education) from CV
2. Identify JD's top 10 keywords/requirements
3. Map candidate experience to JD requirements
4. Rewrite summary emphasizing relevance
5. Select and rewrite top 4 projects (JD-keyword-optimized)
6. Select and rewrite top 3 experiences (impact-focused)
7. Order skills by JD relevance
8. Output as structured JSON

## Output Schema

```json
{
  "name": "Full Name",
  "contact": {
    "email": "email@example.com",
    "phone": "optional",
    "github": "github.com/username",
    "linkedin": "linkedin.com/in/username",
    "location": "City, Country",
    "portfolio": "optional"
  },
  "title": "Targeted Professional Title",
  "summary": "2-3 sentence summary tailored to this specific role. Mirror JD language.",
  "skills": "Skill1 | Skill2 | Skill3 | ... (ordered by JD relevance)",
  "projects": [
    {
      "name": "Project Name",
      "date": "2024",
      "tech": "React, Node.js, PostgreSQL",
      "bullets": [
        "Action verb + what you did + quantified result + tech used",
        "Second bullet with different dimension of impact"
      ]
    }
  ],
  "experience": [
    {
      "name": "Company — Role Title",
      "date": "Jan 2023 – Present",
      "bullets": [
        "Action verb + responsibility + measurable outcome",
        "Second bullet"
      ]
    }
  ],
  "education": {
    "institution": "University Name",
    "degree": "Degree and Major",
    "period": "2020–2024",
    "gpa": "optional — include only if 3.5+"
  },
  "certifications": ["Cert 1", "Cert 2"],
  "targetCompany": "{{company}}",
  "targetRole": "{{role}}",
  "atsKeywordsMatched": ["keyword1", "keyword2"],
  "atsKeywordsMissing": ["keyword3"]
}
```

## Anti-Hallucination Rules
- Every project and experience MUST come from the original CV
- Never add skills the candidate doesn't have
- Never fabricate metrics — use "improved" without numbers if originals lack data
- If education section is missing from CV, set to null
- atsKeywordsMissing shows honest gaps

## Fallback
- If CV text is empty/unreadable: return `{"error": "CV text could not be parsed"}`
- If JD is empty: tailor for general role without JD-specific keywords

## Token Budget
Target: 800-1200 tokens. JSON only, no prose wrapper.

# Opportunity Discovery Engine v2

## Purpose
Given a candidate's profile, identify specific real companies and roles they should target. Map beyond literal job titles using related-role expansion.

## Constraints
- Only recommend companies known to exist and hire
- Do not invent job URLs — provide career page patterns instead
- Expand search beyond literal keywords using role mapping
- Rank by realistic hiring probability, not aspiration

## Expected Input
- Candidate CV (via {{cvText}})
- Search keyword or target area (via {{keyword}})

## Role Mapping Rules
Before searching, expand the keyword:
- "Frontend" → Frontend, UI Engineer, Design Engineer, Product Engineer, Full-Stack
- "Backend" → Backend, Platform Engineer, API Developer, Cloud Engineer, SRE
- "Data" → Data Analyst, Data Engineer, ML Engineer, BI Analyst, Analytics Engineer
- "AI/ML" → ML Engineer, AI Engineer, LLMOps, Applied Scientist, Research Engineer
- "DevOps" → DevOps, SRE, Platform Engineer, Cloud Infrastructure, Release Engineer

## Output Format

Return ONLY a valid JSON array. No markdown wrapper, no commentary.

```json
[
  {
    "company": "Company Name",
    "role": "Specific Role Title",
    "type": "Full-Time | Internship | Contract",
    "location": "City, Country | Remote | Hybrid",
    "apply_at": "careers.company.com or specific ATS URL pattern",
    "match_score": 8.5,
    "why": "2-sentence specific reason this is a strong match",
    "mapped_from": "Original keyword that led to this match",
    "priority": "High | Medium | Low"
  }
]
```

Return 5-7 results, ordered by match_score descending.

## Anti-Hallucination Rules
- Only recommend companies that are real and known to hire for tech roles
- Do not fabricate specific job listing URLs
- Use career page patterns: "careers.stripe.com", not fake deep links
- If candidate's CV is weak for the keyword, say so in the "why" field
- match_score must reflect realistic hiring probability

## Fallback
If CV missing: return general recommendations with note in "why" field: "General match — upload CV for personalized scoring"
If keyword too vague: return empty array with comment

## Token Budget
Target: 500-800 tokens. JSON only.

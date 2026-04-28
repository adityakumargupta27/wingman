# Interview Generator v2

## Purpose
Generate role-specific interview questions with answer frameworks. Cover behavioral, technical, and culture-fit dimensions.

## Constraints
- Questions must be realistic — things actually asked in interviews
- Answer hints reference candidate's specific background when CV is available
- Technical questions must match the role's actual stack
- Do not generate generic questions like "tell me about yourself" unless framed with specific guidance

## Expected Input
- Target role (user message)
- Candidate CV (in system context via {{cvText}})
- Story bank (in system context via {{stories}} if available)

## Output Format

🎤 INTERVIEW PREP: <Role Title>

📋 BEHAVIORAL (3 questions)
For each:
Q: <realistic behavioral question>
💡 Approach: <which story/experience from CV to use + STAR framework hint>

🔧 TECHNICAL (3 questions)
For each:
Q: <technical question matching role stack>
💡 Key points: <2-3 concepts to cover in answer>

🤝 CULTURE FIT (2 questions)
For each:
Q: <culture/values question>
💡 Approach: <what they're really evaluating + how to answer>

❓ QUESTIONS TO ASK THEM (2 questions)
For each:
Q: <smart question that signals competence>
Why: <what this reveals about the company/role>

🎯 PREPARATION CHECKLIST
- [ ] Research company's recent product launches
- [ ] Prepare 2 stories using STAR format
- [ ] Review technical fundamentals for <specific topic>
- [ ] Prepare salary range based on market research

## Anti-Hallucination Rules
- Technical questions must match the stated role (don't ask React questions for a backend role)
- If CV not available, generate general questions with note: "Upload your CV for personalized answer strategies"
- Never guarantee "this will be asked"
- Frame as "commonly asked" or "likely topics"

## Fallback
If role is too vague: "Specify the role title and company type (startup/enterprise/FAANG) for targeted questions."

## Token Budget
Target: 700-1000 tokens.

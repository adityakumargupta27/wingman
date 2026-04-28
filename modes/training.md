# Skill Gap Analyzer + 30-Day Roadmap v2

## Purpose
Identify the specific gaps between a candidate's current skills and their target role, then generate a concrete 30-day learning plan to close them.

## Constraints
- Only identify gaps that actually matter for the target role
- Recommend free/low-cost resources when possible
- Each week must have a deliverable proof-of-work
- Do not recommend "learn everything" — prioritize by impact on hiring probability
- Be realistic about what can be learned in 30 days

## Expected Input
- Candidate CV (via {{cvText}})
- Target role (via {{role}})
- Company type (via {{company_type}}: Startup / Enterprise / FAANG / Agency)

## Output Format

🎯 TARGET ANALYSIS
Role: <role>
Company Type: <type>
Current Readiness: x/10

🔴 CRITICAL GAPS (Must fix — will get rejected without these)
1. <Skill> — Why it matters for this role
2. <Skill> — Why it matters
3. <Skill> — Why it matters

🟡 NICE-TO-HAVE GAPS (Improves odds but not blocking)
1. <Skill>
2. <Skill>

✅ STRENGTHS TO LEVERAGE
3 skills candidate already has that are strong for this role.

📅 30-DAY ROADMAP

Week 1: Foundation
- Goal: <specific deliverable>
- Learn: <specific topic>
- Build: <specific mini-project>
- Time: ~X hours

Week 2: Core Skill
- Goal: <specific deliverable>
- Learn: <specific topic>
- Build: <specific project addition>
- Time: ~X hours

Week 3: Applied Practice
- Goal: <specific deliverable>
- Build: <portfolio-worthy project that demonstrates gap skills>
- Time: ~X hours

Week 4: Interview Ready
- Goal: <specific deliverable>
- Practice: <specific interview prep>
- Resume update: <what to add>
- Time: ~X hours

🏆 PROOF POINTS
After completing this roadmap, candidate can add these to their resume:
- Bullet 1
- Bullet 2
- Bullet 3

## Anti-Hallucination Rules
- Only reference real technologies and frameworks
- Do not recommend specific paid courses by name unless widely known
- Time estimates must be realistic (not "learn Kubernetes in 2 hours")
- If target role is unclear, ask for clarification

## Fallback
If CV is missing: provide generic roadmap for the role with note "Upload your CV for personalized gap analysis"

## Token Budget
Target: 700-1000 tokens.

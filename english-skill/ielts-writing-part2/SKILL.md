---
name: ielts-writing-part2
description: Generate banded sample essays (6.0 / 7.0 / 8.0 / 9.0, three per band, like three different candidates) for an IELTS Writing Task 2 question, following real Task 2 exam rules. MANUAL TRIGGER ONLY — never activate this skill automatically; use it only when the user explicitly invokes it by name (e.g. "use the ielts-writing-part2 skill") and provides an essay question.
disable-model-invocation: true
---

# 1 IELTS Writing Task 2 Banded Essays

## 1.1 Purpose
Given a single IELTS Writing Task 2 question (the statement plus the instruction, e.g. "To what extent do you agree or disagree?", "Discuss both views and give your own opinion.", "What are the causes and what solutions can you suggest?"), produce **three different sample essays for each band** — 6.0, 7.0, 8.0, and 9.0 — as if written by three different candidates at that level (12 essays total).

## 1.2 Trigger rule
- This skill is **manual-trigger only**. Do not run it unless the user explicitly invokes it.

## 1.3 Input
- The user supplies the essay question text. Store it in a variable: `{{ESSAY_QUESTION}}`.
- If `{{ESSAY_QUESTION}}` is missing, ask the user for it and do nothing else.
- If the instruction line is missing (only a statement is given), treat it as an agree/disagree question; do not add a visible instruction line to the output.

## 1.4 Context isolation (mandatory)
- When executing this skill, **ignore all conversation context outside the skill invocation**. Treat `{{ESSAY_QUESTION}}` as the only input. Do not let earlier messages, prior answers, user preferences, or previous topics influence the output in any way.

## 1.5 IELTS Writing Task 2 exam rules (essays must conform to these)
- Task 2 asks for a **formal discursive essay of at least 250 words**, with about 40 minutes available.
- A well-judged essay is roughly **260–330 words**. Noticeably shorter is penalised; much longer is unrealistic within exam time and invites errors.
- The essay must **answer every part of the question** (both views if asked, causes AND solutions if asked, a clear position where an opinion is required) and maintain that position consistently through to the conclusion.
- Standard structure: an **introduction** that paraphrases the question and (where required) states a position, **two or three body paragraphs** each built around one central idea with explanation and a specific example, and a **conclusion** that restates the position/summary — never introduces new ideas.
- Register is **formal academic English**: no contractions, no conversational asides, no rhetorical gimmicks; examples may be personal-adjacent but framed formally ("many employees", not "my friend Tom" at higher bands).

## 1.6 Band-differentiating features
| Band | Task response & organization | Vocabulary | Grammar |
|------|------------------------------|------------|---------|
| 6.0 | Addresses the question but development is uneven — one idea thin or under-explained; position present but at times mechanical; formulaic linkers used prominently (Firstly, On the other hand, In conclusion); some repetition of the question's own wording; examples generic or slightly vague | Adequate but repetitive range; some imprecise word choice or wrong collocation ("make a research"); occasional inappropriate informality | Mix of simple and complex sentences; attempted complexity brings noticeable but non-impeding errors (articles, tense, word form) — acceptable to simulate |
| 7.0 | All parts of the question addressed; clear position throughout; each body paragraph has one extended, supported main idea; linking is varied and mostly natural | Sufficient range with some less-common items and awareness of style/collocation; occasional slightly awkward choice | Variety of complex structures; frequent error-free sentences; a few slips |
| 8.0 | Well-developed response with fully extended, well-supported ideas; skilful sequencing; paragraphing serves the argument rather than a template; concessions handled deftly | Wide, fluent, precise range (a double-edged sword used judiciously, disproportionately affects); rare inaccuracy | Wide range used flexibly and accurately; only occasional minor slips |
| 9.0 | Fully developed position with compelling, nuanced argumentation; cohesion invisible — the argument simply flows; nothing formulaic | Precise, natural, sophisticated throughout; effortless hedging and nuance | Full range with complete accuracy and naturalness |

The three essays within the same band must read like **three different test-takers**: different positions or emphases where the question allows it (agree vs. disagree vs. partial), different main ideas and examples, different paragraph plans and wording — never paraphrases of one another. All three must still clearly sit at the same band level.

## 1.7 Output rules
- Output exactly twelve blockquotes in ascending band order, three per band. Each blockquote contains one complete essay as flowing prose paragraphs (no headings or bullet lists inside).
- **Paragraph breaks (mandatory)**: each essay keeps its real paragraph structure (introduction / body paragraphs / conclusion) with ONE blank line between paragraphs. Each paragraph stays on a single line — do not insert any line breaks within a paragraph.
- Wrap the entire output in a single fenced code block (```) so the raw `<blockquote>` tags are shown as-is instead of being rendered.
- Follow the output format strictly and output nothing else: no intro or closing remarks, no headings, no explanations, no extra text before or after the code block — the response must consist of the code block alone.

## 1.8 Output example

```
<blockquote data-score="6.0">
[candidate 1's 6.0 essay]
</blockquote>

<blockquote data-score="6.0">
[candidate 2's 6.0 essay]
</blockquote>

<blockquote data-score="6.0">
[candidate 3's 6.0 essay]
</blockquote>

<blockquote data-score="7.0">
[candidate 1's 7.0 essay]
</blockquote>

... (same pattern through 7.0, 8.0, and 9.0)

<blockquote data-score="9.0">
[candidate 3's 9.0 essay]
</blockquote>
```

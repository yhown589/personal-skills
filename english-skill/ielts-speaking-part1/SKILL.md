---
name: ielts-speaking-part1
description: Generate banded sample answers (6.0 / 7.0 / 8.0 / 9.0, three per band, like three different candidates) for an IELTS Speaking Part 1 question, following real Part 1 exam rules. MANUAL TRIGGER ONLY — never activate this skill automatically; use it only when the user explicitly invokes it by name (e.g. "use the ielts-part1-answers skill") and provides a question.
disable-model-invocation: true
---

# 1 IELTS Speaking Part 1 Banded Answers

## 1.1 Purpose
Given a single IELTS Speaking Part 1 question, produce **three different sample answers for each band** — 6.0, 7.0, 8.0, and 9.0 — as if given by three different candidates at that level (12 answers total).

## 1.2 Trigger rule
- This skill is **manual-trigger only**. Do not run it unless the user explicitly invokes it.

## 1.3 Input
- The user supplies the question text. Store it in a variable: `{{QUESTION}}`.
- If `{{QUESTION}}` is missing, ask the user for it and do nothing else.

## 1.4 Context isolation (mandatory)
- When executing this skill, **ignore all conversation context outside the skill invocation**. Treat `{{QUESTION}}` as the only input. Do not let earlier messages, prior answers, user preferences, or previous topics influence the output in any way.

## 1.5 IELTS Speaking Part 1 exam rules (answers must conform to these)
- Part 1 lasts **4–5 minutes** in total and covers **about 3 familiar topics**, with **3–4 questions per topic** (roughly 10–12 questions overall).
- Each question therefore gets only **20–30 seconds of speaking time**; the examiner will interrupt answers that run long.
- A well-timed answer is **3–4 sentences, roughly 40–60 words** — a direct answer plus one or two supporting reasons/details. One-sentence answers are too short; mini-speeches are too long.
- Register is **conversational and personal** (first person, everyday life topics), never essay-like or memorized-sounding.

## 1.6 Band-differentiating features
| Band | Fluency & tone | Vocabulary | Grammar |
|------|----------------|------------|---------|
| 6.0 | Clear but slightly stiff; simple connectors (and, so, because); may hesitate | Common everyday words; some repetition | Mostly simple sentences; occasional minor errors are acceptable to simulate |
| 7.0 | More natural flow; discourse markers (you know, I'd say, also) | Some less-common words and collocations | Mix of simple and complex sentences, generally accurate |
| 8.0 | Fluent and relaxed; ideas developed with a specific detail or personal example | Idiomatic collocations used naturally (e.g. "a must-have", "part of my routine") | Wide range, flexible, only rare slips |
| 9.0 | Fully native-like rhythm; natural fillers and asides ("Oh, for sure —") | Precise, idiomatic, effortless (e.g. "second nature", "do wonders") | Full range used with complete naturalness |

The three answers within the same band must read like **three different test-takers**: different stances or angles (e.g. yes / it depends / mostly no), different reasons, different personal examples, different sentence openings and wording — never paraphrases of one another. All three must still clearly sit at the same band level.

## 1.7 Output rules
- Output exactly twelve blockquotes in ascending band order, three per band.
- Wrap the entire output in a single fenced code block (```) so the raw `<blockquote>` tags are shown as-is instead of being rendered.
- Follow the output format strictly and output nothing else: no intro or closing remarks, no headings, no explanations, no extra text before or after the code block — the response must consist of the code block alone.

## 1.8 Output example

```
<blockquote data-score="6.0">
[candidate 1's 6.0 answer]
</blockquote>

<blockquote data-score="6.0">
[candidate 2's 6.0 answer]
</blockquote>

<blockquote data-score="6.0">
[candidate 3's 6.0 answer]
</blockquote>

<blockquote data-score="7.0">
[candidate 1's 7.0 answer]
</blockquote>

... (same pattern through 7.0, 8.0, and 9.0)

<blockquote data-score="9.0">
[candidate 3's 9.0 answer]
</blockquote>
```
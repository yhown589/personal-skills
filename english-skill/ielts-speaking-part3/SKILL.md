---
name: ielts-speaking-part3
description: Generate banded sample answers (6.0 / 7.0 / 8.0 / 9.0, three per band, like three different candidates) for an IELTS Speaking Part 3 discussion question, following real Part 3 exam rules. MANUAL TRIGGER ONLY — never activate this skill automatically; use it only when the user explicitly invokes it by name (e.g. "use the ielts-speaking-part3 skill") and provides a question.
disable-model-invocation: true
---

# 1 IELTS Speaking Part 3 Banded Answers

## 1.1 Purpose
Given a single IELTS Speaking Part 3 discussion question, produce **three different sample answers for each band** — 6.0, 7.0, 8.0, and 9.0 — as if given by three different candidates at that level (12 answers total).

## 1.2 Trigger rule
- This skill is **manual-trigger only**. Do not run it unless the user explicitly invokes it.

## 1.3 Input
- The user supplies the question text. Store it in a variable: `{{QUESTION}}`.
- If `{{QUESTION}}` is missing, ask the user for it and do nothing else.

## 1.4 Context isolation (mandatory)
- When executing this skill, **ignore all conversation context outside the skill invocation**. Treat `{{QUESTION}}` as the only input. Do not let earlier messages, prior answers, user preferences, or previous topics influence the output in any way.

## 1.5 IELTS Speaking Part 3 exam rules (answers must conform to these)
- Part 3 is a **two-way discussion** lasting 4–5 minutes, with abstract, general questions that develop the Part 2 topic (society-level trends, comparisons, causes, effects, predictions, opinions).
- Each question gets roughly **40–60 seconds of speaking time**; the examiner will move on or probe further after that.
- A well-timed answer is **4–6 sentences, roughly 70–110 words**: a clear position or generalization, one or two reasons or an example, and often a brief concession, contrast, or qualification. One-line answers are too thin; prepared-speech length is too long.
- Register is **discursive and impersonal-leaning**: the candidate talks about people in general, society, or trends (using "people", "most of us", "in my country") rather than only personal anecdotes, though a brief personal illustration is fine. It must still sound spoken, never essay-like or memorized.

## 1.6 Band-differentiating features
| Band | Fluency & argumentation | Vocabulary | Grammar |
|------|-------------------------|------------|---------|
| 6.0 | Gives an opinion with one reason; development is a bit thin or repetitive; simple connectors (because, but, so, for example); may hesitate on abstract points | Common everyday words; struggles slightly for topic-specific terms | Mostly simple sentences with some complex attempts; occasional minor errors are acceptable to simulate |
| 7.0 | Develops the point logically with a reason and an example; discourse markers (I'd say, on the other hand, in general); handles the abstract level comfortably | Some less-common words and collocations (e.g. "peer pressure", "a growing trend") | Mix of simple and complex sentences, generally accurate; conditionals and comparisons used |
| 8.0 | Nuanced position with a concession or a distinction between cases ("it depends on...", "the flip side is..."); speculates and generalizes with ease | Idiomatic and precise (e.g. "a double-edged sword", "keep up with the times") | Wide range, flexible, only rare slips |
| 9.0 | Fully native-like discussion: effortless hedging, weighing of viewpoints, and a crisp takeaway; sounds like thinking aloud, fluently | Precise, idiomatic, effortless (e.g. "there's a fine line between...", "it boils down to...") | Full range used with complete naturalness |

The three answers within the same band must read like **three different test-takers**: different positions or emphases (e.g. agree / it depends / largely disagree), different reasons and examples, different sentence openings and wording — never paraphrases of one another. All three must still clearly sit at the same band level.

## 1.7 Output rules
- Output exactly twelve blockquotes in ascending band order, three per band.
- **Semantic line breaks (mandatory)**: never put an entire answer on a single line. After generating the text, insert line breaks at semantically natural points (e.g. between the main position, the supporting reasons/example, and a concession or wrap-up), so the answer spans multiple lines. Use a plain newline only — do NOT leave blank lines between the lines. As a rough guide, start a new line every 2–3 sentences when the sentences are long, or every 3–4 sentences when they are short — but semantic coherence takes priority over these counts; do not enforce them mechanically.
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

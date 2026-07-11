---
name: ielts-speaking-part2
description: Generate banded sample answers (6.0 / 7.0 / 8.0 / 9.0, three per band, like three different candidates) for an IELTS Speaking Part 2 cue card, following real Part 2 exam rules. MANUAL TRIGGER ONLY — never activate this skill automatically; use it only when the user explicitly invokes it by name (e.g. "use the ielts-speaking-part2 skill") and provides a cue card.
disable-model-invocation: true
---

# 1 IELTS Speaking Part 2 Banded Answers

## 1.1 Purpose
Given a single IELTS Speaking Part 2 cue card (topic plus its "You should say:" bullet points), produce **three different sample answers for each band** — 6.0, 7.0, 8.0, and 9.0 — as if given by three different candidates at that level (12 answers total).

## 1.2 Trigger rule
- This skill is **manual-trigger only**. Do not run it unless the user explicitly invokes it.

## 1.3 Input
- The user supplies the cue card text (the topic line and, if present, the bullet points). Store it in a variable: `{{CUE_CARD}}`.
- If `{{CUE_CARD}}` is missing, ask the user for it and do nothing else.
- If only a topic line is given without bullet points, answer the topic directly; do not invent visible bullet points in the output.

## 1.4 Context isolation (mandatory)
- When executing this skill, **ignore all conversation context outside the skill invocation**. Treat `{{CUE_CARD}}` as the only input. Do not let earlier messages, prior answers, user preferences, or previous topics influence the output in any way.

## 1.5 IELTS Speaking Part 2 exam rules (answers must conform to these)
- Part 2 is the **long turn**: the candidate gets 1 minute to prepare notes, then must speak for **1–2 minutes without interruption**; the examiner stops them at 2 minutes.
- A well-timed answer is a **continuous monologue of roughly 180–260 words** (about 12–20 sentences). Noticeably shorter reads as under-length; much longer would have been cut off.
- The answer should **cover every bullet point on the cue card** (naturally woven in, not announced one by one) and tell a coherent, personal story or description with a clear beginning and a natural wrap-up.
- Register is **conversational and personal** (first person, storytelling tone), never essay-like or memorized-sounding. Natural self-corrections, asides, and time-buying phrases are realistic at all bands.

## 1.6 Band-differentiating features
| Band | Fluency & organization | Vocabulary | Grammar |
|------|------------------------|------------|---------|
| 6.0 | Willing to keep going but noticeably listy; follows the bullets mechanically; simple connectors (and then, so, because); some repetition and fillers (um, like); may run slightly short (~150–180 words) | Common everyday words; occasional word searching or slightly-off word choice | Mostly simple sentences with some attempted complex ones; occasional minor errors are acceptable to simulate |
| 7.0 | Flows as a story rather than a checklist; discourse markers (actually, to be honest, what I remember most is); at ease across the full 2 minutes | Some less-common words and good collocations; occasional paraphrase when a word is missing | Mix of simple and complex sentences, generally accurate |
| 8.0 | Engaging narrative with vivid specific details, a small digression brought back on track, and a reflective ending | Idiomatic collocations used naturally (e.g. "spur of the moment", "it really stuck with me") | Wide range, flexible, only rare slips |
| 9.0 | Fully native-like storytelling rhythm; effortless pacing, humor or emotion where natural, seamless transitions | Precise, idiomatic, effortless (e.g. "off the beaten track", "a once-in-a-lifetime thing") | Full range used with complete naturalness |

The three answers within the same band must read like **three different test-takers**: different subjects chosen for the cue card (a different trip, person, object, event...), different details and emotions, different structures and wording — never paraphrases of one another. All three must still clearly sit at the same band level.

## 1.7 Output rules
- Output exactly twelve blockquotes in ascending band order, three per band. Each blockquote contains one complete monologue as flowing prose (no headings or bullet lists inside).
- **Semantic line breaks (mandatory)**: never put an entire monologue on a single line. After generating the text, insert line breaks at semantically natural points (a shift in scene, time, topic, or from narration to reflection), so the monologue spans multiple paragraphs. Leave a blank line between them so each block reads as its own paragraph. As a rough guide, start a new paragraph every 2–3 sentences when the sentences are long, or every 3–4 sentences when they are short — but semantic coherence takes priority over these counts; do not enforce them mechanically.
- Wrap the entire output in a single fenced code block (```) so the raw `<blockquote>` tags are shown as-is instead of being rendered.
- Follow the output format strictly and output nothing else: no intro or closing remarks, no headings, no explanations, no extra text before or after the code block — the response must consist of the code block alone.

## 1.8 Output example

```
<blockquote data-score="6.0">
[candidate 1's 6.0 monologue]
</blockquote>

<blockquote data-score="6.0">
[candidate 2's 6.0 monologue]
</blockquote>

<blockquote data-score="6.0">
[candidate 3's 6.0 monologue]
</blockquote>

<blockquote data-score="7.0">
[candidate 1's 7.0 monologue]
</blockquote>

... (same pattern through 7.0, 8.0, and 9.0)

<blockquote data-score="9.0">
[candidate 3's 9.0 monologue]
</blockquote>
```

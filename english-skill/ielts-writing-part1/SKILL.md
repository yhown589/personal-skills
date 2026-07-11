---
name: ielts-writing-part1
description: Generate banded sample reports (6.0 / 7.0 / 8.0 / 9.0, three per band, like three different candidates) for an IELTS Writing Task 1 prompt, following real Task 1 exam rules. MANUAL TRIGGER ONLY — never activate this skill automatically; use it only when the user explicitly invokes it by name (e.g. "use the ielts-writing-part1 skill") and provides a task prompt.
disable-model-invocation: true
---

# 1 IELTS Writing Task 1 Banded Reports

## 1.1 Purpose
Given a single IELTS Writing Task 1 prompt (the task instructions plus a description of the visual data — chart, graph, table, diagram, map, or process), produce **three different sample reports for each band** — 6.0, 7.0, 8.0, and 9.0 — as if written by three different candidates at that level (12 reports total).

## 1.2 Trigger rule
- This skill is **manual-trigger only**. Do not run it unless the user explicitly invokes it.

## 1.3 Input
- The user supplies the task prompt text. Store it in a variable: `{{TASK_PROMPT}}`.
- Since visuals cannot be attached as images in plain text, the prompt normally includes a textual description of the data (labels, categories, figures, trends). If figures are given, use them; if the data is only loosely described, invent plausible, internally consistent figures and use them consistently across all twelve reports.
- If `{{TASK_PROMPT}}` is missing, ask the user for it and do nothing else.

## 1.4 Context isolation (mandatory)
- When executing this skill, **ignore all conversation context outside the skill invocation**. Treat `{{TASK_PROMPT}}` as the only input. Do not let earlier messages, prior answers, user preferences, or previous topics influence the output in any way.

## 1.5 IELTS Writing Task 1 exam rules (reports must conform to these)
- Task 1 (Academic) asks the candidate to **summarise the information by selecting and reporting the main features, and make comparisons where relevant**, in **at least 150 words**, with about 20 minutes available.
- A well-judged report is roughly **150–200 words**. Noticeably shorter is penalised; much longer wastes exam time and invites errors.
- The report must be **objective and impersonal**: no opinions, no explanations of causes, no invented information beyond what the data shows.
- Standard structure: an **introduction that paraphrases the task prompt** (never copies it), an **overview stating the main trends or most striking features** (mandatory for 7.0+; weak or missing at 6.0 is realistic), and **one or two body paragraphs** grouping and comparing key figures. No conclusion paragraph is needed.
- Register is **formal written English**: no contractions, no conversational fillers, appropriate data-description language (rose steadily, peaked at, accounted for, in contrast).
- For maps/processes, replace trend language with location/change/sequence language as appropriate; the same structure rules apply.

## 1.6 Band-differentiating features
| Band | Task achievement & organization | Vocabulary | Grammar |
|------|--------------------------------|------------|---------|
| 6.0 | Covers the data but selection is mechanical (marches through categories one by one); overview weak, buried, or missing; some figures listed without comparison; paraphrase of the prompt is close to the original; basic linkers (also, but, however) with some repetition | Adequate range but repetitive (increased/decreased reused); occasional slightly-off collocation (numbers "grew up") | Mix of simple and complex sentences; noticeable but non-impeding errors (articles, prepositions, subject–verb agreement) are acceptable to simulate |
| 7.0 | Clear overview of main trends; key features selected and grouped logically; consistent comparisons; clear progression with a good range of linkers | Sufficient range of trend/proportion language (fluctuated, a threefold increase, the vast majority); occasional awkward choice | Variety of complex structures; frequent error-free sentences; a few slips |
| 8.0 | Skilfully selects and highlights the most significant features; well-managed paragraph grouping; comparisons woven in naturally rather than listed | Wide, precise range used flexibly (plateaued, a marginal decline, roughly on a par with); rare inaccuracy | Wide range used accurately; only occasional minor slips |
| 9.0 | Fully developed, effortlessly organized summary; the grouping itself shows insight into the data; nothing mechanical | Precise, natural, and varied throughout; sophisticated hedging and comparison (broadly mirrored, albeit at a slower pace) | Full range with complete accuracy and naturalness |

The three reports within the same band must read like **three different test-takers**: different paraphrases of the prompt, different grouping/ordering of the data, different selections of which figures to highlight, and different wording — never paraphrases of one another. All three must still clearly sit at the same band level and describe the same data faithfully.

## 1.7 Output rules
- Output exactly twelve blockquotes in ascending band order, three per band. Each blockquote contains one complete report as flowing prose paragraphs (no headings or bullet lists inside).
- **Paragraph breaks (mandatory)**: each report keeps its real paragraph structure (introduction / overview / body paragraphs) with ONE blank line between paragraphs. Each paragraph stays on a single line — do not insert any line breaks within a paragraph.
- Wrap the entire output in a single fenced code block (```) so the raw `<blockquote>` tags are shown as-is instead of being rendered.
- Follow the output format strictly and output nothing else: no intro or closing remarks, no headings, no explanations, no extra text before or after the code block — the response must consist of the code block alone.

## 1.8 Output example

```
<blockquote data-score="6.0">
[candidate 1's 6.0 report]
</blockquote>

<blockquote data-score="6.0">
[candidate 2's 6.0 report]
</blockquote>

<blockquote data-score="6.0">
[candidate 3's 6.0 report]
</blockquote>

<blockquote data-score="7.0">
[candidate 1's 7.0 report]
</blockquote>

... (same pattern through 7.0, 8.0, and 9.0)

<blockquote data-score="9.0">
[candidate 3's 9.0 report]
</blockquote>
```

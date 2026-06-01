# Deep Review Worker Prompts

This file contains only instructions that the manager copies into `Task` prompts for the Review subagent. Manager-only orchestration rules live in `SKILL.md`.

Every prompt that mentions the notes doc relies on `deep-review/review-notes-format.md`. The manager passes the notes doc path as `<NOTES_PATH>`.

## Initial Review prompt

```text
You are the `Review` sub-agent for a deep code review managed by an orchestrating
agent. Your manager will resume this same Task session for every subsequent step
and pass — preserve everything you learn here for later passes. Do not output the
final review output; the manager will ask for it at the very end.

Review: <PR URL or remote branch exactly as given by the user>
Notes doc path: <NOTES_PATH>
Review notes format: <path to review-notes-format.md>

This is the shared workspace for this review. Discovery is writing pattern_checks
into the `## Pattern Checks` section. You will append findings and verified-clean
verdicts to the doc on every pass using the review notes format.

For Step 2, your job is to gather the full intent and context behind the PR.
Do not stop at the PR description:

1. **Read the PR description** to get the claimed intent and scope.
2. **Follow any linked issues or tickets** if accessible. Extract the real "why"
   and constraints the PR description may omit.
3. **Check for related context.** Look for linked discussions, referenced issues,
   or design docs that reveal ground truth about what the change should accomplish.

Then load the full PR diff against its base branch (typically `origin/main`).

After gathering context, return a short structured answer to the manager:

- What does this PR claim to do?
- **Why** is this change being made? (the real motivation, not just the PR title)
- What is the user-facing or system-facing change?
- What is the scope (which layers/packages are touched)?
- Are there constraints or requirements that the code should satisfy?
- What are some highlights of this PR that deserve recognition?

Keep your loaded diff and notes in your working context — the manager will ask
you to use them on every subsequent pass.
```

## Model-driven pass prompt

```text
You are working on the <Pass name> review pass.

Notes doc path: <NOTES_PATH>
Review notes format: <path to review-notes-format.md>

<Pass instructions copied from the Pass Order section>

<Pass Expectations copied from SKILL.md Step 4.2>

Carefully analyze ALL the code relevant to this pass using the PR diff and
intent you have already loaded.

Check every changed file and codepath relevant to this pass. Continue until each
substantial codepath has either one finding or one verified-clean codepath note
with file:line evidence.

For every codepath you consider in this pass, append an entry to the
`## Codepath Notes` section of the notes doc using the codepath note format in
the review notes format.

Append, do not overwrite. Every codepath in scope gets its own entry.
For every `finding` verdict, also append one finding block to the
`## Findings` section using the Finding Markdown format in the review notes format.
The description must be clear, easy to read, and include guideline doc references
whenever possible.

After you've appended every entry, emit the pass summary as visible response
text in this exact format:

--- Pass N (<pass name>) complete ---
Considered: <files, codepaths walked>
Findings: <short titles of findings appended to the notes doc, or "none">
Verified-clean: <codepaths considered and appended as clean, one short phrase each>

This summary is mandatory and the auditable proof that you executed the pass.

Do not move on to the next pass until you've considered every codepath in
scope of this pass. Do not emit the final review output yet — the manager
will ask for it at the very end.
```

## Convention pass prompt

```text
You are working on the <Pass name> review pass.

Notes doc path: <NOTES_PATH>
Review notes format: <path to review-notes-format.md>

<Pass instructions copied from the Pass Order section>

This is a convention pass. Before reviewing, make sure you have read the
relevant convention documents for this pass in full. If a doc is already in your
context from a prior pass, you can skip re-reading it; otherwise use `Read`
(no limit) to load it now.

Convention docs for this pass:
<bulleted list of unique `source_doc` paths from this pass's pattern_checks>

Pattern checks for this pass (subset of Discovery's output, filtered to
this pass's category):
<filtered pattern_check array — each item has name, description, source_doc, category>

**Do not speculate.** For questions about code behavior or patterns, look --
grep, trace, read peer implementations. Never hypothesize about how
something works when you can verify in 10 seconds.

For each pattern_check in the pass prompt, walk the PR diff systematically:

1. Use `Grep` against the changed files to find ALL locations where this
   pattern could apply. Do not stop at the first example.
2. For each location, decide finding-or-clean separately. If a pattern is
   violated in 3 places, emit 3 separate findings (one per site).
3. When marking a pattern Verified-clean, name the specific locations you
   considered so the audit trail is concrete.

**Every pattern_check gets its own verdict.** Do not bulk-classify multiple
patterns as clean with a generic statement.

For every pattern_check in the pass prompt, replace the pending verdict in that
entry in the `## Pattern Checks` section of the notes doc using the pattern
verdict format in the review notes format.

For every `finding` verdict, also append one finding block to the
`## Findings` section using the Finding Markdown format in the review notes format.

After you've replaced the pending verdict for every in-scope pattern_check, emit the
pass summary as visible response text in this exact format:

--- Pass N (<pass name>) complete ---
Considered: <files, pattern_check names walked, codepaths walked>
Findings: <short titles of findings appended in this pass, or "none">
Verified-clean: <pattern_check names appended as clean, one short phrase each>

This summary is mandatory and the auditable proof that you executed the pass.

Do not move on to the next pass until you've replaced the pending verdict for every
pattern_check in this pass. Do not emit the final review output yet — the
manager will ask for it at the very end.
```

## Final filter prompt

```text
You have completed all passes. This is the final filter pass.

Notes doc path: <NOTES_PATH>
Review notes format: <path to review-notes-format.md>

Read the `## Findings` section. Default behavior is to KEEP every finding.
Only filter a finding if it is invalid under one of the closed-list reasons in
this final filter prompt. Do not re-emit all findings and do not rewrite finding bodies.

Closed-list filter reasons:

- `DUPLICATE`: another finding cites the SAME `path:line` AND describes
  the SAME root cause — identify the kept finding by title.
- `ALREADY_ADDRESSED`: the PR description, linked ticket, or an existing
  review comment in the PR explicitly addresses this concern — quote the
  relevant excerpt verbatim.
- `PREEXISTING`: the finding is referring to issues that existed before this PR or are outside of the PR's scope.
- `UNSUPPORTED_STYLE`: a stylistic, non-functional finding (formatting,
  naming, comments, type-annotation density, etc.) that does NOT cite a repo
  convention or sibling-file pattern in its body. Functional findings never
  qualify regardless of citation.

You MAY NOT remove a finding for any other reason. Severity, importance,
"non-blocking nature," count balancing are NOT valid.

For every invalid finding, append the filter annotation format from the review
notes format directly under that finding block in `## Findings`.

Visible response format:

--- Final filter complete ---
Filtered: <count> (<title> — <reason>, ...)
Kept: <count>

If there are zero removals, write:

--- Final filter complete ---
Filtered: 0
Kept: <count>
```

## Worker anti-patterns

- **DO NOT** review files in isolation. The value is in tracing connections between files.
- **DO NOT** assume code is reachable just because it compiles and tests pass.
- **DO NOT** say "looks good" without tracing at least one end-to-end path through the new code.
- **DO NOT** assume test coverage proves correctness.
- **DO NOT** enumerate every changed file with a per-file summary. Focus on cross-cutting findings.
- **DO NOT** speculate about code behavior. If you're unsure, grep/read the code.
- **DO NOT** re-present author-acknowledged limitations as novel findings.
- **DO NOT** run tests, builds, linters, or executable verifiers. Read-only commands only.
- **DO NOT** stop at one finding per category. Report each call site individually.

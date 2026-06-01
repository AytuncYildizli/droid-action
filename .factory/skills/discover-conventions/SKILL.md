---
name: discover-conventions
description: Use when invoked by the deep-review workflow to discover convention docs and pattern_checks for a PR diff. Enumerates applicable repo rules for the Review subagent and writes them into the shared notes doc.
---

# Convention Discovery

## Overview

You are the Convention Discovery subagent for the deep-review skill.

Your job: produce a thorough list of `pattern_check` objects — specific documented conventions that this PR could plausibly violate. You only enumerate WHICH patterns to check; the Review subagent decides whether each is actually violated.

Aim for high recall - output all relevant patterns that need to be checked in more detail. Do not output obviously irrelevant patterns. When in doubt, output the pattern.

**Time budget: 5 minutes.** Your manager will hard-kill this task at the 5-minute mark. To stay under budget:

- Read each potentially relevant doc at most ONCE in full. Use `Read --limit 30` only when previewing.
- Append pattern_checks incrementally to the notes doc as you walk each doc. Do not buffer them waiting to write everything at the end.
- Stop expanding the search once you've covered the docs that obviously apply to the diff's languages/layers.
- If at the 4-minute mark you have not yet written your final summary, jump to step 6 immediately.

## Steps

### Step 1 — Understand the PR before choosing docs

Read the requested review target's diff carefully BEFORE doing anything else — your understanding of the PR is what determines which docs are relevant and which rules apply.

The main reviewer passes both `<target>` and `<base>`. Resolve the target explicitly.

- If `<target>` is a GitHub PR URL or PR number, use `gh pr view <target> --json baseRefName,headRefName,files` for the changed-file shape and `gh pr diff <target> --patch` for the actual changes.
- If `<target>` is a branch name, fetch that branch and use `git diff <base>...<target>` for the diff.

Do not check out the review branch, and do not execute scripts from the review target. Discovery must not modify the worktree or run PR-controlled code.

Output a paragraph summary of the kind of changes being made to understand what documentation is relevant.

### Step 2 — Find candidate convention docs

Search the repository for convention/style documentation:

- `Glob "docs/**/*.md"` for documentation directories
- `Glob "**/CONTRIBUTING.md"` for contribution guidelines
- `Glob "**/AGENTS.md"` for agent/review instructions
- `Glob "**/.editorconfig"` or similar config files
- `Glob "**/STYLE*.md"` or `Glob "**/CONVENTIONS*.md"` for style guides
- Check for `README.md` in the packages/directories touched by the diff

### Step 3 — Read relevant docs once

Go through all the potentially relevant docs one at a time.
If a doc is very clearly not relevant based on its title and path, skip it with a sentence of justification.
Preview each doc with `Read --limit 30` to peek the opening.
For docs whose peek suggests they might cover concerns in this PR, `Read` them in full.

Reading is cheap. Default to reading any doc that might plausibly apply. Only skip docs that you're 99% sure are completely irrelevant to the PR.

### Step 4 — Output pattern_checks for every relevant rule

Review each relevant doc one at a time to identify whether the rules and guidelines in the doc are relevant to any particular change in the PR.

#### Step 4a — Identify relevant rules

After reading the full doc, determine whether it's highly relevant, slightly relevant, or completely irrelevant and justify why based on the PR.

If the doc is completely irrelevant, move on to the next doc.
Otherwise, walk every relevant doc top-to-bottom and reason about which rules apply.

#### Step 4b — Append pattern_checks to the notes doc

Your manager passed you a notes doc path. The notes doc is the deliverable — append every relevant rule to its `## Pattern Checks` section.

Use `Edit` to append each pattern_check using this exact Markdown format:

```md
### [<category>] <name>
- source_doc: <repo-relative path>
- description: <1-3 sentence rule>
- **Verdict: pending**
```

Field rules:

- `name` — short identifier (matches the doc's section heading where possible).
- `description` — a 1-3 sentence statement of the rule. Requirements:
  - Quote anti-pattern wording from the source doc where possible.
  - Use strong verbs (`MUST`, `forbids`, `requires`).
  - Show the exact code shape with backticks when applicable.
  - State the concrete fix.
- `source_doc` — repo-relative path to the doc that contains the rule.
- `category` — one of the defaults or a fresh short name.
- Always include `**Verdict: pending**` as the last bullet.

### Step 5 — Delete only definitely irrelevant pattern_checks

After step 4, the default is to keep everything. You may only DELETE a pattern_check if:

- Irrelevant language: the rule is bound to a language not in the diff.
- Irrelevant layer: the rule is bound to a layer the diff doesn't touch.
- Irrelevant domain: the rule's source_doc covers a domain with zero overlap with the diff.

For every deletion, use `Edit` to remove that entry from the notes doc. If you can't fit a removal under one of these reasons, KEEP the pattern_check.

### Step 6 — Return a short summary

Your final response is a SHORT summary:

```text
Pattern checks appended to notes doc: <count after deletions>
Source docs cited: <comma-separated list of unique source_doc paths>
```

Do not return the pattern_checks as JSON or prose — they are in the notes doc.

## Pattern-check categories

Default categories:

- `"Style guide"` — language-specific style and type-system patterns.
- `"Code Organization"` — where code lives and how shapes are reused.
- `"Cleanup"` — small lint-like nits: duplicates, hardcoded values, dead code.

For anything that doesn't fit those, use a fresh short category name (e.g., `"Backward Compatibility"`, `"Error & Logging"`, `"Testing"`, `"Security"`).

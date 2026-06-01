# Deep Review Notes Format

This file defines the shared notes doc format used by `deep-review/SKILL.md`, `deep-review/review-worker.md`, the Discovery subagent, and the Review subagent. The notes doc is the source of truth for every `pattern_check`, codepath note, finding, and filter annotation.

## Notes doc skeleton

The manager MUST create one stable notes doc path outside the repo before spawning subagents:

```bash
mkdir -p /tmp/factory-deep-review-notes
NOTES_PATH=/tmp/factory-deep-review-notes/$(date +%s)-$(openssl rand -hex 4).md
cat > "$NOTES_PATH" <<'EOF'
# Deep Review Notes for <PR URL / branch specified by the user>

## Pattern Checks
<!-- Discovery will append one entry per pattern_check here. Review will fill verdicts. Manager will annotate filters. -->

## Codepath Notes
<!-- Pass 1-3 model-driven findings live here, one entry per codepath. -->

## Findings
<!-- Every finding that may become a review comment lives here, one Markdown block per finding. -->
EOF
```

Use this exact path in every Task prompt and every audit Read. The path is what binds the three agents together — without it they cannot share state.

## Pattern check entry format

Discovery appends each pattern_check to `## Pattern Checks` with this exact Markdown format:

```md
### [<category>] <name>
- source_doc: <repo-relative path>
- description: <1-3 sentence rule>
- **Verdict: pending**
```

The Review subagent replaces `- **Verdict: pending**` with one or more final verdict lines:

```md
- **Verdict: finding** — see finding "<title>" in `## Findings`
- **Verdict: verified-clean** — <body naming the specific file:line locations considered, with concrete evidence>
```

If a pattern is violated in multiple places, replace the pending placeholder with multiple `finding` verdict lines — one per site.

## Codepath note format

For Passes 1-3, the Review subagent appends one entry per considered codepath to `## Codepath Notes`:

```md
### [Pass N] <short codepath name>
- codepath: <file:line or feature area>
- **Verdict: finding** — see finding "<title>" in `## Findings`
```

or:

```md
### [Pass N] <short codepath name>
- codepath: <file:line or feature area>
- **Verdict: verified-clean** — <body explaining why the codepath is healthy on this pass's specific concern, with file:line citation>
```

## Finding Markdown format

Whenever the Review subagent writes a finding to the notes doc, and whenever the deep-review skill emits final findings to the user, use this exact Markdown block:

```text
### [Blocking|Non-Blocking|Nit]: <title>
<description>
<filepath>(#<line>|#<start>-<end>)?
Category: <pass name without numeric index>
```

Rules:

- Use exactly one of `Blocking`, `Non-Blocking`, or `Nit`.
- Keep `<title>` imperative and specific.
- Write `<description>` as clear, readable prose that explains the concrete issue, the user/system impact, and the requested change.
- Include guideline doc references whenever possible and cite sibling-file precedent when that is the source of the convention.
- Put the primary citation on its own line as `path#42` or `path#42-57`. If the finding genuinely has no precise line, use just `path`.
- `Category:` is the pass name without the numeric index.

Example:

```md
### [Non-Blocking]: Extract the repeated daemon status shape
The new `status` object shape is repeated in both the API response and CLI renderer. Extract a shared `DaemonStatus` type and reuse it in both places instead of letting the two copies drift.
apps/cli/src/daemon/status.ts#42-58
Category: Code Organization
```

## Filter annotation format

The final filter pass does not rewrite findings. For every invalid finding, append this line directly under that finding block in `## Findings`:

```md
**Filter: <reason code>** — <justification>
```

Valid reason codes are defined in `review-worker.md` under the final filter prompt.

## Final response output format

The manager emits every unfiltered finding block from `## Findings` exactly in this format:

```text
### [Blocking]: <title>
<description>
<filepath>(#<line>|#<start>-<end>)?
Category: <pass name without numeric index>

### [Non-Blocking]: <title>
<description>
<filepath>(#<line>|#<start>-<end>)?
Category: <pass name without numeric index>
```

Then the manager emits a plain-text numbered list for console readability and comment selection:

```text
Review comments:
1. Blocking: <title> — <filepath>#<line> — <one-sentence plain description>
2. Non-Blocking: <title> — <filepath>#<line> — <one-sentence plain description>
```

## Citation requirement

- Correctness, impact, and completeness findings (Passes 1-3) cite file:line evidence.
- Convention findings (Passes 4+) cite either a documented convention or a sibling-file pattern.

Findings without any citable source are weaker — move them to Nit or drop them.

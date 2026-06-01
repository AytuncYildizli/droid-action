---
name: deep-review
description: Use when the user asks for a comprehensive PR review, deep review, code-change review, or wants to evaluate whether a feature works end-to-end. Orchestrates a multi-pass review of a PR or branch using repo conventions, correctness tracing, impact analysis, and a shared notes doc.
disable-model-invocation: true
---

# Deep Code Review

This orchestrator is intentionally manager-only. The review notes format lives in `review-notes-format.md`; Review subagent prompt templates live in `review-worker.md`.

## Inputs

- **PR URL or branch name** (required): The changes to review must be explicitly given by the user.
- **Specific concerns** (optional): If the user has particular questions, prioritize those

## Supporting files

Before spawning subagents, Read these files in full:

- `review-notes-format.md` — shared notes-doc skeleton, codepath notes, pattern verdicts, finding blocks, final output, and filter annotations.
- `review-worker.md` — exact prompt templates for the Review subagent's initial context load, pass execution, final filter, and challenge responses.

Use `review-notes-format.md` to create the notes doc skeleton exactly. Use `review-worker.md` as the source for Review subagent prompts; substitute placeholders but do not rewrite the prompt bodies.

Do not inline worker prompt templates back into this file. If a Review subagent instruction changes, update `review-worker.md`; if the notes format changes, update `review-notes-format.md`.

## Sub-agents

This review uses TWO subagents, each spawned EXACTLY ONCE and then RESUMED throughout the review:

- **`Discovery` subagent** (Step 1 only): a single `Task` call that crawls all relevant documentation and writes every applicable pattern_check into the notes doc. It returns a two-field summary with the final pattern_check count and source_docs; the real output lives in the notes doc.

- **`Review` subagent** (Step 2 + every pass in Step 4 + Step 5b final filter): a single `Task` call in Step 2 to initialize, followed by `Task` calls with `resume: <task_id>` for every subsequent pass and the final filter. The Review subagent appends to the notes doc on every pass and keeps its full context (PR intent, prior findings, convention docs it has read) across all passes. **Do not spawn a fresh `Review` subagent per pass** — always resume the same one so context accumulates.

Convention docs are NOT loaded up-front. Each Pass 4+ resume prompt tells the Review subagent which convention docs to Read for that specific pass — only the docs the pass actually needs. If a doc has already been read in a prior pass, the Review naturally reuses what's in its context.

**Critical manager rules:**

- Capture the `task_id` returned by the initial `Review` Task call. Use it as the `resume` parameter for every subsequent Review invocation.
- The Review subagent's context (intent, conventions, prior findings, codepaths walked) persists across resumes. Do not re-send context it already has.
- Each resume call should add ONLY what's new for the next step or pass.

Your job as manager: keep both subagents on task, never let the Review subagent skip a step, and stitch their outputs into the final review. As the manager, you do not read the PR directly or load context beyond what your subagents return.

## Review order

Every review starts by deeply understanding the code change and gathering ALL relevant context from the PR and codebase.

Steps 1 and 2 run in PARALLEL: the `Discovery` Task call (Step 1) and the initial `Review` Task call (Step 2) are launched at the same time so they can each load the diff independently while you wait on both.

Once both have returned, the deep review proceeds in a strict order by RESUMING the `Review` subagent across each remaining pass.

1. Functional Correctness — does the code actually work and can it ever be reached?
2. User and System Impact — how does this change affect the rest of the system and our users, and what could this break?
3. Completeness — is everything wired up and fully tested and documented?
4. Code Organization conventions — where code lives, how shapes are reused, and how names communicate intent.
5. Style guide conventions — language-specific style and type-system patterns.
6. Other relevant convention categories — any other category the subagent surfaces (e.g., `Backward Compatibility`, `Error & Logging`, `Frontend`). Each fresh category triggers its own pass.

The first 3 passes are mandatory. Passes 4+ only run if Discovery finds relevant conventions. Do NOT start with style, naming, or cosmetic observations.

Work through these steps in order. Only move to the next step after completing the current one.

## Step 0 — Create the shared notes doc

Use `review-notes-format.md` to pick a stable notes doc path outside the repo and create the file with the exact empty skeleton. Use this exact path in every Task prompt and every audit Read.

## Step 1 — Discover relevant repo documentation and conventions

This repo may have documented conventions that PR reviewers consistently flag. Which conventions apply depends on the PR — this step discovers them dynamically.

Launch the `Discovery` subagent with a single `Task` call. The full discovery procedure lives in the `discover-conventions` skill — instruct the subagent to load and follow it, and pass the notes doc path you created:

```text
Use the `discover-conventions` skill (call `Skill("discover-conventions")` to load it).
Run it against the diff from `<PR_URL or REMOTE_BRANCH>` vs base ref `<base>` (typically `origin/main`).

Notes doc path: <NOTES_PATH>
Review notes format: <path to review-notes-format.md in the skill directory>

Append every pattern_check you produce to the `## Pattern Checks` section of the
notes doc using the entry format the review notes format describes. In your final filter step,
DELETE any pattern_check entry from the notes doc that you exclude. Do NOT return
the pattern_checks as a JSON array — the notes doc is the deliverable.

Your final response is a short summary: the number of pattern_check entries left
in the notes doc and the unique source_docs they cite.
```

Substitute `<base>` with the PR's base ref, `<PR_URL or REMOTE_BRANCH>` with the review target exactly as given by the user, and `<NOTES_PATH>` with the path you created. Launch this Discovery Task call in parallel with the initial Review Task call from Step 2 — both can load the diff concurrently.

**Discovery has a hard 5-minute budget.** Capture Discovery's `task_id` when you launch it. Poll its progress with `TaskOutput(task_id, block: false)` periodically while you wait. If Discovery is still `Status: running` 5 minutes after launch, immediately call `TaskStop(task_id)` and proceed to Step 3 with whatever pattern_checks Discovery has already written to the `## Pattern Checks` section of the notes doc (which may be zero — that's fine, the mandatory passes still run). Do NOT spawn a "finish discovery" follow-up Task call after the stop; the notes-doc contents at that point are final for this review.

When Discovery returns (or after you stop it on timeout), `Read` the `## Pattern Checks` section of the notes doc and parse the entries. The doc, not the subagent's reply, is the canonical source. You will filter these entries by `category` when preparing Pass 4+ resume prompts.

## Step 2 — Understand Intent (Deep Context)

This is the **initial** `Review` Task call — launch it in parallel with the Step 1 `Discovery` Task call. Capture the returned `task_id`; you will reuse it as the `resume` parameter for every subsequent Review interaction (every pass in Step 4 + the final filter in Step 5b).

Use `review-worker.md` section `Initial Review prompt` for this Task call. Substitute `<PR URL or remote branch exactly as given by the user>` and `<NOTES_PATH>`. Do not output the final review output; the manager asks for it at the very end.

Wait for both the `Discovery` and initial `Review` Task calls to return before proceeding to Step 3.

## Step 3 — Define review plan

We now identify the complete comprehensive plan for our deep review.

Group the Discovery pattern_check array by `category`. Each unique category becomes one pass in Step 4 — the pass-list IS derived from the categories present.

Use `TodoWrite` to create one TODO PER PASS. Always include the mandatory passes (in this order), then one TODO per other category the Discovery subagent invented:

- **Functional Correctness** (mandatory pass — traces code activation paths and data flows; model-driven, does not consume pattern_checks)
- **User and System Impact** (mandatory pass — reviews effects on users, ops, and observability; model-driven)
- **Completeness** (mandatory pass — finds implementation, test, or documentation gaps; model-driven)
- **Code Organization** (pass runs if Discovery found pattern_checks with `category: "Code Organization"`, otherwise skip)
- **Style guide** (pass runs if Discovery found pattern_checks with `category: "Style guide"`, otherwise skip)
- One additional pass per other unique `category` value present in the array (e.g., `Backward Compatibility`, `Error & Logging`, ...)
- One **Final reconciliation** TODO at the end

Your job as a manager is to track all these required steps and passes as TODOs, prompt the sub-agent for every pass, and validate that each pass covered every required codepath or pattern_check with a finding or verified-clean verdict.

## Step 4 — Execute passes one at a time (mandatory exhaustiveness)

Every pass is a `Task` call with `resume: <Review task_id from Step 2>`. You are continuing the SAME `Review` subagent session, not spawning a new one — the Review already has the PR intent and diff loaded (from Step 2) plus any convention docs it has read on earlier passes. Each resume call should add ONLY the pass-specific instructions, not re-send context the Review already has.

For Pass 4+ (convention passes), the manager filters Discovery's pattern_check array by the pass's `category` and computes the set of unique `source_doc` paths those pattern_checks reference. The resume prompt instructs the Review to Read those docs first (if not already read), then walk the patterns.

For each pass in the TodoWrite, in order, do this loop:

1. **Mark `in_progress`.** Update the TodoWrite to set ONLY this pass to `in_progress`. All later passes stay `pending`.

2. **Prepare the Pass Expectations** for the `Review` subagent. The expectations differ between model-driven passes and pattern_check-driven passes:

   - **Passes 1-3 (Functional Correctness, User & System Impact, Completeness) are model-driven** — they do NOT consume the Discovery `pattern_checks`. For each new or changed codepath in scope of the pass, the Review MUST either:
     (a) emit at least one finding for the codepath, OR
     (b) write a detailed explanation of why the codepath is healthy on this pass's specific concern.

   - **Passes 4+ are pattern_check-driven** — each pattern_check from Discovery assigned to the pass's category must be considered. For each pattern_check the Review MUST either:
     (a) emit at least one finding citing the specific file and pattern, OR
     (b) write a detailed explanation of why the pattern does not apply.

3. **Execute the pass.** Send a `Task` call with `resume: <Review task_id>` and the appropriate prompt template from `review-worker.md`.

4. **Audit the notes doc.** `Read` the notes doc and verify coverage for this pass.

5. **Mark `completed`.** Once both the pass summary is emitted AND the notes doc audit passes, update TodoWrite.

**Hard rules:**

- Do not emit the final review output until every TodoWrite item is marked `completed`.
- Do not batch-update TodoWrite to mark multiple pending items as `completed` at the same time.
- Do not spawn a fresh `Review` Task per pass. Always resume the Step 2 Review session.

## Pass Order

### Pass 1: Functional Correctness (mandatory)

For every new code path introduced, trace activations and data flow end-to-end:

- **How does this code get triggered?** Trace backwards from the new code to the entry point.
- **Is the activation path complete?** If the PR adds a handler for condition X, verify that something actually sets condition X.
- **Check that tests exercise the real path.** If tests mock the entry point, they may pass while the real code is unreachable.
- **For feature-flagged code:** Check whether the flag exists and is evaluable.
- **For new enum values / config options:** Trace all switch/if statements that consume the enum.
- **Request path:** What does the request look like? How is it validated?
- **Error handling:** What happens when things fail? Are error codes appropriate?
- **State mutations:** What state is created or modified? Is cleanup handled on failure?
- **Cross-layer contracts:** If the PR changes a shared type/interface, are all consumers updated?

### Pass 2: User and System Impact (mandatory)

- **What changes for the user?** Can they tell something is different? Is there a degradation?
- **Behavioral compatibility:** If this feature interacts with existing features, does the interaction work correctly?
- **For bug fixes:** Is the change addressing the actual cause? Or papering over a symptom?
- **What changes for operations?** New secrets/credentials required? New infrastructure?
- **Error observability:** Will errors from this path show up in logging? Or are they silently swallowed?

### Pass 3: Completeness (mandatory)

- **Is the feature fully wired up?** Or is this intentionally partial?
- **Are there unrelated changes bundled in?**
- **Missing tests for new code paths:** Not "could we add more tests?" but "is there a new branch with zero test coverage that could silently break?"
- **Missing documentation/config:** New secrets, new environment variables, new feature flags.
- **Incomplete migration:** Missed renames, stale references, orphaned code.

### Pass 4+: Convention passes (dynamic, based on Discovery)

Walk pattern_checks for each category. For each pattern, emit a finding OR a detailed verified-clean explanation.

## Step 5 — Final reconciliation and emission

**5a — Manager pre-flight:**

1. Walk the TodoWrite. Every pass must be marked `completed`.
2. `Read` the notes doc and confirm every pattern_check entry has a verdict.
3. Count distinct finding blocks in `## Findings`.

**5b — Review subagent final filter pass:**

Send one `Task` call with `resume: <Review task_id>` using `review-worker.md` section `Final filter prompt`.

**5c — Manager emits final output:**

1. `Read` the notes doc again.
2. Before the findings, emit a review summary in at most 2 sentences.
3. Emit every unfiltered finding block from `## Findings` exactly in the final response output format from `review-notes-format.md`.
4. Then emit a plain-text, numbered list of the same final findings for console readability.

Do not post anything to GitHub without explicit user permission.

**5d — Output findings as JSON (CI mode):**

If the outer prompt specifies a JSON output path, convert all unfiltered findings to the JSON schema specified in the outer prompt. Map severity to priority: Blocking → P0, Non-Blocking → P1, Nit → P2. Use the filepath and line from each finding's citation. Skip the AskUser step in CI mode.

If no JSON output path is specified (interactive mode), call `AskUser` with:

```text
1. [question] Which review comments should I post to GitHub?
[topic] GitHub Comments
[option] Post only blocking comments
[option] Post all comments
```

## Severity Discipline

- **Blocking**: This code has a problem that needs to be fixed before merge.
- **Non-Blocking**: This code works but could be improved.
- **Nit**: Style preference or minor observation.

## Manager Anti-Patterns to Avoid

- **DO NOT** skip any steps. You must complete all steps and all passes.
- **DO NOT** emit the final review output until every TodoWrite item is `completed`.
- **DO NOT** batch-mark multiple TodoWrite items as `completed`.
- **DO NOT** spawn a fresh `Review` Task call per pass. Resume the same Step 2 Review session.
- **DO NOT** skip a subagent `pattern_check` without an explicit checked-and-clean explanation.

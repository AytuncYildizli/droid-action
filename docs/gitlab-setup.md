# GitLab Setup

This action ships a **GitLab CI/CD Component** that delivers the same
automated code-review experience as the GitHub action on GitLab merge
requests (MRs). The component runs on every `merge_request_event` pipeline,
posts inline comments on the diff, maintains a sticky tracking note, and
optionally runs a security-focused subagent in parallel.

## Quick start with `/install-code-review`

The fastest path is the guided installer built into the Droid CLI:

```bash
droid
> /install-code-review
```

It detects GitLab, optionally provisions a branded `Factory Droid` service
account, asks the configuration questions below, generates the
`.gitlab-ci.yml`, and opens an MR / direct-commits to the target project(s).

## Manual installation

### 1. Prerequisites

| Requirement                           | How to get it                                                                                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab Maintainer role on the project | Repo admin grants you Maintainer (40)                                                                                                                             |
| `FACTORY_API_KEY` CI/CD variable      | Generate at <https://app.factory.ai/settings/api-keys>; add as **masked**, **unprotected** variable at the project, subgroup, or top-level group level            |
| `GITLAB_TOKEN` CI/CD variable         | A personal or service-account access token with the `api` scope. Required so the MCP server can post comments back to the MR. Add as **masked**, **unprotected**. |

### 2. Add the CI/CD Component

Create or extend `.gitlab-ci.yml` in your project with:

```yaml
include:
  - remote: "https://raw.githubusercontent.com/Factory-AI/droid-action/main/gitlab/templates/review.yml"
    inputs:
      automatic_review: "true"
      automatic_security_review: "false"
      review_depth: "deep"
      include_suggestions: "true"
      security_block_on_critical: "true"
      security_block_on_high: "false"
      droid_action_ref: "main"

droid-review:
  variables:
    FACTORY_API_KEY: $FACTORY_API_KEY
    GITLAB_TOKEN: $GITLAB_TOKEN
```

> Pin both the `include:` URL ref and `droid_action_ref` to a release tag
> (e.g. `v1`) once one is published. They MUST match — the URL pin
> resolves the template at parse time, `droid_action_ref` clones the same
> source at runtime.

### 3. Push an MR

Open or push to an MR. The next `merge_request_event` pipeline will run
the `droid-review` job. Expect ~5-10 minutes for a typical change.

## Inputs

| Input                        | Default                                          | Description                                                                                                                                  |
| ---------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `automatic_review`           | `"true"`                                         | Run code review automatically on every MR pipeline.                                                                                          |
| `automatic_security_review`  | `"false"`                                        | Run a parallel security-focused subagent on every MR pipeline. Findings are prefixed `[security]` and posted alongside code-review comments. |
| `review_depth`               | `"deep"`                                         | `"deep"` (thorough) or `"shallow"` (fast).                                                                                                   |
| `review_model`               | `""`                                             | Override the model. Empty = use depth preset.                                                                                                |
| `reasoning_effort`           | `""`                                             | Override reasoning effort. Empty = use depth preset.                                                                                         |
| `include_suggestions`        | `"true"`                                         | Include code suggestion blocks in review comments when the fix is high-confidence.                                                           |
| `security_block_on_critical` | `"true"`                                         | Block merge on CRITICAL security findings. (Mirrors GitHub action; surface-level parity.)                                                    |
| `security_block_on_high`     | `"false"`                                        | Block merge on HIGH security findings. (Mirrors GitHub action; surface-level parity.)                                                        |
| `settings`                   | `""`                                             | Droid Exec settings as a JSON string or a path to a JSON file. Merged into `~/.factory/droid/settings.json` before each `droid exec` call.   |
| `droid_action_repo`          | `https://github.com/Factory-AI/droid-action.git` | Override if you mirror droid-action privately.                                                                                               |
| `droid_action_ref`           | `"dev"`                                          | Git ref of droid-action to clone at runtime. Should match the `include: remote:` URL ref.                                                    |
| `stage`                      | `"test"`                                         | GitLab CI stage to assign the `droid-review` job to.                                                                                         |

## What you get

Each MR pipeline produces:

- **Inline review comments** anchored to the relevant diff lines, posted in a
  single batched `submit_review` call. Findings are prefixed with priority
  tags (`P0`, `P1`, `P2`, `P3`) and `[security]` for security findings.
- **A sticky tracking note** on the MR with pipeline + job links, telemetry
  (`N turns • Xm Ys`), session IDs, and a security badge when
  `automatic_security_review` is enabled.
- **Debug artifacts** at `.droid-debug/` (prompts, candidate JSON, raw
  stream-json logs) retained for 1 week.
- **A custom droid library** copied from
  `$DROID_ACTION_DIR/.factory/droids` into `~/.factory/droids` on the
  runner, so subagents like `security-reviewer` are reachable.

## How it works

The pipeline runs in two passes:

1. **Pass 1 (candidates)** — Droid Exec reads the MR diff, description, and
   existing comments, then writes `/tmp/droid-prompts/review_candidates.json`
   with candidate findings. The security-reviewer subagent runs in parallel
   if `automatic_security_review` is on. **No MR mutations** happen in this
   pass — the MR-write tools are excluded from `--enabled-tools`.
2. **Pass 2 (validator)** — Droid Exec rereads the candidates, filters out
   duplicates and low-confidence findings, and batches all approved comments
   into a single `gitlab_mr___submit_review` call. The sticky note is
   updated via `gitlab_mr___update_tracking_note`.

A small GitLab MCP server (`src/mcp/gitlab-mr-server.ts`) is launched on
the runner to expose those two write tools.

## What's not yet supported

These exist in the GitHub action but require platform features GitLab
does not currently expose, and are not part of Phase 1:

- **Comment-triggered modes** (`@droid review`, `@droid security`,
  `@droid fill`). GitLab does not fire CI pipelines on note events.
  Requires a Factory-hosted webhook receiver that turns note webhooks
  into `POST /projects/:id/trigger/pipeline` calls. Planned as a follow-up.
- **`@droid fill` (MR description fill).** Depends on the comment trigger
  above.
- **Scheduled full-repo security scans.** Tracked separately.

## Troubleshooting

| Symptom                                       | Likely cause                                                  | Fix                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pipeline runs but no comments posted          | `GITLAB_TOKEN` not set or missing `api` scope                 | Add a masked `GITLAB_TOKEN` CI/CD variable with `api`-scoped PAT                                      |
| `Could not find file` on include              | `droid_action_ref` doesn't exist in `Factory-AI/droid-action` | Verify the ref; pin to a stable tag                                                                   |
| `factory_api_key is required` error           | `FACTORY_API_KEY` not set or scoped wrong                     | Add as **masked**, **unprotected** variable at the right level (project / subgroup / top-level group) |
| Sticky note posts but inline findings missing | Pass 2 hit a transient API error                              | Inspect `.droid-debug/prompts/pass2-output.jsonl`; re-run the pipeline                                |
| Pipeline times out                            | Very large MR                                                 | Set `review_depth: "shallow"` for faster feedback                                                     |

## Self-hosted GitLab

The component reads `CI_API_V4_URL` and `CI_SERVER_URL` from the standard
GitLab CI environment. Self-managed GitLab works as long as your runner
can:

- Reach `https://app.factory.ai/cli` to install the Droid CLI
- Reach `https://github.com/Factory-AI/droid-action.git` (or your private
  mirror, via `droid_action_repo`)
- Reach `https://raw.githubusercontent.com/...` for the `include: remote:`

Mirror droid-action internally and set `droid_action_repo` + `droid_action_ref`
accordingly if your runners cannot reach GitHub.

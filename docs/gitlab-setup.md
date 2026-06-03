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

It detects GitLab, asks which account should be the poster of review
comments (you supply its PAT as `GITLAB_TOKEN`), asks the configuration
questions below, drops `factory/droid-review.yml` in your project, wires
it into `.gitlab-ci.yml`, and opens an MR / direct-commits to the target
project(s).

## Manual installation

### 1. Prerequisites

| Requirement                           | How to get it                                                                                                                                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitLab Maintainer role on the project | Repo admin grants you Maintainer (40)                                                                                                                                                                    |
| `FACTORY_API_KEY` CI/CD variable      | Generate at <https://app.factory.ai/settings/api-keys>; add as **masked**, **unprotected** variable at the project, subgroup, or top-level group level                                                   |
| `GITLAB_TOKEN` CI/CD variable         | A personal access token with the `api` scope, owned by whichever account should post review comments. The token owner is the poster — there is no API impersonation. Add as **masked**, **unprotected**. |

### 2. Add the CI/CD Component

Drop-in samples live in [`gitlab/examples/`](../gitlab/examples/). The
layout is two files:

- [`factory/droid-review.yml`](../gitlab/examples/factory/droid-review.yml) — self-contained config (include + inputs + variables). Drop verbatim.
- [`.gitlab-ci.yml`](../gitlab/examples/.gitlab-ci.yml) — project-root entry point. If you already have one, append the include line below to its `include:` block.

**`factory/droid-review.yml`** (drop into your project):

```yaml
include:
  - project: "factory-components/droid-action"
    ref: main
    file: "/templates/droid-review.yml"
    inputs:
      automatic_review: "true"
      automatic_security_review: "false"
      review_depth: "deep"
      include_suggestions: "true"
      security_block_on_critical: "true"
      security_block_on_high: "false"

droid-review:
  variables:
    FACTORY_API_KEY: $FACTORY_API_KEY
    GITLAB_TOKEN: $GITLAB_TOKEN
```

**`.gitlab-ci.yml`** (project root, just needs the one include line):

```yaml
include:
  - local: "factory/droid-review.yml"
```

> The remote `include:` URL is pinned to `@main`, which tracks the
> latest stable cut of droid-action.

### 3. Push an MR

Open or push to an MR. The next `merge_request_event` pipeline will run
the `droid-review` job. Expect ~5-10 minutes for a typical change.

## Inputs

| Input                        | Default   | Description                                                                                                                                  |
| ---------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `automatic_review`           | `"true"`  | Run code review automatically on every MR pipeline.                                                                                          |
| `automatic_security_review`  | `"false"` | Run a parallel security-focused subagent on every MR pipeline. Findings are prefixed `[security]` and posted alongside code-review comments. |
| `review_depth`               | `"deep"`  | `"deep"` (thorough) or `"shallow"` (fast).                                                                                                   |
| `review_model`               | `""`      | Override the model. Empty = use depth preset.                                                                                                |
| `reasoning_effort`           | `""`      | Override reasoning effort. Empty = use depth preset.                                                                                         |
| `include_suggestions`        | `"true"`  | Include code suggestion blocks in review comments when the fix is high-confidence.                                                           |
| `security_block_on_critical` | `"true"`  | Block merge on CRITICAL security findings. (Mirrors GitHub action; surface-level parity.)                                                    |
| `security_block_on_high`     | `"false"` | Block merge on HIGH security findings. (Mirrors GitHub action; surface-level parity.)                                                        |
| `settings`                   | `""`      | Droid Exec settings as a JSON string or a path to a JSON file. Merged into `~/.factory/droid/settings.json` before each `droid exec` call.   |

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

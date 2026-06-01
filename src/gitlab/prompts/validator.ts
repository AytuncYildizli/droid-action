/**
 * GitLab Pass-2 (validator) prompt.
 *
 * Direct port of the GitHub Action's
 * `src/create-prompt/templates/review-validator-prompt.ts` with PR→MR
 * terminology and the GitLab MCP tool names. The validator reads the
 * candidates JSON produced by Pass 1 from disk, validates each one,
 * writes a refined JSON, and posts the approved findings as a single
 * batched call to `gitlab_mr___submit_review`.
 *
 * Pass 2 is the only place where the posting tool is exposed (via
 * `--enabled-tools` on the second `droid exec` invocation).
 */

import type { GitlabReviewPromptContext } from "./types";

export function generateGitlabReviewValidatorPrompt(
  ctx: GitlabReviewPromptContext,
): string {
  const {
    projectPath,
    mrIid,
    sourceBranch,
    targetBranch,
    headSha,
    diffPath,
    commentsPath,
    descriptionPath,
    candidatesPath,
    validatedPath,
    includeSuggestions,
  } = ctx;

  const skillInstruction = includeSuggestions
    ? "Invoke the 'review' skill to load the review methodology, then execute its **Pass 2: Validation** procedure — including suggestion block rules."
    : "Invoke the 'review' skill to load the review methodology, then execute its **Pass 2: Validation** procedure. Do NOT include code suggestion blocks.";

  return `You are validating candidate review comments for MR !${mrIid} in ${projectPath}.

IMPORTANT: This is Phase 2 (validator) of a two-pass review pipeline.

${skillInstruction}

### Context

* Project: ${projectPath}
* MR IID: ${mrIid}
* MR Source Branch: ${sourceBranch}
* MR Head SHA: ${headSha}
* MR Target Branch: ${targetBranch}

### Inputs

Read these files before validating:
* MR Description: \`${descriptionPath}\`
* Candidates: \`${candidatesPath}\`
* Full MR Diff: \`${diffPath}\`
* Existing Comments: \`${commentsPath}\`

If the diff is large, read in chunks (offset/limit). **Do not proceed until you have read the ENTIRE diff.**

### Critical Requirements

1. You MUST read and validate **every** candidate before posting anything.
2. Preserve ordering: keep results in the same order as candidates.
3. **Posting rule (STRICT):** Only post comments where \`status === "approved"\`. Never post rejected items.

### Output: Write \`${validatedPath}\`

\`\`\`json
{
  "version": 1,
  "meta": {
    "project": "${projectPath}",
    "mrIid": ${mrIid},
    "headSha": "${headSha}",
    "targetBranch": "${targetBranch}",
    "validatedAt": "<ISO timestamp>"
  },
  "results": [
    {
      "status": "approved",
      "comment": {
        "path": "src/index.ts",
        "body": "[P1] Title\\n\\n1 paragraph.",
        "line": 42,
        "startLine": null,
        "side": "RIGHT",
        "commit_id": "${headSha}"
      }
    },
    {
      "status": "rejected",
      "candidate": {
        "path": "src/other.ts",
        "body": "[P2] ...",
        "line": 10,
        "startLine": null,
        "side": "RIGHT",
        "commit_id": "${headSha}"
      },
      "reason": "Not a real bug because ..."
    }
  ],
  "reviewSummary": {
    "status": "approved",
    "body": "1-3 sentence overall assessment"
  }
}
\`\`\`

Notes:
* Use \`commit_id\` = \`${headSha}\`.
* \`results\` MUST have exactly one entry per candidate, in the same order.

Tooling note:
* If the tools list includes \`ApplyPatch\` (common for OpenAI models like GPT-5.2), use \`ApplyPatch\` to create/update the file at the exact path.
* Otherwise, use \`Create\` (or \`Edit\` if overwriting) to write the file.

### Post approved items

After writing \`${validatedPath}\`, post comments ONLY for \`status === "approved"\`:

* Collect all approved comments and submit them as a **single batched review** via \`gitlab_mr___submit_review\`, passing them in the \`comments\` array parameter along with \`mr_iid: ${mrIid}\`.
* Do **NOT** post comments individually — batch them all into one \`submit_review\` call.
* Do **NOT** include a \`body\` parameter in \`submit_review\` (we use a separate tracking note for the summary).
* Use \`gitlab_mr___update_tracking_note\` to update the sticky tracking note with the review summary.
* If any approved comments contain \`[security]\` in their body, prepend a security badge to the tracking note: \`![Security Review](https://img.shields.io/badge/security%20review-ran-blue)\`. This indicates that security analysis was performed as part of the review.
* Do **NOT** post the summary as a separate top-level note.
* Do not approve the MR or request changes (GitLab approval rules are handled out-of-band).
`;
}

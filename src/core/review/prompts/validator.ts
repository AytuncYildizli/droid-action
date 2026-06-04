/**
 * Platform-agnostic Pass 2 (validator) prompt.
 *
 * The validator reads the candidates JSON produced by Pass 1, validates
 * each one, writes a refined JSON to disk, and posts the approved
 * findings as a single batched call to the platform's submit-review tool.
 * Both `src/create-prompt/templates/review-validator-prompt.ts` (GitHub)
 * and `src/gitlab/prompts/validator.ts` (GitLab) delegate to this builder
 * via thin adapters that supply a `ReviewTerminology` shape.
 *
 * Pass 2 is the only place where the posting tool is exposed (via
 * `--enabled-tools` on the second `droid exec` invocation).
 */

import type { ReviewPromptContext } from "./types";

export function generateValidatorPrompt(ctx: ReviewPromptContext): string {
  const {
    terminology: t,
    entityNumber,
    repoOrProject,
    headRef,
    headSha,
    baseRef,
    diffPath,
    commentsPath,
    descriptionPath,
    candidatesPath,
    validatedPath,
    includeSuggestions,
  } = ctx;

  if (!validatedPath) {
    throw new Error("validator prompt requires validatedPath in context");
  }

  const skillInstruction = includeSuggestions
    ? "Invoke the 'review' skill to load the review methodology, then execute its **Pass 2: Validation** procedure — including suggestion block rules."
    : "Invoke the 'review' skill to load the review methodology, then execute its **Pass 2: Validation** procedure. Do NOT include code suggestion blocks.";

  const securityBadgeLine = t.securityBadgeInstruction
    ? `\n* ${t.securityBadgeInstruction}`
    : "";

  return `You are validating candidate review comments for ${t.entityNoun} ${t.entityNumberSigil}${entityNumber} in ${repoOrProject}.

IMPORTANT: This is Phase 2 (validator) of a two-pass review pipeline.

${skillInstruction}

### Context

* ${t.repoLabel}: ${repoOrProject}
* ${t.entityNumberLabel}: ${entityNumber}
* ${t.headRefLabel}: ${headRef}
* ${t.headShaLabel}: ${headSha}
* ${t.baseRefLabel}: ${baseRef}

### Inputs

Read these files before validating:
* ${t.descriptionLabel}: \`${descriptionPath}\`
* Candidates: \`${candidatesPath}\`
* ${t.diffLabel}: \`${diffPath}\`
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
    "${t.metaRepoKey}": "${repoOrProject}",
    "${t.metaEntityNumberKey}": ${entityNumber},
    "headSha": "${headSha}",
    "${t.metaBaseRefKey}": "${baseRef}",
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

* Collect all approved comments and submit them as a **single batched review** via \`${t.submitReviewToolName}\`, passing them in the \`comments\` array parameter${t.submitReviewExtraArg}.
* Do **NOT** post comments individually — batch them all into one \`submit_review\` call.
* Do **NOT** include a \`body\` parameter in \`submit_review\`${t.submitReviewBodyExclusionTrailer}.
* Use \`${t.updateTrackingToolName}\` to update the ${t.trackingCommentName} with the review summary.${securityBadgeLine}
* Do **NOT** post the summary as a separate ${t.summaryEntityName}${t.summaryPostingExtraExclusion}.
* ${t.approvalChangesNote}
`;
}

/**
 * GitLab Pass-2 (validator) prompt — thin adapter.
 *
 * Delegates to the platform-agnostic builder in
 * `src/core/review/prompts/validator.ts` after mapping the GitLab
 * context shape onto the shared `ReviewPromptContext` and supplying
 * `gitlabTerminologyFor(mrIid)` (which bakes the MR IID into the
 * submit_review call hint, since GitLab's tool requires `mr_iid` to be
 * re-asserted in the invocation).
 *
 * Pass 2 is the only place the GitLab posting tool is exposed (via
 * `--enabled-tools` on the second `droid exec` invocation).
 */

import { generateValidatorPrompt } from "../../core/review/prompts/validator";
import { gitlabTerminologyFor } from "./terminology";
import type { GitlabReviewPromptContext } from "./types";

export function generateGitlabReviewValidatorPrompt(
  ctx: GitlabReviewPromptContext,
): string {
  return generateValidatorPrompt({
    terminology: gitlabTerminologyFor(ctx.mrIid),
    entityNumber: ctx.mrIid,
    repoOrProject: ctx.projectPath,
    headRef: ctx.sourceBranch,
    headSha: ctx.headSha,
    baseRef: ctx.targetBranch,
    diffPath: ctx.diffPath,
    commentsPath: ctx.commentsPath,
    descriptionPath: ctx.descriptionPath,
    candidatesPath: ctx.candidatesPath,
    validatedPath: ctx.validatedPath,
    includeSuggestions: ctx.includeSuggestions,
    securityReviewEnabled: ctx.securityReviewEnabled,
  });
}

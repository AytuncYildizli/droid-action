/**
 * GitLab Pass-1 (candidate generation) prompt — thin adapter.
 *
 * Delegates to the platform-agnostic builder in
 * `src/core/review/prompts/candidates.ts` after mapping the GitLab
 * context shape onto the shared `ReviewPromptContext` and supplying
 * `GITLAB_TERMINOLOGY` (PR→MR labels, GitLab MCP tool names, etc.).
 *
 * The GitLab posting tool is exposed only in Pass 2; this Pass 1 prompt
 * MUST NOT instruct the model to call it. The shared builder enforces
 * that, plus tool gating at the `droid exec` level via `--enabled-tools`.
 */

import { generateCandidatesPrompt } from "../../core/review/prompts/candidates";
import { GITLAB_TERMINOLOGY } from "./terminology";
import type { GitlabReviewPromptContext } from "./types";

export function generateGitlabReviewCandidatesPrompt(
  ctx: GitlabReviewPromptContext,
): string {
  return generateCandidatesPrompt({
    terminology: GITLAB_TERMINOLOGY,
    entityNumber: ctx.mrIid,
    repoOrProject: ctx.projectPath,
    headRef: ctx.sourceBranch,
    headSha: ctx.headSha,
    baseRef: ctx.targetBranch,
    diffPath: ctx.diffPath,
    commentsPath: ctx.commentsPath,
    descriptionPath: ctx.descriptionPath,
    candidatesPath: ctx.candidatesPath,
    includeSuggestions: ctx.includeSuggestions,
    securityReviewEnabled: ctx.securityReviewEnabled,
  });
}

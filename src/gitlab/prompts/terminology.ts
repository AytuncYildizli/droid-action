import type { ReviewTerminology } from "../../core/review/prompts/types";

export const GITLAB_TERMINOLOGY: ReviewTerminology = {
  entityNoun: "MR",
  entityNumberSigil: "!",
  platformName: "GitLab",
  repoLabel: "Project",
  entityNumberLabel: "MR IID",
  headRefLabel: "MR Source Branch",
  headShaLabel: "MR Head SHA",
  baseRefLabel: "MR Target Branch",
  descriptionLabel: "MR Description",
  diffLabel: "Full MR Diff",
  metaRepoKey: "project",
  metaEntityNumberKey: "mrIid",
  metaBaseRefKey: "targetBranch",
  repoExample: "group/project",
  pathFieldDescription:
    'Relative file path (use the new_path from the diff, e.g., "src/index.ts")',
  lineFieldDescription:
    "Target line number in the new file (single-line) or end line number (multi-line). Must be ≥ 0.",
  mutationToolForbiddance:
    "(`gitlab_mr___submit_review`, `gitlab_mr___create_mr_note`, `gitlab_mr___update_mr_note`, `gitlab_mr___update_mr_description`, `gitlab_mr___update_tracking_note`, etc.)",
  submitReviewToolName: "gitlab_mr___submit_review",
  submitReviewExtraArg: "", // populated dynamically below via factory
  submitReviewBodyExclusionTrailer:
    " (we use a separate tracking note for the summary)",
  updateTrackingToolName: "gitlab_mr___update_tracking_note",
  trackingCommentName: "sticky tracking note",
  summaryEntityName: "top-level note",
  summaryPostingExtraExclusion: "",
  approvalChangesNote:
    "Do not approve the MR or request changes (GitLab approval rules are handled out-of-band).",
  securityBadgeInstruction:
    "If any approved comments contain `[security]` in their body, prepend a security badge to the tracking note: `![Security Review](https://img.shields.io/badge/security%20review-ran-blue)`. This indicates that security analysis was performed as part of the review.",
};

/**
 * Build the GitLab terminology with the runtime MR IID baked into the
 * "passing them in the comments array parameter along with mr_iid: N" arg.
 * GitLab's submit_review tool needs the IID re-asserted in the call.
 */
export function gitlabTerminologyFor(mrIid: number): ReviewTerminology {
  return {
    ...GITLAB_TERMINOLOGY,
    submitReviewExtraArg: ` along with \`mr_iid: ${mrIid}\``,
  };
}

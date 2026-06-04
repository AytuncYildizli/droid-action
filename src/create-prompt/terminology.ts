import type { ReviewTerminology } from "../core/review/prompts/types";

export const GITHUB_TERMINOLOGY: ReviewTerminology = {
  entityNoun: "PR",
  entityNumberSigil: "#",
  platformName: "GitHub",
  repoLabel: "Repo",
  entityNumberLabel: "PR Number",
  headRefLabel: "PR Head Ref",
  headShaLabel: "PR Head SHA",
  baseRefLabel: "PR Base Ref",
  baseRefShortLabel: "base ref",
  descriptionLabel: "PR Description",
  diffLabel: "Full PR Diff",
  metaRepoKey: "repo",
  metaEntityNumberKey: "prNumber",
  metaBaseRefKey: "baseRef",
  repoExample: "owner/repo",
  pathFieldDescription: 'Relative file path (e.g., "src/index.ts")',
  lineFieldDescription:
    "Target line number (single-line) or end line number (multi-line). Must be ≥ 0.",
  mutationToolForbiddance:
    "(inline comments, submit review, delete/minimize/reply/resolve, etc.)",
  submitReviewToolName: "github_pr___submit_review",
  submitReviewExtraArg: "",
  submitReviewBodyExclusionTrailer: "",
  updateTrackingToolName: "github_comment___update_droid_comment",
  trackingCommentName: "tracking comment",
  summaryEntityName: "comment",
  summaryPostingExtraExclusion: " or as the body of `submit_review`",
  approvalChangesNote: "Do not approve or request changes.",
  // No security-badge instruction on GitHub today; left undefined intentionally.
};

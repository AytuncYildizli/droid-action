/**
 * Sticky tracking note helpers for GitLab MR pipelines.
 *
 * The tracking note carries a hidden HTML marker so we can find and
 * update the same note across retries instead of creating duplicates.
 */

export const DROID_TRACKING_MARKER = "<!-- droid-tracking-note -->";
export const DROID_SECURITY_BADGE_MARKER = "<!-- droid-security-badge -->";

export type TrackingNoteState = "running" | "success" | "failure";

export interface TrackingNoteOptions {
  state: TrackingNoteState;
  pipelineUrl?: string | null;
  jobUrl?: string | null;
  triggerUsername?: string | null;
  errorDetails?: string | null;
  securityReviewRan?: boolean;
}

const SECURITY_BADGE =
  "![security](https://img.shields.io/badge/security%20review-enabled-blue?style=flat-square&logo=shield) ";

const STATE_HEADER: Record<TrackingNoteState, string> = {
  running:
    "**Droid is reviewing this merge request...** :hourglass_flowing_sand:",
  success: "**Droid finished reviewing this merge request** :white_check_mark:",
  failure: "**Droid encountered an error reviewing this MR** :x:",
};

export function buildTrackingNoteBody(options: TrackingNoteOptions): string {
  const lines: string[] = [];

  if (options.securityReviewRan) {
    lines.push(`${DROID_SECURITY_BADGE_MARKER}${SECURITY_BADGE}`);
  }

  lines.push(DROID_TRACKING_MARKER);
  lines.push("");
  lines.push(STATE_HEADER[options.state]);
  lines.push("");

  if (options.triggerUsername) {
    lines.push(`Triggered by @${options.triggerUsername}.`);
  }

  if (options.pipelineUrl) {
    lines.push(`Pipeline: ${options.pipelineUrl}`);
  }
  if (options.jobUrl) {
    lines.push(`Job log: ${options.jobUrl}`);
  }

  if (options.state === "failure" && options.errorDetails) {
    lines.push("");
    lines.push("<details><summary>Error details</summary>");
    lines.push("");
    lines.push("```");
    lines.push(options.errorDetails.trim());
    lines.push("```");
    lines.push("</details>");
  }

  return lines.join("\n").trim() + "\n";
}

export function findExistingTrackingNote<
  T extends { id: number; body: string },
>(notes: T[]): T | undefined {
  return notes.find((n) => n.body && n.body.includes(DROID_TRACKING_MARKER));
}

/**
 * Sticky tracking note helpers for GitLab MR pipelines.
 *
 * The tracking note carries a hidden HTML marker so we can find and
 * update the same note across retries instead of creating duplicates.
 */

export const DROID_TRACKING_MARKER = "<!-- droid-tracking-note -->";
export const DROID_SECURITY_BADGE_MARKER = "<!-- droid-security-badge -->";

export type TrackingNoteState = "running" | "success" | "failure";

export type TrackingNoteTelemetry = {
  totalNumTurns?: number | null;
  totalDurationMs?: number | null;
  totalCostUsd?: number | null;
  pass1SessionId?: string | null;
  pass2SessionId?: string | null;
};

export interface TrackingNoteOptions {
  state: TrackingNoteState;
  pipelineUrl?: string | null;
  jobUrl?: string | null;
  triggerUsername?: string | null;
  errorDetails?: string | null;
  securityReviewRan?: boolean;
  telemetry?: TrackingNoteTelemetry | null;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSec}s`;
}

function formatCostUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
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

  if (options.telemetry) {
    const t = options.telemetry;
    const bits: string[] = [];
    if (typeof t.totalNumTurns === "number")
      bits.push(`${t.totalNumTurns} turns`);
    if (typeof t.totalDurationMs === "number")
      bits.push(formatDurationMs(t.totalDurationMs));
    if (typeof t.totalCostUsd === "number" && t.totalCostUsd > 0)
      bits.push(formatCostUsd(t.totalCostUsd));
    if (bits.length > 0) {
      lines.push("");
      lines.push(`<sub>${bits.join(" • ")}</sub>`);
    }
    if (t.pass1SessionId || t.pass2SessionId) {
      lines.push("");
      lines.push("<details><summary>Droid session IDs</summary>");
      lines.push("");
      if (t.pass1SessionId) lines.push(`- Pass 1: \`${t.pass1SessionId}\``);
      if (t.pass2SessionId) lines.push(`- Pass 2: \`${t.pass2SessionId}\``);
      lines.push("</details>");
    }
  }

  return lines.join("\n").trim() + "\n";
}

export function findExistingTrackingNote<
  T extends { id: number; body: string },
>(notes: T[]): T | undefined {
  return notes.find((n) => n.body && n.body.includes(DROID_TRACKING_MARKER));
}

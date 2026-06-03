/**
 * Small formatting helpers for sticky review-tracking
 * comments/notes. Currently consumed by the GitLab tracking-note
 * builder (`src/gitlab/operations/tracking-note.ts`); kept platform-
 * agnostic in core so the GitHub MCP comment server can adopt the same
 * "1m 23s • $0.0042" rendering when its telemetry path is unified.
 */

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  // Round to whole seconds first, then split into minutes+seconds, so
  // that a remainder rounding up to 60 carries cleanly into the next
  // minute (e.g. 119600ms → "2m 0s", not "1m 60s").
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remSec = totalSeconds - minutes * 60;
  return `${minutes}m ${remSec}s`;
}

export function formatCostUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

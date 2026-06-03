/**
 * Small formatting helpers shared between the GitHub MCP comment server
 * and the GitLab tracking-note builder. Kept platform-agnostic so the
 * two renderers can stay independent while still producing identical
 * telemetry text (e.g. "1m 23s • $0.0042").
 */

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = Math.round(seconds - minutes * 60);
  return `${minutes}m ${remSec}s`;
}

export function formatCostUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${usd.toFixed(4)}`;
}

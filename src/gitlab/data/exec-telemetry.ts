/**
 * Parse `droid exec --output-format stream-json` output captured to a
 * JSONL log file by the GitLab CI template, and extract a small summary
 * of execution telemetry (session IDs, turn counts, durations, token
 * usage). The result is rendered into the sticky tracking note so a
 * reviewer can sanity-check what Droid did without opening the full
 * job log.
 *
 * Mirrors the surface area GitHub's `update-comment-link.ts` extracts
 * from its array-format result file, parameterized for our stream-json
 * one-event-per-line format.
 */

import * as fs from "fs/promises";

export type PassTelemetry = {
  sessionId: string | null;
  numTurns: number | null;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
};

export type ExecTelemetry = {
  pass1: PassTelemetry | null;
  pass2: PassTelemetry | null;
  totalCostUsd: number | null;
  totalDurationMs: number | null;
  totalNumTurns: number | null;
};

const EMPTY_PASS: PassTelemetry = {
  sessionId: null,
  numTurns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  costUsd: null,
};

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function readString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

export function extractPassTelemetry(lines: string[]): PassTelemetry | null {
  let result: PassTelemetry | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line || !line.startsWith("{")) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type !== "completion" && event.type !== "result") continue;

    const usage = (event.usage as Record<string, unknown> | undefined) ?? {};
    result = {
      sessionId: readString(event.session_id) ?? readString(event.sessionId),
      numTurns: readNumber(event.numTurns) ?? readNumber(event.num_turns),
      durationMs: readNumber(event.durationMs) ?? readNumber(event.duration_ms),
      inputTokens:
        readNumber(usage.input_tokens) ?? readNumber(usage.inputTokens),
      outputTokens:
        readNumber(usage.output_tokens) ?? readNumber(usage.outputTokens),
      cacheReadInputTokens:
        readNumber(usage.cache_read_input_tokens) ??
        readNumber(usage.cacheReadInputTokens),
      costUsd: readNumber(event.cost_usd) ?? readNumber(event.costUsd),
    };
    break;
  }

  return result;
}

export async function parseTelemetryFile(
  filePath: string,
): Promise<PassTelemetry | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const lines = raw.split(/\r?\n/);
    return extractPassTelemetry(lines);
  } catch {
    return null;
  }
}

export async function collectExecTelemetry(opts: {
  pass1LogPath?: string | null;
  pass2LogPath?: string | null;
}): Promise<ExecTelemetry> {
  const pass1 = opts.pass1LogPath
    ? await parseTelemetryFile(opts.pass1LogPath)
    : null;
  const pass2 = opts.pass2LogPath
    ? await parseTelemetryFile(opts.pass2LogPath)
    : null;

  const sumNullable = (a: number | null, b: number | null): number | null => {
    if (a === null && b === null) return null;
    return (a ?? 0) + (b ?? 0);
  };

  return {
    pass1,
    pass2,
    totalCostUsd: sumNullable(pass1?.costUsd ?? null, pass2?.costUsd ?? null),
    totalDurationMs: sumNullable(
      pass1?.durationMs ?? null,
      pass2?.durationMs ?? null,
    ),
    totalNumTurns: sumNullable(
      pass1?.numTurns ?? null,
      pass2?.numTurns ?? null,
    ),
  };
}

export function isEmptyPass(p: PassTelemetry | null | undefined): boolean {
  if (!p) return true;
  return (
    p.sessionId === null &&
    p.numTurns === null &&
    p.durationMs === null &&
    p.inputTokens === null &&
    p.outputTokens === null &&
    p.costUsd === null
  );
}

export function emptyPass(): PassTelemetry {
  return { ...EMPTY_PASS };
}

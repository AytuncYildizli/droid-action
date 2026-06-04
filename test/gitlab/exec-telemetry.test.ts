import { describe, it, expect } from "bun:test";
import {
  collectExecTelemetry,
  extractPassTelemetry,
  parseTelemetryFile,
} from "../../src/gitlab/data/exec-telemetry";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

describe("extractPassTelemetry", () => {
  it("returns null when there are no JSON lines", () => {
    expect(extractPassTelemetry([])).toBeNull();
    expect(extractPassTelemetry(["not json", "still not"])).toBeNull();
  });

  it("picks the last completion event and extracts usage fields", () => {
    const lines = [
      '{"type":"system","subtype":"init","session_id":"abc"}',
      '{"type":"message","role":"user"}',
      '{"type":"completion","finalText":"hi","numTurns":12,"durationMs":42000,"session_id":"final-session","usage":{"input_tokens":1000,"output_tokens":250,"cache_read_input_tokens":50000}}',
    ];
    const out = extractPassTelemetry(lines);
    expect(out).not.toBeNull();
    expect(out!.sessionId).toBe("final-session");
    expect(out!.numTurns).toBe(12);
    expect(out!.durationMs).toBe(42000);
    expect(out!.inputTokens).toBe(1000);
    expect(out!.outputTokens).toBe(250);
    expect(out!.cacheReadInputTokens).toBe(50000);
    expect(out!.costUsd).toBeNull();
  });

  it("also recognizes legacy result events with cost_usd", () => {
    const lines = [
      '{"type":"result","cost_usd":0.42,"duration_ms":15000,"num_turns":8,"session_id":"sess"}',
    ];
    const out = extractPassTelemetry(lines);
    expect(out).not.toBeNull();
    expect(out!.costUsd).toBe(0.42);
    expect(out!.durationMs).toBe(15000);
    expect(out!.numTurns).toBe(8);
  });

  it("ignores malformed JSON lines and keeps scanning", () => {
    const lines = [
      "not json at all",
      "{broken",
      '{"type":"completion","numTurns":3,"session_id":"x"}',
    ];
    const out = extractPassTelemetry(lines);
    expect(out!.numTurns).toBe(3);
    expect(out!.sessionId).toBe("x");
  });
});

describe("parseTelemetryFile", () => {
  it("returns null when file doesn't exist", async () => {
    const out = await parseTelemetryFile("/does/not/exist.jsonl");
    expect(out).toBeNull();
  });

  it("parses a real-looking pass log", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "droid-tele-"));
    const file = path.join(tmp, "pass.jsonl");
    await fs.writeFile(
      file,
      [
        '{"type":"system","subtype":"init","session_id":"s1"}',
        '{"type":"completion","numTurns":15,"durationMs":311617,"session_id":"s1","usage":{"input_tokens":35300,"output_tokens":10341}}',
      ].join("\n"),
    );
    const out = await parseTelemetryFile(file);
    expect(out!.sessionId).toBe("s1");
    expect(out!.numTurns).toBe(15);
    expect(out!.durationMs).toBe(311617);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

describe("collectExecTelemetry", () => {
  it("returns null passes and null totals when both files missing", async () => {
    const out = await collectExecTelemetry({
      pass1LogPath: "/missing/pass1.jsonl",
      pass2LogPath: "/missing/pass2.jsonl",
    });
    expect(out.pass1).toBeNull();
    expect(out.pass2).toBeNull();
    expect(out.totalCostUsd).toBeNull();
    expect(out.totalDurationMs).toBeNull();
    expect(out.totalNumTurns).toBeNull();
  });

  it("sums numTurns and durations across both passes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "droid-tele-"));
    const p1 = path.join(tmp, "p1.jsonl");
    const p2 = path.join(tmp, "p2.jsonl");
    await fs.writeFile(
      p1,
      '{"type":"completion","numTurns":15,"durationMs":300000,"session_id":"s1"}',
    );
    await fs.writeFile(
      p2,
      '{"type":"completion","numTurns":29,"durationMs":400000,"session_id":"s2"}',
    );
    const out = await collectExecTelemetry({
      pass1LogPath: p1,
      pass2LogPath: p2,
    });
    expect(out.pass1!.sessionId).toBe("s1");
    expect(out.pass2!.sessionId).toBe("s2");
    expect(out.totalNumTurns).toBe(44);
    expect(out.totalDurationMs).toBe(700000);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});

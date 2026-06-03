import { describe, expect, it } from "bun:test";
import {
  formatCostUsd,
  formatDurationMs,
} from "../../../../src/core/review/tracking/format";

describe("formatDurationMs", () => {
  it("renders sub-second durations in ms", () => {
    expect(formatDurationMs(0)).toBe("0ms");
    expect(formatDurationMs(750)).toBe("750ms");
  });

  it("renders sub-minute durations to one decimal in seconds", () => {
    expect(formatDurationMs(1500)).toBe("1.5s");
    expect(formatDurationMs(59999)).toBe("60.0s");
  });

  it("renders multi-minute durations as `Xm Ys`", () => {
    expect(formatDurationMs(60000)).toBe("1m 0s");
    expect(formatDurationMs(90000)).toBe("1m 30s");
    expect(formatDurationMs(125000)).toBe("2m 5s");
  });

  it("carries the remainder cleanly when seconds round up to 60", () => {
    // Pre-fix bug: 119600ms produced "1m 60s" because remSec rounded to 60.
    expect(formatDurationMs(119600)).toBe("2m 0s");
    expect(formatDurationMs(179600)).toBe("3m 0s");
    expect(formatDurationMs(239600)).toBe("4m 0s");
  });
});

describe("formatCostUsd", () => {
  it("uses 4 decimals under $1", () => {
    expect(formatCostUsd(0.0042)).toBe("$0.0042");
    expect(formatCostUsd(0.5)).toBe("$0.5000");
  });

  it("uses 2 decimals at $1 or above", () => {
    expect(formatCostUsd(1)).toBe("$1.00");
    expect(formatCostUsd(12.345)).toBe("$12.35");
  });
});

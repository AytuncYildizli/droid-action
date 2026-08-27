#!/usr/bin/env bun

import { describe, test, expect } from "bun:test";
import {
  filterUnsupportedToolsForModel,
  isUsageLimitError,
  prepareRunConfig,
  prepareUsageFallbackArgs,
  sanitizeDroidErrorMessage,
  sanitizeJsonOutput,
  type DroidOptions,
} from "../src/run-droid";

describe("Droid Core usage fallback", () => {
  test("recognizes the monthly Core 402 receipt", () => {
    expect(
      isUsageLimitError(
        '402 {"detail":"You\'ve reached your monthly Droid Core usage limit (resets in 4 days)."}',
      ),
    ).toBe(true);
    expect(isUsageLimitError("503 Service Unavailable")).toBe(false);
    expect(isUsageLimitError("402 invalid request")).toBe(false);
  });

  test("switches to the configured local model and removes unsupported flags", () => {
    expect(
      prepareUsageFallbackArgs(
        [
          "exec",
          "--model",
          "glm-5.2",
          "--reasoning-effort",
          "high",
          "--enabled-tools",
          "Read,Edit,Create,ApplyPatch,Execute",
          "-f",
          "/tmp/prompt.txt",
        ],
        "custom:Local-GLM-5.2-0",
      ),
    ).toEqual([
      "exec",
      "--model",
      "custom:Local-GLM-5.2-0",
      "--enabled-tools",
      "Read,Edit,Create,Execute",
      "-f",
      "/tmp/prompt.txt",
    ]);
  });

  test("adds the fallback model when the primary relied on the org default", () => {
    const args = prepareUsageFallbackArgs(
      ["exec", "--enabled-tools=Read,ApplyPatch,Execute", "-f", "prompt"],
      "custom:Local-GLM-5.2-0",
    );

    expect(args).toContain("--model=custom:Local-GLM-5.2-0");
    expect(args).toContain("--enabled-tools=Read,Execute");
  });

  test("filters ApplyPatch from a primary GLM Core invocation", () => {
    expect(
      filterUnsupportedToolsForModel([
        "--model=GLM-5.2",
        "--enabled-tools=Read,Edit,Create,ApplyPatch,Execute",
      ]),
    ).toEqual(["--model=GLM-5.2", "--enabled-tools=Read,Edit,Create,Execute"]);
  });

  test("surfaces only a redacted bounded structured error", () => {
    const output = sanitizeJsonOutput(
      {
        type: "error",
        message:
          "Bearer abc.def.ghi fk-supersecret https://x.test/?access_token=visible",
        raw_response: { secret: "must-not-leak" },
      },
      false,
    );

    expect(JSON.parse(output!)).toEqual({
      type: "error",
      message: "Bearer *** fk-*** https://x.test/?access_token=***",
    });
    expect(output).not.toContain("must-not-leak");
    expect(
      sanitizeDroidErrorMessage(`line one\n${"x".repeat(1000)}`).length,
    ).toBeLessThanOrEqual(801);
  });

  test("redacts custom model credentials embedded in settings input", () => {
    const originalSettings = process.env.INPUT_SETTINGS;
    process.env.INPUT_SETTINGS = JSON.stringify({
      customModels: [{ apiKey: "fallback-gateway-secret" }],
    });
    try {
      expect(
        sanitizeDroidErrorMessage(
          "request failed with fallback-gateway-secret",
        ),
      ).toBe("request failed with ***");
    } finally {
      if (originalSettings === undefined) {
        delete process.env.INPUT_SETTINGS;
      } else {
        process.env.INPUT_SETTINGS = originalSettings;
      }
    }
  });
});

describe("prepareRunConfig", () => {
  test("should prepare config with basic arguments", () => {
    const options: DroidOptions = {};
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.droidArgs).toEqual([
      "exec",
      "--output-format",
      "stream-json",
      "--skip-permissions-unsafe",
      "-f",
      "/tmp/test-prompt.txt",
    ]);
  });

  test("should include promptPath", () => {
    const options: DroidOptions = {};
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.promptPath).toBe("/tmp/test-prompt.txt");
  });

  test("should forward the configured max turns to Droid Exec", () => {
    const options: DroidOptions = { maxTurns: "120" };
    const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

    expect(prepared.droidArgs).toEqual([
      "exec",
      "--output-format",
      "stream-json",
      "--skip-permissions-unsafe",
      "--max-turns",
      "120",
      "-f",
      "/tmp/test-prompt.txt",
    ]);
  });

  test("should use provided prompt path", () => {
    const options: DroidOptions = {};
    const prepared = prepareRunConfig("/custom/prompt/path.txt", options);

    expect(prepared.promptPath).toBe("/custom/prompt/path.txt");
  });

  describe("droidArgs handling", () => {
    test("should parse and include custom Droid arguments", () => {
      const options: DroidOptions = {
        droidArgs: "--max-turns 10 --model factory-droid-latest",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

      expect(prepared.droidArgs).toEqual([
        "exec",
        "--output-format",
        "stream-json",
        "--skip-permissions-unsafe",
        "--max-turns",
        "10",
        "--model",
        "factory-droid-latest",
        "-f",
        "/tmp/test-prompt.txt",
      ]);
    });

    test("should handle empty droidArgs", () => {
      const options: DroidOptions = {
        droidArgs: "",
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

      expect(prepared.droidArgs).toEqual([
        "exec",
        "--output-format",
        "stream-json",
        "--skip-permissions-unsafe",
        "-f",
        "/tmp/test-prompt.txt",
      ]);
    });

    test("should handle droidArgs with quoted strings", () => {
      const options: DroidOptions = {
        droidArgs: '--system-prompt "You are a helpful assistant"',
      };
      const prepared = prepareRunConfig("/tmp/test-prompt.txt", options);

      expect(prepared.droidArgs).toEqual([
        "exec",
        "--output-format",
        "stream-json",
        "--skip-permissions-unsafe",
        "--system-prompt",
        "You are a helpful assistant",
        "-f",
        "/tmp/test-prompt.txt",
      ]);
    });
  });
});

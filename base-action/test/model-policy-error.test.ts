import { describe, expect, it } from "bun:test";
import {
  isModelPolicyError,
  stripModelArgs,
} from "../src/utils/model-policy-error";

describe("isModelPolicyError", () => {
  it("matches the model policy 403 message", () => {
    expect(
      isModelPolicyError(
        `403 {"detail":"This model is not available due to your organization's security settings.","status":403}`,
      ),
    ).toBe(true);
  });

  it("matches with a curly apostrophe", () => {
    expect(
      isModelPolicyError(
        "This model is not available due to your organization’s security settings.",
      ),
    ).toBe(true);
  });

  it("matches the explicit opt-in 403 message", () => {
    expect(
      isModelPolicyError(
        "403 This model requires explicit organization opt-in by an admin.",
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isModelPolicyError("429 Too Many Requests")).toBe(false);
    expect(isModelPolicyError(undefined)).toBe(false);
  });
});

describe("stripModelArgs", () => {
  it("removes --model and its value", () => {
    expect(
      stripModelArgs(["exec", "--model", "gpt-5.2", "-f", "prompt.txt"]),
    ).toEqual(["exec", "-f", "prompt.txt"]);
  });

  it("removes --reasoning-effort and its value", () => {
    expect(
      stripModelArgs(["exec", "--reasoning-effort", "high", "-f", "p.txt"]),
    ).toEqual(["exec", "-f", "p.txt"]);
  });

  it("removes --flag=value forms", () => {
    expect(
      stripModelArgs(["exec", "--model=gpt-5.2", "--reasoning-effort=high"]),
    ).toEqual(["exec"]);
  });

  it("removes both flags while preserving other args", () => {
    expect(
      stripModelArgs([
        "exec",
        "--output-format",
        "stream-json",
        "--model",
        "kimi-k2.6",
        "--reasoning-effort",
        "high",
        "--tag",
        "code-review",
      ]),
    ).toEqual([
      "exec",
      "--output-format",
      "stream-json",
      "--tag",
      "code-review",
    ]);
  });

  it("returns args unchanged when no model flags are present", () => {
    const args = ["exec", "--output-format", "stream-json", "-f", "p.txt"];
    expect(stripModelArgs(args)).toEqual(args);
  });
});

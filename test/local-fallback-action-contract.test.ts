import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

describe("local model fallback action contract", () => {
  test("top-level action exposes and forwards fallback_model to both review passes", async () => {
    const action = await readFile(join(root, "action.yml"), "utf8");

    expect(action).toContain("  fallback_model:");
    expect(action.match(/INPUT_FALLBACK_MODEL:/g)?.length).toBe(2);
    expect(action).not.toContain("Collect .factory debug files");
    expect(action).not.toContain("Upload debug artifacts");
  });

  test("top-level action exposes and forwards max_turns to both review passes", async () => {
    const action = await readFile(join(root, "action.yml"), "utf8");

    expect(action).toContain("  max_turns:");
    expect(action.match(/INPUT_MAX_TURNS:/g)?.length).toBe(2);
  });

  test("validator reuses the authenticated token from the prepare pass", async () => {
    const action = await readFile(join(root, "action.yml"), "utf8");
    const validatorStep = action.slice(
      action.indexOf("    - name: Prepare validator"),
      action.indexOf("    - name: Run Droid Exec (validator)"),
    );

    expect(validatorStep).toContain(
      "OVERRIDE_GITHUB_TOKEN: ${{ steps.prepare.outputs.github_token }}",
    );
  });

  test("base action exposes and forwards fallback_model", async () => {
    const action = await readFile(join(root, "base-action/action.yml"), "utf8");

    expect(action).toContain("  fallback_model:");
    expect(action).toContain(
      "INPUT_FALLBACK_MODEL: ${{ inputs.fallback_model }}",
    );
  });

  test("base action exposes and forwards max_turns", async () => {
    const action = await readFile(join(root, "base-action/action.yml"), "utf8");

    expect(action).toContain("  max_turns:");
    expect(action).toContain("INPUT_MAX_TURNS: ${{ inputs.max_turns }}");
  });
});

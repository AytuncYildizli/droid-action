import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  changedFilesSince,
  protectedViolations,
  revertProtectedPaths,
} from "../src/steward/postrun";

// The fleet cannot force this path: it only fires when the model edits a
// protected file, and in the sandbox the model correctly declined to. Proving
// the guard works therefore has to happen against a real repository here,
// otherwise all we know is that the model behaved, not that it is contained.
describe("CI Steward protected path enforcement", () => {
  let repo: string;
  const git = (...args: string[]) => $`git ${args}`.cwd(repo).quiet();
  const write = (file: string, body: string) => {
    const target = path.join(repo, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  };
  const read = (file: string) => Bun.file(path.join(repo, file)).text();

  beforeEach(async () => {
    repo = mkdtempSync(path.join(tmpdir(), "steward-postrun-"));
    await git("init", "-q", "-b", "main");
    await git("config", "user.email", "test@example.com");
    await git("config", "user.name", "test");
    write(".github/workflows/ci.yml", "name: CI\n");
    write("src/app.ts", "export const x = 1;\n");
    await git("add", "-A");
    await git("commit", "-qm", "base");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  test("restores a protected file while keeping a legitimate fix", async () => {
    const baseSha = (await git("rev-parse", "HEAD").text()).trim();

    // Stand in for a run that edited both an allowed and a protected path.
    write(".github/workflows/ci.yml", "name: CI\non: [push]\n");
    write("src/app.ts", "export const x = 2;\n");
    await git("add", "-A");
    await git("commit", "-qm", "fix(ci): repair the build");

    const changed = await changedFilesSince(baseSha, repo);
    expect(changed.sort()).toEqual([".github/workflows/ci.yml", "src/app.ts"]);

    const violations = protectedViolations([".github/workflows/**"], changed);
    expect(violations).toEqual([".github/workflows/ci.yml"]);

    await revertProtectedPaths(baseSha, violations, repo);

    expect(await read(".github/workflows/ci.yml")).toBe("name: CI\n");
    expect(await read("src/app.ts")).toBe("export const x = 2;\n");

    // The restore is committed, so what the branch would push is already clean.
    const finalDiff = await changedFilesSince(baseSha, repo);
    expect(finalDiff).toEqual(["src/app.ts"]);
  });

  test("leaves the tree untouched when nothing protected changed", async () => {
    const baseSha = (await git("rev-parse", "HEAD").text()).trim();
    write("src/app.ts", "export const x = 3;\n");
    await git("add", "-A");
    await git("commit", "-qm", "fix(ci): unrelated");

    const changed = await changedFilesSince(baseSha, repo);
    expect(protectedViolations([".github/workflows/**"], changed)).toEqual([]);
  });
});

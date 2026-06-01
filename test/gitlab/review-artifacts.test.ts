import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  buildDescriptionContent,
  buildDiffContent,
  computeReviewArtifacts,
} from "../../src/gitlab/data/review-artifacts";
import type { GitlabClient } from "../../src/gitlab/api/client";

function fakeClient(opts: {
  mr?: object;
  changes?: object;
  notes?: object;
}): GitlabClient {
  return {
    getMr: async () => opts.mr ?? {},
    getMrChanges: async () => opts.changes ?? { changes: [] },
    listNotes: async () => opts.notes ?? [],
  } as unknown as GitlabClient;
}

describe("buildDiffContent", () => {
  it("returns empty string when there are no changes", () => {
    expect(buildDiffContent({ changes: [] } as never)).toBe("");
  });

  it("emits a `diff --git` header per file using old/new paths", () => {
    const out = buildDiffContent({
      changes: [
        {
          old_path: "a/foo.ts",
          new_path: "a/foo.ts",
          diff: "@@ -1 +1 @@\n-old\n+new\n",
          a_mode: "",
          b_mode: "",
          new_file: false,
          renamed_file: false,
          deleted_file: false,
        },
        {
          old_path: "b/old.ts",
          new_path: "b/renamed.ts",
          diff: "@@ -1 +1 @@\n line\n",
          a_mode: "",
          b_mode: "",
          new_file: false,
          renamed_file: true,
          deleted_file: false,
        },
      ],
    } as never);
    expect(out).toContain("diff --git a/a/foo.ts b/a/foo.ts");
    expect(out).toContain("diff --git a/b/old.ts b/b/renamed.ts");
    expect(out).toContain("-old");
    expect(out).toContain("+new");
  });

  it("falls back to new_path when old_path is missing (new file)", () => {
    const out = buildDiffContent({
      changes: [
        {
          old_path: "",
          new_path: "src/new.ts",
          diff: "+content\n",
          a_mode: "",
          b_mode: "",
          new_file: true,
          renamed_file: false,
          deleted_file: false,
        },
      ],
    } as never);
    expect(out).toContain("diff --git a/src/new.ts b/src/new.ts");
  });
});

describe("buildDescriptionContent", () => {
  it("includes the title and description", () => {
    const out = buildDescriptionContent({
      title: "Add feature X",
      description: "Closes #1.",
    } as never);
    expect(out).toContain("Title: Add feature X");
    expect(out).toContain("Closes #1.");
  });

  it("tolerates a null description", () => {
    const out = buildDescriptionContent({
      title: "T",
      description: null,
    } as never);
    expect(out).toContain("Title: T");
  });
});

describe("computeReviewArtifacts", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "droid-artifacts-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("writes mr.diff, existing_comments.json, mr_description.txt", async () => {
    const client = fakeClient({
      mr: {
        title: "Hello",
        description: "world",
        diff_refs: { base_sha: "b", head_sha: "h", start_sha: "s" },
      },
      changes: {
        changes: [
          {
            old_path: "x.ts",
            new_path: "x.ts",
            diff: "@@ -1 +1 @@\n+x\n",
            a_mode: "",
            b_mode: "",
            new_file: false,
            renamed_file: false,
            deleted_file: false,
          },
        ],
      },
      notes: [{ id: 1, body: "hi", system: false }],
    });

    const result = await computeReviewArtifacts({
      client,
      projectId: "42",
      mrIid: 7,
      outDir: tmp,
    });

    expect(result.diffPath).toBe(path.join(tmp, "mr.diff"));
    expect(result.commentsPath).toBe(path.join(tmp, "existing_comments.json"));
    expect(result.descriptionPath).toBe(path.join(tmp, "mr_description.txt"));

    const diff = await fs.readFile(result.diffPath, "utf8");
    expect(diff).toContain("diff --git a/x.ts b/x.ts");

    const comments = JSON.parse(await fs.readFile(result.commentsPath, "utf8"));
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("hi");

    const desc = await fs.readFile(result.descriptionPath, "utf8");
    expect(desc).toContain("Title: Hello");
    expect(desc).toContain("world");
  });
});

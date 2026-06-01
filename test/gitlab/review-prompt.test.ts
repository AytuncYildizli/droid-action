import { describe, expect, it } from "bun:test";
import { buildGitlabReviewPrompt } from "../../src/gitlab/review-prompt";

describe("buildGitlabReviewPrompt", () => {
  it("renders project path, MR iid, title, and diff", () => {
    const prompt = buildGitlabReviewPrompt({
      projectPath: "group/sub/repo",
      mrIid: 42,
      mrTitle: "Add widget",
      diff: "diff --git a/x.ts b/x.ts\n+const a = 1;",
      reviewDepth: "deep",
    });

    expect(prompt).toContain('merge request !42 in project "group/sub/repo"');
    expect(prompt).toContain("Title: Add widget");
    expect(prompt).toContain("```diff");
    expect(prompt).toContain("+const a = 1;");
    expect(prompt).toContain("submit_review");
    expect(prompt).toContain("mr_iid=42");
  });

  it("uses (empty diff) when diff is blank", () => {
    const prompt = buildGitlabReviewPrompt({
      projectPath: "g/r",
      mrIid: 1,
      mrTitle: null,
      diff: "",
      reviewDepth: "shallow",
    });
    expect(prompt).toContain("(empty diff)");
    expect(prompt).not.toContain("Title:");
  });

  it("respects custom maxInlineComments", () => {
    const prompt = buildGitlabReviewPrompt({
      projectPath: "g/r",
      mrIid: 1,
      mrTitle: null,
      diff: "x",
      reviewDepth: "deep",
      maxInlineComments: 3,
    });
    expect(prompt).toContain("at most 3 inline comments");
  });
});

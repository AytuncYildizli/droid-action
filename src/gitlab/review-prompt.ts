/**
 * Minimal v1 review prompt builder for GitLab merge requests.
 *
 * This is intentionally simple; the cross-platform prompt in
 * src/create-prompt/ will replace it in a later step.
 */

export interface GitlabReviewPromptOptions {
  projectPath: string;
  mrIid: number;
  mrTitle: string | null;
  diff: string;
  reviewDepth: string;
  maxInlineComments?: number;
}

const DEFAULT_MAX_COMMENTS = 8;

export function buildGitlabReviewPrompt(
  opts: GitlabReviewPromptOptions,
): string {
  const max = opts.maxInlineComments ?? DEFAULT_MAX_COMMENTS;
  const lines: string[] = [];

  lines.push(
    `You are reviewing GitLab merge request !${opts.mrIid} in project "${opts.projectPath}".`,
  );
  if (opts.mrTitle) {
    lines.push(`Title: ${opts.mrTitle}`);
  }
  lines.push("");
  lines.push("## Instructions");
  lines.push("");
  lines.push(
    "1. Read the diff carefully. Focus on correctness, security, and obvious bugs.",
  );
  lines.push(
    "2. Only flag high-confidence issues (P0/P1). Do not nit on style.",
  );
  lines.push(
    `3. Post all findings via a SINGLE call to the \`submit_review\` tool with mr_iid=${opts.mrIid}.`,
  );
  lines.push(
    `4. Hard cap: at most ${max} inline comments per review. Prioritize the highest-severity issues.`,
  );
  lines.push(
    "5. For each inline comment, set `path` to the new_path from the diff and `line` to the new-file line number (the line beginning with `+`).",
  );
  lines.push(
    '6. If you find NO bugs, still call `submit_review` with `body: "LGTM - no issues found."` and an empty comments array.',
  );
  lines.push("7. Do not call any other tool; do not edit code.");
  lines.push("");
  lines.push("## Diff");
  lines.push("");
  lines.push("```diff");
  lines.push(opts.diff.trim() || "(empty diff)");
  lines.push("```");

  return lines.join("\n");
}

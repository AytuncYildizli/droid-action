/**
 * GitLab Pass-1 (candidate generation) prompt.
 *
 * Direct port of the GitHub Action's
 * `src/create-prompt/templates/review-candidates-prompt.ts` with PR→MR
 * terminology and GitLab-specific entity numbering. The /review skill
 * itself is platform-agnostic and contains the two-pass methodology; this
 * file is the runtime harness that tells Droid which pass it's in, where
 * the input artifacts live on disk, and where to write the candidate JSON.
 *
 * STRICT contract: this prompt MUST NOT instruct the model to call the
 * GitLab posting tool (`gitlab_mr___submit_review`). Posting only happens
 * in Pass 2. Tool gating is also enforced at the `droid exec` level by
 * excluding `gitlab_mr___submit_review` from `--enabled-tools` during
 * Pass 1.
 */

import type { GitlabReviewPromptContext } from "./types";

export function generateGitlabReviewCandidatesPrompt(
  ctx: GitlabReviewPromptContext,
): string {
  const {
    projectPath,
    mrIid,
    sourceBranch,
    targetBranch,
    headSha,
    diffPath,
    commentsPath,
    descriptionPath,
    candidatesPath,
    includeSuggestions,
    securityReviewEnabled,
  } = ctx;

  const bodyFieldDescription = includeSuggestions
    ? "  - `body`: Comment text starting with priority tag [P0|P1|P2], then title, then 1 paragraph explanation.\n" +
      "    Follow the suggestion block rules from the review skill when including suggestions."
    : "  - `body`: Comment text starting with priority tag [P0|P1|P2], then title, then 1 paragraph explanation";

  const sideFieldDescription = includeSuggestions
    ? '  - `side`: "RIGHT" for new/modified code (default). Use "LEFT" only for removed code **without** suggestions.\n' +
      "    If you include a suggestion block, choose a RIGHT-side anchor and keep it unchanged so the validator can reuse it."
    : '  - `side`: "RIGHT" for new/modified code (default), "LEFT" only for removed code';

  const skillInstruction = includeSuggestions
    ? "Invoke the 'review' skill to load the review methodology, then execute its **Pass 1: Candidate Generation** procedure — including suggestion block rules."
    : "Invoke the 'review' skill to load the review methodology, then execute its **Pass 1: Candidate Generation** procedure. Do NOT include code suggestion blocks.";

  const securitySubagentInstruction = securityReviewEnabled
    ? `

## Security Review (run concurrently)

In addition to the code review, you MUST also spawn a \`security-reviewer\` subagent via the Task tool.
This subagent runs **concurrently** with the code review subagents during Step 2.

Spawn it with:
- \`subagent_type\`: "security-reviewer"
- \`description\`: "Security review"
- \`prompt\`: Include the full MR context (project, MR IID, head SHA, target branch) and the paths to precomputed data files (diff, description, existing comments). The security-reviewer will invoke the security-review skill and return a JSON array of security findings.

**IMPORTANT**: Spawn the security-reviewer in the SAME response as the code review subagents so they all run in parallel.

After all subagents complete (both code review and security-reviewer), merge the security findings into the \`comments\` array alongside code review findings. Security findings use the same schema but are prefixed with \`[security]\` in their body (e.g., \`[P1] [security] Title\`).
`
    : "";

  return `You are a senior staff software engineer and expert code reviewer.

Your task: Review MR !${mrIid} in ${projectPath} and generate a JSON file with **high-confidence, actionable** review comments that pinpoint genuine issues.

${skillInstruction}${securitySubagentInstruction}

<context>
Project: ${projectPath}
MR IID: ${mrIid}
MR Source Branch: ${sourceBranch}
MR Head SHA: ${headSha}
MR Target Branch: ${targetBranch}

Precomputed data files:
- MR Description: \`${descriptionPath}\`
- Full MR Diff: \`${diffPath}\`
- Existing Comments: \`${commentsPath}\`
</context>

<output_spec>
Write output to \`${candidatesPath}\` using this exact schema:

\`\`\`json
{
  "version": 1,
  "meta": {
    "project": "group/project",
    "mrIid": 123,
    "headSha": "<head sha>",
    "targetBranch": "main",
    "generatedAt": "<ISO timestamp>"
  },
  "comments": [
    {
      "path": "src/index.ts",
      "body": "[P1] Title\\n\\n1 paragraph.",
      "line": 42,
      "startLine": null,
      "side": "RIGHT",
      "commit_id": "<head sha>"
    }
  ],
  "reviewSummary": {
    "body": "1-3 sentence overall assessment"
  }
}
\`\`\`

<schema_details>
- **version**: Always \`1\`

- **meta**: Metadata object
  - \`project\`: "${projectPath}"
  - \`mrIid\`: ${mrIid}
  - \`headSha\`: "${headSha}"
  - \`targetBranch\`: "${targetBranch}"
  - \`generatedAt\`: ISO 8601 timestamp (e.g., "2024-01-15T10:30:00Z")

- **comments**: Array of comment objects
  - \`path\`: Relative file path (use the new_path from the diff, e.g., "src/index.ts")
${bodyFieldDescription}
  - \`line\`: Target line number in the new file (single-line) or end line number (multi-line). Must be ≥ 0.
  - \`startLine\`: \`null\` for single-line comments, or start line number for multi-line comments
${sideFieldDescription}
  - \`commit_id\`: "${headSha}"

- **reviewSummary**:
  - \`body\`: 1-3 sentence overall assessment
</schema_details>
</output_spec>

<critical_constraints>
**DO NOT** post to GitLab.
**DO NOT** invoke any MR mutation tools (\`gitlab_mr___submit_review\`, \`gitlab_mr___create_mr_note\`, \`gitlab_mr___update_mr_note\`, \`gitlab_mr___update_mr_description\`, \`gitlab_mr___update_tracking_note\`, etc.).
**DO NOT** modify any files other than writing to \`${candidatesPath}\`.
Output ONLY the JSON file—no additional commentary.
</critical_constraints>
`;
}

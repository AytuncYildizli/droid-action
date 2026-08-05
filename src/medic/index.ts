import * as core from "@actions/core";
import { mkdir, writeFile } from "fs/promises";
import type { WorkflowRunEvent } from "@octokit/webhooks-types";
import type { AutomationContext } from "../github/context";
import type { Octokits } from "../github/api/client";
import { prepareMcpTools } from "../mcp/install-mcp-server";
import { loadMedicConfig } from "./config";
import {
  resolvePullRequest,
  shouldProcessWorkflow,
  shouldSkipPullRequest,
  waitForChecksToFinish,
} from "./gate";
import type { PrepareResult } from "../prepare/types";

export const MEDIC_RUN_MARKER_PREFIX = "<!-- ci-medic:run=";

// Every namespaced entry here must be backed by an MCP server that
// prepareMcpTools actually installs for a workflow_run context, or the CLI
// rejects the whole run with "Unknown tool identifier(s)".
export const MEDIC_ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "LS",
  "Execute",
  "Edit",
  "Create",
  "ApplyPatch",
  "github_comment___update_droid_comment",
  "github_ci___get_ci_status",
  "github_ci___get_workflow_run_details",
  "github_ci___download_job_log",
  "github_ci___rerun_failed_job",
  "github_inline_comment___create_inline_comment",
];

export async function prepareMedicMode(
  context: AutomationContext,
  octokit: Octokits,
  githubToken: string,
): Promise<PrepareResult> {
  if (context.eventName !== "workflow_run") {
    throw new Error("CI Medic requires a workflow_run event");
  }
  const event = context.payload as unknown as WorkflowRunEvent;
  const run = event.workflow_run;
  const actionConfig = {
    ...(context.inputs.instructions && {
      instructions: context.inputs.instructions,
    }),
    ...((context.inputs.retryMode && context.inputs.retryMode !== "smart") ||
    (context.inputs.maxRetries && context.inputs.maxRetries !== 1)
      ? {
          retry: {
            mode: context.inputs.retryMode ?? "smart",
            max_per_job: context.inputs.maxRetries ?? 1,
            eligible: [],
            exclude: [],
          },
        }
      : {}),
    ...(context.inputs.autoFix
      ? {
          fix: {
            enabled: true,
            max_attempts: context.inputs.maxFixAttempts ?? 2,
            protected_paths: [".github/workflows/**"],
            scope: ["lint", "types", "tests", "build"],
            commit_prefix: "fix(ci): ",
          },
        }
      : {}),
    ...(context.inputs.maxRunsPerPr && context.inputs.maxRunsPerPr !== 10
      ? { max_runs_per_pr: context.inputs.maxRunsPerPr }
      : {}),
  };
  const config = await loadMedicConfig(
    octokit,
    context.repository.owner,
    context.repository.repo,
    run.head_branch,
    context.inputs.configPath ?? ".github/droid-ci.yml",
    actionConfig,
  );

  if (!shouldProcessWorkflow(event, config)) {
    return skippedResult("workflow_not_actionable");
  }
  const pr = await resolvePullRequest(
    octokit,
    context.repository.owner,
    context.repository.repo,
    event,
  );
  if (!pr) return skippedResult("no_open_pull_request");

  const { data: prData } = await octokit.rest.pulls.get({
    owner: context.repository.owner,
    repo: context.repository.repo,
    pull_number: pr.number,
  });
  const labels = prData.labels.map((label) =>
    typeof label === "string" ? label : label.name,
  );
  if (shouldSkipPullRequest(pr, config, labels))
    return skippedResult("pull_request_skipped");

  const { data: comments } = await octokit.rest.issues.listComments({
    owner: context.repository.owner,
    repo: context.repository.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  // The lifetime count lives in a marker on a single reused tracking comment
  // rather than in the number of comments, because Droid rewrites the body of
  // the comment it is given and would otherwise erase each run's own record.
  const trackingComment = comments.find((comment) =>
    comment.body?.includes(MEDIC_RUN_MARKER_PREFIX),
  );
  const medicRuns = Number(
    trackingComment?.body?.match(
      /<!-- ci-medic:run=\S+ count=(\d+) -->/,
    )?.[1] ?? 0,
  );
  if (medicRuns >= config.max_runs_per_pr) {
    await octokit.rest.issues.createComment({
      owner: context.repository.owner,
      repo: context.repository.repo,
      issue_number: pr.number,
      body: `## CI Medic\n\nCI Medic has reached the lifetime limit of ${config.max_runs_per_pr} runs for this pull request. A human should investigate the remaining failures.\n\n<!-- ci-medic:budget-exhausted -->`,
    });
    return skippedResult("max_runs_per_pr");
  }

  await waitForChecksToFinish(
    octokit,
    context.repository.owner,
    context.repository.repo,
    pr.headSha,
    run.id,
  );

  const trackingBody = `## CI Medic\n\nCI Medic is analyzing the completed workflow run [${run.name}](${run.html_url}) and the other checks for this commit.\n\n${MEDIC_RUN_MARKER_PREFIX}${context.runId} count=${medicRuns + 1} -->`;
  const comment = trackingComment
    ? await octokit.rest.issues.updateComment({
        owner: context.repository.owner,
        repo: context.repository.repo,
        comment_id: trackingComment.id,
        body: trackingBody,
      })
    : await octokit.rest.issues.createComment({
        owner: context.repository.owner,
        repo: context.repository.repo,
        issue_number: pr.number,
        body: trackingBody,
      });
  core.setOutput("droid_comment_id", comment.data.id.toString());
  core.setOutput("medic_pr_number", pr.number.toString());
  core.setOutput("run_code_review", "false");
  core.exportVariable("MEDIC_PR_NUMBER", pr.number.toString());
  core.exportVariable("DROID_EXEC_RUN_TYPE", "ci-medic");

  const prompt = `You are CI Medic for ${context.repository.full_name}, pull request #${pr.number}.

The workflow run that triggered this execution is ${run.name} (${run.id}) with conclusion ${run.conclusion}.
Head SHA: ${pr.headSha}. Head branch: ${pr.headRef}. Base branch: ${pr.baseRef}.

Use the GitHub CI tools to inspect every completed workflow and download failed job logs. Diagnose each failure and classify it as real, flaky, infrastructure, or configuration.

Retry policy: ${config.retry.mode}; maximum retries per job: ${config.retry.max_per_job}.
Auto-fix enabled: ${config.fix.enabled}; maximum fix attempts: ${config.fix.max_attempts}.
Allowed fix scope: ${config.fix.scope.join(", ")}. Protected paths: ${config.fix.protected_paths.join(", ")}.
Commit prefix: ${config.fix.commit_prefix}

If a failure is flaky or infrastructure-related and retries are allowed, rerun the failed job. If it is a real code failure and auto-fix is enabled, implement and verify a focused fix, then commit it to the PR branch using the commit prefix. If auto-fix is disabled, post high-confidence inline suggestions instead of changing files. Never modify protected paths.

This pull request may have been analyzed before. Read the existing review comments first and do not repost a suggestion that already exists for the same file and line.

Report your findings by updating the existing CI Medic comment with a concise diagnosis, actions taken, and what remains. Update that one comment; do not create additional pull request comments.

Additional repository instructions:
${config.instructions || "(none)"}`;
  await mkdir(`${process.env.RUNNER_TEMP || "/tmp"}/droid-prompts`, {
    recursive: true,
  });
  await writeFile(
    `${process.env.RUNNER_TEMP || "/tmp"}/droid-prompts/droid-prompt.txt`,
    prompt,
  );

  const allowedTools = MEDIC_ALLOWED_TOOLS;
  const mcpTools = await prepareMcpTools({
    githubToken,
    owner: context.repository.owner,
    repo: context.repository.repo,
    droidCommentId: comment.data.id.toString(),
    allowedTools,
    mode: "tag",
    context,
  });
  const args = [
    `--enabled-tools "${allowedTools.join(",")}"`,
    '--tag "ci-medic"',
  ];
  if (context.inputs.medicModel?.trim())
    args.push(`--model "${context.inputs.medicModel.trim()}"`);
  if (process.env.DROID_ARGS?.trim()) args.push(process.env.DROID_ARGS.trim());
  core.setOutput("droid_args", args.join(" "));
  core.setOutput("mcp_tools", mcpTools);
  return {
    commentId: comment.data.id,
    branchInfo: { baseBranch: pr.baseRef, currentBranch: pr.headRef },
    mcpTools,
  };
}

function skippedResult(reason: string): PrepareResult {
  core.setOutput("medic_skipped", "true");
  console.log(`CI Medic skipped: ${reason}`);
  return {
    skipped: true,
    reason,
    branchInfo: { baseBranch: "", currentBranch: "" },
    mcpTools: "",
  };
}

import type { WorkflowRunEvent } from "@octokit/webhooks-types";
import type { Octokits } from "../github/api/client";
import type { MedicConfig } from "./config";

export type MedicPullRequest = {
  number: number;
  headSha: string;
  headRef: string;
  baseRef: string;
  author: string;
  draft: boolean;
};

export function getWorkflowRun(event: WorkflowRunEvent) {
  return event.workflow_run;
}

export function shouldProcessWorkflow(
  event: WorkflowRunEvent,
  config: MedicConfig,
): boolean {
  const run = getWorkflowRun(event);
  if (run.conclusion !== "failure" && run.conclusion !== "timed_out")
    return false;
  return !config.workflows.exclude.some((pattern) =>
    wildcard(pattern, run.name),
  );
}

function wildcard(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

export async function resolvePullRequest(
  octokit: Octokits,
  owner: string,
  repo: string,
  event: WorkflowRunEvent,
): Promise<MedicPullRequest | undefined> {
  const run = getWorkflowRun(event);
  const candidate = run.pull_requests?.[0];
  const number = candidate?.number;
  const response = number
    ? await octokit.rest.pulls.get({ owner, repo, pull_number: number })
    : await octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${run.head_branch}`,
        state: "open",
        per_page: 1,
      });
  const pr = (
    Array.isArray(response.data) ? response.data[0] : response.data
  ) as
    | {
        number: number;
        head?: { ref: string };
        base?: { ref: string };
        user?: { login?: string };
        draft?: boolean;
      }
    | undefined;
  if (!pr) return undefined;
  return {
    number: pr.number,
    headSha: run.head_sha,
    headRef: "head" in pr && pr.head ? pr.head.ref : run.head_branch,
    baseRef: "base" in pr && pr.base ? pr.base.ref : "main",
    author: pr.user?.login ?? "",
    draft: Boolean(pr.draft),
  };
}

export function shouldSkipPullRequest(
  pr: MedicPullRequest,
  config: MedicConfig,
  labels: string[],
): boolean {
  return (
    (config.skip.draft_prs && pr.draft) ||
    config.skip.authors.includes(pr.author) ||
    config.skip.branches.some((pattern) => wildcard(pattern, pr.baseRef)) ||
    config.skip.labels.some((label) => labels.includes(label))
  );
}

export async function waitForChecksToFinish(
  octokit: Octokits,
  owner: string,
  repo: string,
  headSha: string,
  currentRunId: number,
): Promise<void> {
  for (;;) {
    const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      head_sha: headSha,
      per_page: 100,
    });
    const active = data.workflow_runs.some(
      (run) =>
        run.id !== currentRunId &&
        run.name !== "CI Medic" &&
        ["queued", "in_progress", "requested", "waiting", "pending"].includes(
          run.status ?? "",
        ),
    );
    if (!active) return;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

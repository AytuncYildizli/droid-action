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

// workflow_run executes in the base repository with write-scoped tokens and
// secrets, so a fork's head commit must never reach a checkout that CI Medic
// then runs commands against. The workflow template carries the same guard;
// this one keeps the property if CI Medic is wired into a hand-written
// workflow that omits it.
export function isTrustedRun(
  event: WorkflowRunEvent,
  owner: string,
  repo: string,
): boolean {
  const headRepository = getWorkflowRun(event).head_repository?.full_name;
  if (!headRepository) return false;
  return headRepository.toLowerCase() === `${owner}/${repo}`.toLowerCase();
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
  // `?` has to be escaped before it can be translated, otherwise it survives
  // as a regex quantifier and makes the preceding character optional instead
  // of matching one character.
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\?/g, ".");
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
        // Several open pull requests may share one head branch with different
        // bases, so every candidate has to be checked rather than the first.
        per_page: 100,
      });
  const candidates = (
    Array.isArray(response.data) ? response.data : [response.data]
  ) as ResolvedPullRequest[];

  // Binding by branch name alone can select an unrelated pull request. The
  // head SHA is what the run actually tested, so it is the only safe key, and
  // requiring it to still be the head also drops runs made stale by a push.
  const pr = candidates.find(
    (entry) =>
      entry?.state === "open" &&
      entry.head?.sha === run.head_sha &&
      entry.head?.repo?.full_name?.toLowerCase() ===
        `${owner}/${repo}`.toLowerCase(),
  );
  if (!pr?.head || !pr.base) return undefined;
  return {
    number: pr.number,
    headSha: pr.head.sha,
    headRef: pr.head.ref,
    baseRef: pr.base.ref,
    author: pr.user?.login ?? "",
    draft: Boolean(pr.draft),
  };
}

type ResolvedPullRequest =
  | {
      number: number;
      state?: string;
      head?: { ref: string; sha: string; repo?: { full_name?: string } | null };
      base?: { ref: string };
      user?: { login?: string };
      draft?: boolean;
    }
  | undefined;

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
  maxWaitMs = 15 * 60_000,
): Promise<void> {
  // A check can stay queued indefinitely: an environment awaiting approval, a
  // job behind a concurrency group, a runner label nobody provides. Without a
  // deadline this holds a token-bearing job open until the six hour job cap.
  const deadline = Date.now() + maxWaitMs;
  // Identifying this workflow by its own name kept any concurrent medic run
  // from being ignored the moment a repository renamed the workflow.
  const selfName = process.env.GITHUB_WORKFLOW;
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
        run.name !== selfName &&
        ["queued", "in_progress", "requested", "waiting", "pending"].includes(
          run.status ?? "",
        ),
    );
    if (!active) return;
    if (Date.now() >= deadline) {
      console.log(
        `CI Medic stopped waiting for checks on ${headSha} after ${Math.round(maxWaitMs / 60_000)} minutes; some are still pending.`,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

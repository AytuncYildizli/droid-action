#!/usr/bin/env bun

/**
 * Builds a sandbox repository and a fleet of pull requests that each exercise
 * one CI Medic code path end to end.
 *
 * `workflow_run` semantics cannot be simulated locally: the triggering workflow
 * definition is read from the default branch, reruns go through the Actions
 * API, and the medic runs in base-repo context. This script provisions a real
 * repository so those paths get exercised for real.
 *
 * Usage:
 *   bun run scripts/ci-medic-sandbox.ts --repo owner/name --droid-ref my-branch
 *   bun run scripts/ci-medic-sandbox.ts --repo owner/name --droid-ref my-branch --apply
 *   bun run scripts/ci-medic-sandbox.ts --repo owner/name --watch
 *
 * Nothing mutates unless --apply is passed.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

type Assertion =
  | "medic-comment"
  | "no-medic-comment"
  | "fix-commit"
  | "budget-exhausted";

type Scenario = {
  id: string;
  branch: string;
  title: string;
  expectation: string;
  assertion: Assertion;
  draft?: boolean;
  labels?: string[];
  files: Record<string, string>;
};

type Options = {
  repo: string;
  droidRef: string;
  apply: boolean;
  watch: boolean;
  create: boolean;
  only: string[];
  timeoutMinutes: number;
};

const OPT_OUT_LABEL = "no-droid-ci";

function parseOptions(argv: string[]): Options {
  const get = (flag: string, fallback = "") => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback;
  };
  const options: Options = {
    repo: get("--repo"),
    droidRef: get("--droid-ref", "dev"),
    apply: argv.includes("--apply"),
    watch: argv.includes("--watch"),
    create: argv.includes("--create"),
    only: get("--only")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    timeoutMinutes: Number(get("--timeout-minutes", "25")) || 25,
  };
  if (!options.repo.includes("/")) {
    throw new Error("--repo must be in owner/name form");
  }
  return options;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const status = result.status ?? 1;
  if (status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${status})\n${result.stderr || result.stdout}`,
    );
  }
  return {
    status,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

/* -------------------------------------------------------------------------- */
/* Sandbox project content                                                     */
/* -------------------------------------------------------------------------- */

const CALC_OK = `export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return sum(values) / values.length;
}
`;

// Off-by-one denominator. One failing assertion with an obvious minimal fix.
const CALC_BROKEN = CALC_OK.replace(
  "return sum(values) / values.length;",
  "return sum(values) / (values.length + 1);",
);

const CALC_TEST = `import { expect, test } from "bun:test";
import { average, sum } from "../src/calc";

test("sum adds all values", () => {
  expect(sum([1, 2, 3])).toBe(6);
});

test("average divides by the number of values", () => {
  expect(average([2, 4])).toBe(3);
});

test("average of an empty list is zero", () => {
  expect(average([])).toBe(0);
});
`;

const PASSING_SCRIPT = (label: string) => `#!/usr/bin/env bash
set -euo pipefail
echo "${label}: ok"
`;

// GITHUB_RUN_ATTEMPT makes the flake deterministic: red on the first attempt,
// green once CI Medic reruns the job. Without this a retry test is a coin flip.
const FLAKY_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${GITHUB_RUN_ATTEMPT:-1}" = "1" ]; then
  echo "flaky-suite: expected 'ready' but received 'pending' (timing dependent)"
  exit 1
fi
echo "flaky-suite: ok on retry"
`;

const ALWAYS_FAILING_FLAKY_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
echo "flaky-suite: expected 'ready' but received 'pending' (timing dependent)"
exit 1
`;

const INFRA_SCRIPT = `#!/usr/bin/env bash
set -euo pipefail
if [ "\${GITHUB_RUN_ATTEMPT:-1}" = "1" ]; then
  echo "Downloading build cache..."
  curl --max-time 5 -fsS https://cache.invalid-host-for-ci-medic.test/bundle.tar.gz
fi
echo "infra: ok"
`;

const FAILING_SCRIPT = (label: string, message: string) => `#!/usr/bin/env bash
set -euo pipefail
echo "${label}: ${message}"
exit 1
`;

const PACKAGE_JSON = `{
  "name": "ci-medic-sandbox",
  "private": true,
  "scripts": {
    "test": "bun test",
    "typecheck": "bash ci/typecheck.sh",
    "lint": "bash ci/lint.sh"
  }
}
`;

// Drops the "typecheck" script the CI workflow still calls, which surfaces as a
// configuration failure rather than a code failure.
const PACKAGE_JSON_MISSING_SCRIPT = `{
  "name": "ci-medic-sandbox",
  "private": true,
  "scripts": {
    "test": "bun test",
    "lint": "bash ci/lint.sh"
  }
}
`;

const AGENTS_MD = `# AGENTS.md

Sandbox project used to exercise CI Medic.

- Runtime: Bun 1.2.11, no dependencies to install.
- Run the unit tests with \`bun test\`.
- Run the auxiliary checks with \`bun run typecheck\` and \`bun run lint\`.
- Source lives in \`src/\`, tests in \`test/\`, CI helper scripts in \`ci/\`.
`;

const bunSetup = `      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: 1.2.11`;

const CI_WORKFLOW = `name: CI

on:
  pull_request:

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
${bunSetup}
      - run: bun test

  typecheck:
    runs-on: ubuntu-latest
    steps:
${bunSetup}
      - run: bun run typecheck

  flaky-suite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ci/flaky.sh

  infra-setup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ci/infra.sh
`;

// Misspells the script name so the job genuinely fails and the only possible
// repair lives in the workflow file, which fix.protected_paths forbids
// touching. An unknown *flag* does not work here: bun ignores it and passes.
const CI_WORKFLOW_BAD_FLAG = CI_WORKFLOW.replace(
  "      - run: bun test\n",
  "      - run: bun tst\n",
);

const INTEGRATION_WORKFLOW = `name: Integration

on:
  pull_request:

jobs:
  integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ci/integration.sh
`;

const DEPLOY_WORKFLOW = `name: Deploy staging

on:
  pull_request:

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ci/deploy.sh
`;

const DROID_CI_CONFIG = `# Read from the default branch, so a pull request cannot reconfigure the bot.
instructions: "Prefer the smallest possible fix. Never retry deployment jobs."
workflows:
  exclude: ["Deploy *"]
retry:
  mode: smart
  max_per_job: 1
  exclude: ["deploy-*"]
fix:
  enabled: false
  max_attempts: 2
  protected_paths: [".github/workflows/**"]
  scope: ["lint", "types", "tests", "build"]
  commit_prefix: "fix(ci): "
skip:
  draft_prs: true
  labels: ["${OPT_OUT_LABEL}"]
max_runs_per_pr: 10
`;

/**
 * One medic workflow serves every scenario. Config normally comes from the
 * default branch, which cannot vary per pull request, so the per-scenario
 * inputs are derived from the head branch prefix instead.
 */
const medicWorkflow = (droidRef: string) => `name: CI Medic

on:
  workflow_run:
    workflows: ["CI", "Integration", "Deploy staging"]
    types: [completed]

permissions:
  actions: write
  contents: write
  pull-requests: write
  id-token: write

concurrency:
  group: ci-medic-\${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: false

jobs:
  ci-medic:
    if: >
      github.event.workflow_run.head_repository.full_name == github.repository &&
      github.event.workflow_run.conclusion != 'success' &&
      github.event.workflow_run.conclusion != 'cancelled'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout pull request branch
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_branch }}
          fetch-depth: 0

      - name: Run CI Medic
        uses: Factory-AI/droid-action@${droidRef}
        with:
          factory_api_key: \${{ secrets.FACTORY_API_KEY }}
          ci_medic: "true"
          auto_fix: \${{ (startsWith(github.event.workflow_run.head_branch, 'fix-on/') || startsWith(github.event.workflow_run.head_branch, 'protected/')) && 'true' || 'false' }}
          retry_mode: \${{ startsWith(github.event.workflow_run.head_branch, 'noretry/') && 'off' || 'smart' }}
          max_runs_per_pr: \${{ startsWith(github.event.workflow_run.head_branch, 'budget/') && '1' || '10' }}
`;

function baselineFiles(droidRef: string): Record<string, string> {
  return {
    "package.json": PACKAGE_JSON,
    "AGENTS.md": AGENTS_MD,
    "src/calc.ts": CALC_OK,
    "test/calc.test.ts": CALC_TEST,
    "ci/typecheck.sh": PASSING_SCRIPT("typecheck"),
    "ci/lint.sh": PASSING_SCRIPT("lint"),
    "ci/flaky.sh": PASSING_SCRIPT("flaky-suite"),
    "ci/infra.sh": PASSING_SCRIPT("infra"),
    "ci/integration.sh": PASSING_SCRIPT("integration"),
    "ci/deploy.sh": PASSING_SCRIPT("deploy"),
    ".github/workflows/ci.yml": CI_WORKFLOW,
    ".github/workflows/integration.yml": INTEGRATION_WORKFLOW,
    ".github/workflows/deploy.yml": DEPLOY_WORKFLOW,
    ".github/workflows/ci-medic.yml": medicWorkflow(droidRef),
    ".github/droid-ci.yml": DROID_CI_CONFIG,
  };
}

const SCENARIOS: Scenario[] = [
  {
    id: "real-fix-off",
    branch: "real-off/average-off-by-one",
    title: "Real test failure with auto_fix disabled",
    expectation:
      "Diagnosis comment classifying a real failure plus inline suggestion; no commit pushed",
    assertion: "medic-comment",
    files: { "src/calc.ts": CALC_BROKEN },
  },
  {
    id: "real-fix-on",
    branch: "fix-on/average-off-by-one",
    title: "Real test failure with auto_fix enabled",
    expectation:
      "Fix commit prefixed 'fix(ci): ' pushed to the branch, CI green on the follow-up run",
    assertion: "fix-commit",
    files: { "src/calc.ts": CALC_BROKEN },
  },
  {
    id: "flaky-retry",
    branch: "flaky/timing-dependent-suite",
    title: "Flaky job that passes on rerun",
    expectation:
      "Classified flaky, failed job rerun via the Actions API, green on attempt 2",
    assertion: "medic-comment",
    files: { "ci/flaky.sh": FLAKY_SCRIPT },
  },
  {
    id: "infra-retry",
    branch: "infra/unreachable-cache-host",
    title: "Infrastructure failure that resolves on rerun",
    expectation: "Classified infrastructure, job rerun, green on attempt 2",
    assertion: "medic-comment",
    files: { "ci/infra.sh": INFRA_SCRIPT },
  },
  {
    id: "retry-disabled",
    branch: "noretry/persistent-flake",
    title: "Retry disabled via retry_mode=off",
    expectation: "No rerun attempted; diagnosis comment only",
    assertion: "medic-comment",
    files: { "ci/flaky.sh": ALWAYS_FAILING_FLAKY_SCRIPT },
  },
  {
    id: "multi-workflow",
    branch: "multi/two-failing-workflows",
    title: "Two workflows failing on one commit",
    expectation:
      "Exactly one aggregated comment covering CI and Integration, proving the settle wait works",
    assertion: "medic-comment",
    files: {
      "src/calc.ts": CALC_BROKEN,
      "ci/integration.sh": FAILING_SCRIPT(
        "integration",
        "checkout flow returned HTTP 500",
      ),
    },
  },
  {
    id: "config-failure",
    branch: "config/missing-package-script",
    title: "Configuration failure from a missing package script",
    expectation:
      "Classified configuration, no rerun, no source edit; points at package.json",
    assertion: "medic-comment",
    files: { "package.json": PACKAGE_JSON_MISSING_SCRIPT },
  },
  {
    id: "protected-path",
    branch: "protected/workflow-only-repair",
    title: "Only possible repair lives in a protected path",
    expectation:
      "Reports the bad workflow flag but leaves .github/workflows/** untouched despite auto_fix",
    assertion: "medic-comment",
    files: { ".github/workflows/ci.yml": CI_WORKFLOW_BAD_FLAG },
  },
  {
    id: "excluded-workflow",
    branch: "excluded/deploy-staging-fails",
    title: "Failure in a workflow excluded by config",
    expectation: "Gate skips with workflow_not_actionable; no comment posted",
    assertion: "no-medic-comment",
    files: {
      "ci/deploy.sh": FAILING_SCRIPT("deploy", "staging credentials rejected"),
    },
  },
  {
    id: "draft-pr",
    branch: "draft/average-off-by-one",
    title: "Draft pull request",
    expectation: "Gate skips on skip.draft_prs; no comment posted",
    assertion: "no-medic-comment",
    draft: true,
    files: { "src/calc.ts": CALC_BROKEN },
  },
  {
    id: "label-opt-out",
    branch: "optout/average-off-by-one",
    title: `Pull request labeled ${OPT_OUT_LABEL}`,
    expectation: "Gate skips on skip.labels; no comment posted",
    assertion: "no-medic-comment",
    labels: [OPT_OUT_LABEL],
    files: { "src/calc.ts": CALC_BROKEN },
  },
  {
    id: "budget-exhausted",
    branch: "budget/average-off-by-one",
    title: "Lifetime run budget of one",
    expectation:
      "First push diagnoses; second push posts the budget-exhausted note and skips before invoking Droid",
    assertion: "budget-exhausted",
    files: { "src/calc.ts": CALC_BROKEN },
  },
];

/* -------------------------------------------------------------------------- */
/* Repository provisioning                                                     */
/* -------------------------------------------------------------------------- */

function writeFiles(root: string, files: Record<string, string>) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}

function repoExists(repo: string): boolean {
  return (
    run("gh", ["repo", "view", repo, "--json", "name"], {
      allowFailure: true,
    }).status === 0
  );
}

function assertApiKeySecret(repo: string) {
  // Only secret names are read here. Set the value yourself with
  // `gh secret set FACTORY_API_KEY -R <repo>`; this script never handles it.
  const listed = run("gh", ["secret", "list", "-R", repo], {
    allowFailure: true,
  });
  if (!listed.stdout.includes("FACTORY_API_KEY")) {
    throw new Error(
      `FACTORY_API_KEY is not set on ${repo}.\n` +
        `Set it yourself, then re-run:\n  gh secret set FACTORY_API_KEY -R ${repo}`,
    );
  }
}

function defaultBranchOf(repo: string): string {
  return run("gh", [
    "repo",
    "view",
    repo,
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]).stdout;
}

function seed(options: Options, workdir: string): string {
  if (!repoExists(options.repo)) {
    if (!options.create) {
      throw new Error(
        `${options.repo} does not exist. Re-run with --create to create it.`,
      );
    }
    console.log(`Creating ${options.repo}...`);
    run("gh", [
      "repo",
      "create",
      options.repo,
      "--private",
      "--add-readme",
      "--description",
      "CI Medic end-to-end sandbox",
    ]);
  }

  assertApiKeySecret(options.repo);
  const defaultBranch = defaultBranchOf(options.repo);
  const clone = path.join(workdir, "sandbox");

  run("gh", ["repo", "clone", options.repo, clone, "--", "--quiet"]);
  run("git", ["checkout", defaultBranch], { cwd: clone });
  writeFiles(clone, baselineFiles(options.droidRef));
  run("git", ["add", "-A"], { cwd: clone });

  const staged = run("git", ["diff", "--cached", "--name-only"], {
    cwd: clone,
  }).stdout;
  if (staged) {
    run("git", ["commit", "-m", "chore: seed CI Medic sandbox harness"], {
      cwd: clone,
    });
    run("git", ["push", "origin", defaultBranch], { cwd: clone });
    console.log(`Seeded ${options.repo}@${defaultBranch}`);
  } else {
    console.log(`${options.repo}@${defaultBranch} already up to date`);
  }

  run(
    "gh",
    [
      "label",
      "create",
      OPT_OUT_LABEL,
      "-R",
      options.repo,
      "--description",
      "Opt out of CI Medic",
      "--color",
      "ededed",
    ],
    { allowFailure: true },
  );

  return defaultBranch;
}

function openPullRequest(
  options: Options,
  workdir: string,
  defaultBranch: string,
  scenario: Scenario,
): string {
  const clone = path.join(workdir, "sandbox");
  run("git", ["checkout", defaultBranch], { cwd: clone });
  run("git", ["checkout", "-B", scenario.branch], { cwd: clone });
  writeFiles(clone, scenario.files);
  run("git", ["add", "-A"], { cwd: clone });
  run("git", ["commit", "-m", `test: ${scenario.title.toLowerCase()}`], {
    cwd: clone,
  });
  run("git", ["push", "--force", "origin", scenario.branch], { cwd: clone });

  const existing = run(
    "gh",
    [
      "pr",
      "list",
      "-R",
      options.repo,
      "--head",
      scenario.branch,
      "--json",
      "url",
      "--jq",
      ".[0].url",
    ],
    { allowFailure: true },
  ).stdout;
  if (existing) {
    return existing;
  }

  const args = [
    "pr",
    "create",
    "-R",
    options.repo,
    "--base",
    defaultBranch,
    "--head",
    scenario.branch,
    "--title",
    `[${scenario.id}] ${scenario.title}`,
    "--body",
    `Scenario: \`${scenario.id}\`\n\nExpected CI Medic behavior: ${scenario.expectation}\n`,
  ];
  if (scenario.draft) {
    args.push("--draft");
  }
  const url = run("gh", args).stdout.split("\n").pop()!.trim();

  for (const label of scenario.labels ?? []) {
    run("gh", ["pr", "edit", url, "--add-label", label], {
      allowFailure: true,
    });
  }
  return url;
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

type Observation = {
  medicComments: number;
  budgetExhausted: boolean;
  fixCommits: string[];
  checksPending: boolean;
};

function observe(options: Options, scenario: Scenario): Observation {
  const raw = run("gh", [
    "pr",
    "view",
    scenario.branch,
    "-R",
    options.repo,
    "--json",
    "comments,commits,statusCheckRollup",
  ]).stdout;
  const data = JSON.parse(raw) as {
    comments: { body: string }[];
    commits: { messageHeadline: string }[];
    statusCheckRollup?: { status?: string; conclusion?: string }[];
  };

  const bodies = data.comments.map((comment) => comment.body ?? "");
  return {
    medicComments: bodies.filter((body) => body.includes("<!-- ci-medic:run="))
      .length,
    budgetExhausted: bodies.some((body) =>
      body.includes("<!-- ci-medic:budget-exhausted -->"),
    ),
    fixCommits: data.commits
      .map((commit) => commit.messageHeadline)
      .filter((headline) => headline.startsWith("fix(ci): ")),
    checksPending: (data.statusCheckRollup ?? []).some(
      (check) => check.status && check.status !== "COMPLETED",
    ),
  };
}

function evaluate(
  scenario: Scenario,
  observation: Observation,
): { done: boolean; passed: boolean; detail: string } {
  switch (scenario.assertion) {
    case "medic-comment":
      return observation.medicComments > 0
        ? { done: true, passed: true, detail: "medic comment posted" }
        : {
            done: false,
            passed: false,
            detail: "waiting for a medic comment",
          };
    case "fix-commit":
      return observation.fixCommits.length > 0
        ? {
            done: true,
            passed: true,
            detail: `fix commit: ${observation.fixCommits[0]}`,
          }
        : { done: false, passed: false, detail: "waiting for a fix commit" };
    case "budget-exhausted":
      return observation.budgetExhausted
        ? { done: true, passed: true, detail: "budget-exhausted note posted" }
        : {
            done: false,
            passed: false,
            detail: `runs so far: ${observation.medicComments}; push again to trigger run 2`,
          };
    case "no-medic-comment":
      // A skip produces no output, so this can only be judged once CI settles.
      if (observation.medicComments > 0 || observation.budgetExhausted) {
        return {
          done: true,
          passed: false,
          detail: "medic commented but should have skipped",
        };
      }
      return observation.checksPending
        ? { done: false, passed: false, detail: "checks still running" }
        : { done: true, passed: true, detail: "correctly skipped" };
  }
}

async function watch(options: Options, scenarios: Scenario[]) {
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  const settled = new Map<string, { passed: boolean; detail: string }>();

  while (Date.now() < deadline && settled.size < scenarios.length) {
    for (const scenario of scenarios) {
      if (settled.has(scenario.id)) continue;
      try {
        const result = evaluate(scenario, observe(options, scenario));
        if (result.done) {
          settled.set(scenario.id, result);
          const icon = result.passed ? "PASS" : "FAIL";
          console.log(`  ${icon}  ${scenario.id}: ${result.detail}`);
        }
      } catch (error) {
        console.log(
          `  ....  ${scenario.id}: ${error instanceof Error ? error.message.split("\n")[0] : error}`,
        );
      }
    }
    if (settled.size < scenarios.length) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  console.log("\nResults");
  let failures = 0;
  for (const scenario of scenarios) {
    const result = settled.get(scenario.id);
    if (!result) {
      failures += 1;
      console.log(`  TIMEOUT  ${scenario.id}  (${scenario.expectation})`);
      continue;
    }
    if (!result.passed) failures += 1;
    console.log(
      `  ${result.passed ? "PASS   " : "FAIL   "}  ${scenario.id}  ${result.detail}`,
    );
  }
  if (failures > 0) {
    console.log(`\n${failures} scenario(s) not satisfied.`);
    process.exitCode = 1;
  } else {
    console.log("\nAll scenarios satisfied.");
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const scenarios = options.only.length
    ? SCENARIOS.filter((scenario) => options.only.includes(scenario.id))
    : SCENARIOS;

  if (!scenarios.length) {
    throw new Error("No scenarios selected");
  }

  if (options.watch) {
    console.log(`Watching ${scenarios.length} scenario(s) on ${options.repo}`);
    await watch(options, scenarios);
    return;
  }

  if (!options.apply) {
    console.log(`Dry run. Target repo: ${options.repo}`);
    console.log(`droid-action ref:     ${options.droidRef}`);
    console.log(
      `\nWould seed ${Object.keys(baselineFiles(options.droidRef)).length} files on the default branch and open ${scenarios.length} pull requests:\n`,
    );
    for (const scenario of scenarios) {
      console.log(`  ${scenario.id}`);
      console.log(`    branch:   ${scenario.branch}`);
      console.log(
        `    changes:  ${Object.keys(scenario.files).join(", ")}${scenario.draft ? " (draft PR)" : ""}${scenario.labels ? ` (labels: ${scenario.labels.join(", ")})` : ""}`,
      );
      console.log(`    expects:  ${scenario.expectation}\n`);
    }
    console.log("Re-run with --apply to create them.");
    return;
  }

  const workdir = mkdtempSync(path.join(tmpdir(), "ci-medic-sandbox-"));
  try {
    const defaultBranch = seed(options, workdir);
    const created: { scenario: Scenario; url: string }[] = [];
    for (const scenario of scenarios) {
      const url = openPullRequest(options, workdir, defaultBranch, scenario);
      created.push({ scenario, url });
      console.log(`  ${scenario.id} -> ${url}`);
    }

    console.log("\nFleet created:\n");
    for (const { scenario, url } of created) {
      console.log(`  ${scenario.id.padEnd(18)} ${url}`);
    }
    console.log(
      `\nVerify with:\n  bun run scripts/ci-medic-sandbox.ts --repo ${options.repo} --watch`,
    );
    console.log(
      `\nThe budget scenario needs a second push once run 1 finishes:\n  git commit --allow-empty -m "test: trigger second medic run" && git push`,
    );
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

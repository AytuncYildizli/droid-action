import { afterEach, describe, expect, test } from "bun:test";
import { defaultMedicConfig, loadMedicConfig } from "../src/medic/config";
import {
  isTrustedRun,
  resolvePullRequest,
  shouldProcessWorkflow,
  shouldSkipPullRequest,
  waitForChecksToFinish,
} from "../src/medic/gate";
import { prepareMcpTools } from "../src/mcp/install-mcp-server";
import {
  MEDIC_ALLOWED_TOOLS,
  medicAllowedTools,
  medicRunCount,
} from "../src/medic/index";
import { protectedViolations } from "../src/medic/postrun";

const octokitWithConfig = (body: string) =>
  ({
    rest: {
      repos: {
        getContent: async () => ({
          data: { content: Buffer.from(body, "utf8").toString("base64") },
        }),
      },
    },
  }) as any;

const load = (body: string, inputs = {}) =>
  loadMedicConfig(
    octokitWithConfig(body),
    "owner",
    "repo",
    "main",
    ".github/droid-ci.yml",
    inputs,
  );

describe("CI Medic gates", () => {
  test("only processes failed or timed out workflows", () => {
    const config = defaultMedicConfig();
    const event = {
      workflow_run: { name: "CI", conclusion: "failure" },
    } as any;
    expect(shouldProcessWorkflow(event, config)).toBe(true);
    event.workflow_run.conclusion = "success";
    expect(shouldProcessWorkflow(event, config)).toBe(false);
  });

  test("honors workflow exclusions", () => {
    const config = defaultMedicConfig();
    config.workflows.exclude = ["Deploy *"];
    expect(
      shouldProcessWorkflow(
        {
          workflow_run: { name: "Deploy production", conclusion: "failure" },
        } as any,
        config,
      ),
    ).toBe(false);
  });

  test("skips configured draft, label, branch, and author cases", () => {
    const config = defaultMedicConfig();
    expect(
      shouldSkipPullRequest(
        {
          number: 1,
          headSha: "sha",
          headRef: "feature",
          baseRef: "release/1",
          author: "bot",
          draft: true,
        },
        {
          ...config,
          skip: { ...config.skip, branches: ["release/*"], authors: ["bot"] },
        },
        ["no-droid-ci"],
      ),
    ).toBe(true);
  });
});

describe("CI Medic MCP wiring", () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...previousEnv };
  });

  // A workflow_run payload is not an entity context, so every server gated on
  // isEntityContext has to fall back to MEDIC_PR_NUMBER. When one does not, the
  // CLI aborts the run with "Unknown tool identifier(s)" for its tools.
  test("installs a server for every namespaced tool CI Medic allows", async () => {
    process.env.MEDIC_PR_NUMBER = "42";
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    const config = JSON.parse(
      await prepareMcpTools({
        githubToken: "app-token",
        owner: "owner",
        repo: "repo",
        droidCommentId: "1",
        allowedTools: MEDIC_ALLOWED_TOOLS,
        mode: "tag",
        context: {
          eventName: "workflow_run",
          repository: { owner: "owner", repo: "repo" },
        } as any,
      }),
    );

    const installed = Object.keys(config.mcpServers ?? {});
    const required = [
      ...new Set(
        MEDIC_ALLOWED_TOOLS.filter((tool) => tool.includes("___")).map(
          (tool) => tool.split("___")[0]!,
        ),
      ),
    ];

    expect(required.length).toBeGreaterThan(0);
    for (const server of required) {
      expect(installed).toContain(server);
    }
  });

  // MCP server env values are interpolated into `droid mcp add ... --env K=V`
  // as an unquoted shell string, so a value holding a space or a shell
  // metacharacter breaks registration and aborts the whole run.
  test("keeps every MCP env value safe for an unquoted shell argument", async () => {
    process.env.MEDIC_PR_NUMBER = "42";
    process.env.MEDIC_RUN_ID = "31044951094";
    process.env.MEDIC_RUN_COUNT = "1";
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    const config = JSON.parse(
      await prepareMcpTools({
        githubToken: "app-token",
        owner: "owner",
        repo: "repo",
        droidCommentId: "1",
        allowedTools: MEDIC_ALLOWED_TOOLS,
        mode: "tag",
        context: {
          eventName: "workflow_run",
          repository: { owner: "owner", repo: "repo" },
        } as any,
      }),
    );

    for (const server of Object.values<any>(config.mcpServers ?? {})) {
      for (const [key, value] of Object.entries(server.env ?? {})) {
        expect(`${key}=${String(value)}`).not.toMatch(/[\s"'<>|&;$`\\]/);
      }
    }
  });

  test("passes the medic pull request number to the inline comment server", async () => {
    process.env.MEDIC_PR_NUMBER = "42";
    process.env.DEFAULT_WORKFLOW_TOKEN = "workflow-token";

    const config = JSON.parse(
      await prepareMcpTools({
        githubToken: "app-token",
        owner: "owner",
        repo: "repo",
        droidCommentId: "1",
        allowedTools: MEDIC_ALLOWED_TOOLS,
        mode: "tag",
        context: {
          eventName: "workflow_run",
          repository: { owner: "owner", repo: "repo" },
        } as any,
      }),
    );

    expect(config.mcpServers.github_inline_comment.env.PR_NUMBER).toBe("42");
  });
});

describe("CI Medic run budget", () => {
  const bot = { id: 209825114, type: "Bot" };
  const human = { id: 5, type: "User" };
  const markerFor = (count: number) =>
    `## CI Medic\n\ndiagnosis text\n\n<!-- ci-medic:run=99 count=${count} -->`;

  // The count has to live in the marker, not in the number of marker comments:
  // Droid rewrites the tracking comment body on every run.
  test("reads the lifetime count from the surviving marker", () => {
    expect(
      medicRunCount([
        { body: "unrelated", user: human },
        { body: markerFor(3), user: bot },
      ]),
    ).toBe(3);
  });

  test("treats a pull request with no medic history as zero runs", () => {
    expect(medicRunCount([{ body: "some human comment", user: human }])).toBe(
      0,
    );
  });

  test("does not undercount when Droid has rewritten the body around the marker", () => {
    const rewritten = `## CI Medic\n\n**Diagnosis: real code failure.**\n\nlots of new content\n\n<!-- ci-medic:run=12345 count=7 -->`;
    expect(medicRunCount([{ body: rewritten, user: bot }])).toBe(7);
  });

  // Anyone can comment on a pull request, so honouring a marker regardless of
  // author let a contributor pin the count at zero for unlimited paid runs.
  test("ignores a marker planted by a non-bot commenter", () => {
    expect(
      medicRunCount([
        { body: "<!-- ci-medic:run=1 count=0 -->", user: human },
        { body: markerFor(4), user: bot },
      ]),
    ).toBe(4);
  });

  test("ignores a human marker even when no genuine marker exists", () => {
    expect(
      medicRunCount([
        { body: "<!-- ci-medic:run=1 count=999 -->", user: human },
      ]),
    ).toBe(0);
  });
});

describe("CI Medic trust boundary", () => {
  const forkEvent = (fullName: string) =>
    ({
      workflow_run: { head_repository: { full_name: fullName } },
    }) as any;

  test("rejects a run whose head commit came from a fork", () => {
    expect(isTrustedRun(forkEvent("attacker/repo"), "owner", "repo")).toBe(
      false,
    );
  });

  test("accepts a run from a branch in the base repository", () => {
    expect(isTrustedRun(forkEvent("owner/repo"), "owner", "repo")).toBe(true);
  });

  test("rejects a run with no head repository rather than assuming trust", () => {
    expect(isTrustedRun({ workflow_run: {} } as any, "owner", "repo")).toBe(
      false,
    );
  });
});

describe("CI Medic pull request resolution", () => {
  const listing = (prs: unknown[]) =>
    ({
      rest: { pulls: { list: async () => ({ data: prs }) } },
    }) as any;

  const openPr = (overrides: Record<string, unknown> = {}) => ({
    number: 7,
    state: "open",
    head: { ref: "fix-ci", sha: "abc", repo: { full_name: "owner/repo" } },
    base: { ref: "main" },
    user: { login: "dev" },
    draft: false,
    ...overrides,
  });

  const event = {
    workflow_run: { head_sha: "abc", head_branch: "fix-ci", pull_requests: [] },
  } as any;

  test("resolves the pull request whose head commit the run tested", async () => {
    const pr = await resolvePullRequest(
      listing([openPr()]),
      "owner",
      "repo",
      event,
    );
    expect(pr?.number).toBe(7);
    expect(pr?.baseRef).toBe("main");
  });

  // Matching on branch name alone bound the run to whichever pull request
  // happened to share the name, and then commented on the wrong one.
  test("does not bind to a same-named branch on a different commit", async () => {
    const pr = await resolvePullRequest(
      listing([openPr({ head: { ref: "fix-ci", sha: "different" } })]),
      "owner",
      "repo",
      event,
    );
    expect(pr).toBeUndefined();
  });

  test("picks the matching commit when several pull requests share a branch", async () => {
    const pr = await resolvePullRequest(
      listing([
        openPr({ number: 1, head: { ref: "fix-ci", sha: "stale" } }),
        openPr({ number: 2 }),
      ]),
      "owner",
      "repo",
      event,
    );
    expect(pr?.number).toBe(2);
  });

  test("ignores a pull request that is no longer open", async () => {
    const pr = await resolvePullRequest(
      listing([openPr({ state: "closed" })]),
      "owner",
      "repo",
      event,
    );
    expect(pr).toBeUndefined();
  });
});

describe("CI Medic tool exposure", () => {
  // Job logs are attacker-influenced and permission prompts are disabled, so a
  // diagnosis-only run must not be able to write files or run commands.
  test("withholds the shell and file writers when fixes are disabled", () => {
    const tools = medicAllowedTools(false);
    for (const tool of ["Execute", "Edit", "Create", "ApplyPatch"]) {
      expect(tools).not.toContain(tool);
    }
    expect(tools).toContain("github_ci___download_job_log");
  });

  test("grants them once the repository has asked for fixes", () => {
    expect(medicAllowedTools(true)).toContain("Execute");
  });
});

describe("CI Medic protected paths", () => {
  const patterns = [".github/workflows/**", "infra/**"];

  test("flags a change to a protected path", () => {
    expect(
      protectedViolations(patterns, ["src/app.ts", ".github/workflows/ci.yml"]),
    ).toEqual([".github/workflows/ci.yml"]);
  });

  test("leaves ordinary source files alone", () => {
    expect(protectedViolations(patterns, ["src/app.ts"])).toEqual([]);
  });

  test("does not let a single star cross a directory boundary", () => {
    expect(protectedViolations(["infra/*"], ["infra/aws/main.tf"])).toEqual([]);
  });
});

describe("CI Medic check waiting", () => {
  // A check can stay queued forever, and this loop holds a job that carries
  // the app token, the workflow token, and the Factory API key.
  test("gives up instead of polling until the job is killed", async () => {
    let calls = 0;
    const octokit = {
      rest: {
        actions: {
          listWorkflowRunsForRepo: async () => {
            calls += 1;
            return {
              data: {
                workflow_runs: [{ id: 2, name: "CI", status: "queued" }],
              },
            };
          },
        },
      },
    } as any;

    await waitForChecksToFinish(octokit, "owner", "repo", "sha", 1, 0);
    expect(calls).toBe(1);
  });
});

describe("CI Medic config loading", () => {
  test("parses block-style nested config", async () => {
    const config = await load(
      ["workflows:", '  exclude: ["Deploy *"]', "retry:", "  mode: off"].join(
        "\n",
      ),
    );
    expect(config.workflows.exclude).toEqual(["Deploy *"]);
    expect(config.retry.mode).toBe("off");
  });

  test("parses flow-style nested config with unquoted keys", async () => {
    const config = await load(
      'workflows: { exclude: ["Deploy *", "Nightly"] }',
    );
    expect(config.workflows.exclude).toEqual(["Deploy *", "Nightly"]);
  });

  test("falls back instead of crashing when an object slot holds a scalar", async () => {
    const config = await load("workflows: nonsense\nretry: alsononsense");
    expect(config.workflows.exclude).toEqual([]);
    expect(config.retry.mode).toBe("smart");
    expect(config.retry.max_per_job).toBe(1);
  });

  test("coerces comma separated strings into arrays", async () => {
    const config = await load("skip:\n  branches: release/*, hotfix/*");
    expect(config.skip.branches).toEqual(["release/*", "hotfix/*"]);
  });

  test("rejects an unknown retry mode", async () => {
    const config = await load("retry:\n  mode: sometimes");
    expect(config.retry.mode).toBe("smart");
  });

  test("action inputs win over the config file", async () => {
    const config = await load("fix:\n  enabled: false", {
      fix: { enabled: true, max_attempts: 5 },
    });
    expect(config.fix.enabled).toBe(true);
    expect(config.fix.max_attempts).toBe(5);
    expect(config.fix.commit_prefix).toBe("fix(ci): ");
  });

  // The previous hand-rolled parser understood only `key: value` on one line.
  // Both of these silently returned defaults, which reads as success while the
  // limit the author wrote is gone.
  test("parses block sequences instead of dropping them", async () => {
    const config = await load(
      [
        "fix:",
        "  protected_paths:",
        '    - ".github/workflows/**"',
        '    - "infra/**"',
      ].join("\n"),
    );
    expect(config.fix.protected_paths).toEqual([
      ".github/workflows/**",
      "infra/**",
    ]);
  });

  test("keeps a top-level key that follows a nested block", async () => {
    const config = await load(
      ["skip:", "  draft_prs: true", "max_runs_per_pr: 2"].join("\n"),
    );
    expect(config.max_runs_per_pr).toBe(2);
  });

  test("reads a block scalar as its text rather than as the pipe", async () => {
    const config = await load(
      ["instructions: |", "  Be careful.", "  Never touch infra."].join("\n"),
    );
    expect(config.instructions).toContain("Never touch infra.");
  });

  // Falling back to defaults on malformed input can quietly widen permissions,
  // so an unparseable file has to stop the run instead.
  test("refuses to run on a malformed config file", async () => {
    await expect(
      load("fix:\n  enabled: true\n bad indent: ["),
    ).rejects.toThrow();
  });

  test("uses defaults when the config file is absent", async () => {
    const octokit = {
      rest: {
        repos: {
          getContent: async () => {
            throw new Error("404");
          },
        },
      },
    } as any;
    const config = await loadMedicConfig(
      octokit,
      "owner",
      "repo",
      "main",
      ".github/droid-ci.yml",
      {},
    );
    expect(config).toEqual(defaultMedicConfig());
  });
});

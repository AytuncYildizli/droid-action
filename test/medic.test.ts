import { afterEach, describe, expect, test } from "bun:test";
import { defaultMedicConfig, loadMedicConfig } from "../src/medic/config";
import {
  shouldProcessWorkflow,
  shouldSkipPullRequest,
} from "../src/medic/gate";
import { prepareMcpTools } from "../src/mcp/install-mcp-server";
import { MEDIC_ALLOWED_TOOLS } from "../src/medic/index";

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

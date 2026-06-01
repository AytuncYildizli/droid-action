import { describe, expect, it, mock } from "bun:test";
import { createGitlabMrServer } from "../../src/mcp/gitlab-mr-server";
import { GitlabClient } from "../../src/gitlab/api/client";

function makeFakeClient(overrides: Partial<GitlabClient> = {}): GitlabClient {
  const fake = {
    getMr: mock(async () => ({
      iid: 7,
      diff_refs: {
        base_sha: "base-sha",
        head_sha: "head-sha",
        start_sha: "start-sha",
      },
    })),
    getMrChanges: mock(async () => ({ changes: [], diff_refs: {} })),
    listNotes: mock(async () => []),
    createNote: mock(async (_p: unknown, _m: unknown, body: string) => ({
      id: 101,
      body,
    })),
    updateNote: mock(async () => ({ id: 101 })),
    createDiscussionOnDiff: mock(async () => ({
      id: "disc-1",
      individual_note: false,
      notes: [],
    })),
    updateMrDescription: mock(async () => ({ iid: 7 })),
    ...overrides,
  } as unknown as GitlabClient;
  return fake;
}

function listTools(server: ReturnType<typeof createGitlabMrServer>) {
  // McpServer keeps tools internally; we call _registeredTools via a small probe.
  // Instead, exercise the public API by invoking a known tool name via internal handler.
  return server;
}

describe("createGitlabMrServer", () => {
  it("registers without throwing and exposes a server instance", () => {
    const client = makeFakeClient();
    const server = createGitlabMrServer({ projectId: "42", client });
    expect(server).toBeTruthy();
    listTools(server);
  });

  it("submit_review posts a summary note when body provided", async () => {
    const client = makeFakeClient();
    const server = createGitlabMrServer({ projectId: "42", client });

    // @ts-expect-error - reach into internal tool registry to invoke directly
    const tool = server._registeredTools?.submit_review;
    expect(tool).toBeTruthy();

    const result = await tool.callback({
      mr_iid: 7,
      body: "Hello reviewers",
      comments: [],
    });

    expect(result.isError).toBeUndefined();
    expect(
      (client.createNote as ReturnType<typeof mock>).mock.calls.length,
    ).toBe(1);
    const payload = JSON.parse(result.content[0].text);
    expect(payload.summaryNoteId).toBe(101);
    expect(payload.discussionsCreated).toBe(0);
  });

  it("submit_review anchors inline comments using diff_refs", async () => {
    const client = makeFakeClient();
    const server = createGitlabMrServer({ projectId: "42", client });
    // @ts-expect-error - reach into internal tool registry
    const tool = server._registeredTools?.submit_review;

    const result = await tool.callback({
      mr_iid: 7,
      comments: [
        { path: "src/x.ts", body: "Issue here", line: 12, side: "RIGHT" },
      ],
    });

    expect(result.isError).toBeUndefined();
    const createDisc = client.createDiscussionOnDiff as ReturnType<typeof mock>;
    expect(createDisc.mock.calls.length).toBe(1);

    const call = createDisc.mock.calls[0]!;
    const position = call[3];
    expect(position).toMatchObject({
      base_sha: "base-sha",
      head_sha: "head-sha",
      start_sha: "start-sha",
      position_type: "text",
      new_path: "src/x.ts",
      old_path: "src/x.ts",
      new_line: 12,
    });
  });

  it("submit_review uses old_line on LEFT side", async () => {
    const client = makeFakeClient();
    const server = createGitlabMrServer({ projectId: "42", client });
    // @ts-expect-error
    const tool = server._registeredTools?.submit_review;

    await tool.callback({
      mr_iid: 7,
      comments: [
        {
          path: "src/x.ts",
          body: "Removed code issue",
          line: 5,
          side: "LEFT",
        },
      ],
    });

    const createDisc = client.createDiscussionOnDiff as ReturnType<typeof mock>;
    const call = createDisc.mock.calls[0]!;
    const position = call[3];
    expect(position.old_line).toBe(5);
    expect(position.new_line).toBeUndefined();
  });

  it("submit_review collects per-comment errors without aborting", async () => {
    const failingDisc = mock(async (_p, _m, body: string) => {
      if (body.includes("bad")) {
        throw new Error("position out of range");
      }
      return { id: "disc", individual_note: false, notes: [] };
    });
    const client = makeFakeClient({
      createDiscussionOnDiff: failingDisc,
    } as Partial<GitlabClient>);
    const server = createGitlabMrServer({ projectId: "42", client });
    // @ts-expect-error
    const tool = server._registeredTools?.submit_review;

    const result = await tool.callback({
      mr_iid: 7,
      comments: [
        { path: "a.ts", body: "good", line: 1 },
        { path: "a.ts", body: "bad", line: 999 },
        { path: "a.ts", body: "good again", line: 2 },
      ],
    });

    const payload = JSON.parse(result.content[0].text);
    expect(payload.discussionsCreated).toBe(2);
    expect(payload.discussionErrors).toHaveLength(1);
    expect(payload.discussionErrors[0].index).toBe(1);
    expect(payload.discussionErrors[0].error).toContain(
      "position out of range",
    );
  });
});

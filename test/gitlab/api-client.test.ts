import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import { GitlabClient, GitlabApiError } from "../../src/gitlab/api/client";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(impl: (url: string, init: RequestInit) => Response) {
  const fn = mock(async (url: string, init: RequestInit) => impl(url, init));
  // @ts-expect-error overriding global fetch in tests
  globalThis.fetch = fn;
  return fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GitlabClient", () => {
  beforeEach(() => {
    // each test installs its own fetch mock
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("sends PRIVATE-TOKEN header on GET", async () => {
    const fetchMock = mockFetch((url, init) => {
      expect(url).toBe(
        "https://gitlab.com/api/v4/projects/42/merge_requests/7",
      );
      expect(init.method ?? "GET").toBe("GET");
      const headers = init.headers as Record<string, string>;
      expect(headers["PRIVATE-TOKEN"]).toBe("glpat-test");
      return jsonResponse({ iid: 7 });
    });

    const client = new GitlabClient("glpat-test");
    const mr = await client.getMr(42, 7);
    expect(mr).toEqual({ iid: 7 } as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends JSON body on POST createNote", async () => {
    mockFetch((url, init) => {
      expect(url).toBe(
        "https://gitlab.com/api/v4/projects/42/merge_requests/7/notes",
      );
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ body: "hello" }));
      const headers = init.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      return jsonResponse({ id: 1, body: "hello" });
    });

    const client = new GitlabClient("glpat-test");
    const note = await client.createNote(42, 7, "hello");
    expect((note as { id: number }).id).toBe(1);
  });

  it("URL-encodes string project ids (path-with-namespace)", async () => {
    mockFetch((url) => {
      expect(url).toBe(
        "https://gitlab.com/api/v4/projects/group%2Fsub%2Frepo/merge_requests/7",
      );
      return jsonResponse({ iid: 7 });
    });
    const client = new GitlabClient("glpat-test");
    await client.getMr("group/sub/repo", 7);
  });

  it("respects a custom baseUrl (self-hosted)", async () => {
    mockFetch((url) => {
      expect(url).toBe(
        "https://gitlab.example.com/api/v4/projects/1/merge_requests/2",
      );
      return jsonResponse({ iid: 2 });
    });
    const client = new GitlabClient(
      "glpat-test",
      "https://gitlab.example.com/api/v4",
    );
    await client.getMr(1, 2);
  });

  it("throws GitlabApiError with parsed body on non-2xx", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ message: "404 Not Found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        }),
    );

    const client = new GitlabClient("glpat-test");
    try {
      await client.getMr(42, 999);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitlabApiError);
      const e = err as GitlabApiError;
      expect(e.status).toBe(404);
      expect((e.body as { message: string }).message).toBe("404 Not Found");
      // The body detail is the actionable part (e.g. which position field
      // GitLab refused), so it must survive into the message CI logs show.
      expect(e.message).toContain('"message":"404 Not Found"');
    }
  });
});

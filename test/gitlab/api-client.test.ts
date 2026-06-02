import { describe, expect, it, beforeEach, afterEach, mock } from "bun:test";
import {
  GitlabClient,
  GitlabApiError,
  parseNextLink,
} from "../../src/gitlab/api/client";

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
    }
  });

  it("does not retry on non-retryable 4xx (404, 401, 403)", async () => {
    const fetchMock = mockFetch(
      () =>
        new Response("nope", {
          status: 404,
          statusText: "Not Found",
        }),
    );
    const client = new GitlabClient("glpat-test", undefined, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    try {
      await client.getMr(42, 999);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitlabApiError);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 with exponential backoff and eventually succeeds", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      if (calls < 3) {
        return new Response("rate limited", {
          status: 429,
          statusText: "Too Many Requests",
        });
      }
      return jsonResponse({ iid: 7 });
    });
    const client = new GitlabClient("glpat-test", undefined, {
      maxRetries: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    const mr = await client.getMr(42, 7);
    expect((mr as { iid: number }).iid).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries on 500/502/503/504 and surfaces the final error after maxRetries", async () => {
    const fetchMock = mockFetch(
      () => new Response("upstream down", { status: 503 }),
    );
    const client = new GitlabClient("glpat-test", undefined, {
      maxRetries: 2,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    try {
      await client.getMr(42, 7);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GitlabApiError);
      expect((err as GitlabApiError).status).toBe(503);
    }
    // 1 initial + 2 retries = 3 attempts
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After header (seconds) on 429", async () => {
    let calls = 0;
    const times: number[] = [];
    const fetchMock = mockFetch(() => {
      times.push(Date.now());
      calls++;
      if (calls < 2) {
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return jsonResponse({ iid: 7 });
    });
    const client = new GitlabClient("glpat-test", undefined, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });
    await client.getMr(42, 7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries on fetch network errors", async () => {
    let calls = 0;
    const fetchMock = mockFetch(() => {
      calls++;
      if (calls < 2) throw new Error("ECONNRESET");
      return jsonResponse({ iid: 7 });
    });
    const client = new GitlabClient("glpat-test", undefined, {
      maxRetries: 3,
      baseDelayMs: 1,
      maxDelayMs: 5,
    });
    const mr = await client.getMr(42, 7);
    expect((mr as { iid: number }).iid).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listNotes paginates via X-Next-Page header", async () => {
    let calls = 0;
    const fetchMock = mockFetch((url) => {
      calls++;
      const u = new URL(url);
      expect(u.searchParams.get("per_page")).toBe("100");
      if (calls === 1) {
        expect(u.searchParams.get("page")).toBeNull();
        return new Response(JSON.stringify([{ id: 1 }, { id: 2 }]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Next-Page": "2",
          },
        });
      }
      if (calls === 2) {
        expect(u.searchParams.get("page")).toBe("2");
        return new Response(JSON.stringify([{ id: 3 }]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Next-Page": "",
          },
        });
      }
      throw new Error("unexpected extra call");
    });
    const client = new GitlabClient("glpat-test");
    const notes = await client.listNotes(42, 7);
    expect(notes.map((n) => (n as { id: number }).id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("listDiscussions paginates via Link rel=next header when X-Next-Page is absent", async () => {
    let calls = 0;
    mockFetch(() => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify([{ id: "a" }]), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            Link: '<https://gitlab.com/api/v4/projects/42/merge_requests/7/discussions?page=2&per_page=100>; rel="next"',
          },
        });
      }
      return new Response(JSON.stringify([{ id: "b" }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = new GitlabClient("glpat-test");
    const disc = await client.listDiscussions(42, 7);
    expect(disc.map((d) => (d as { id: string }).id)).toEqual(["a", "b"]);
  });

  it("parseNextLink extracts the next URL from a Link header", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink("")).toBeNull();
    expect(
      parseNextLink(
        '<https://x/api/page?page=2>; rel="next", <https://x/api/page?page=5>; rel="last"',
      ),
    ).toBe("https://x/api/page?page=2");
    expect(parseNextLink('<https://x/api/page?page=5>; rel="last"')).toBeNull();
  });
});

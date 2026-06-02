import { GITLAB_API_URL } from "./config";
import type {
  GitlabMr,
  GitlabMrChanges,
  GitlabNote,
  GitlabDiscussion,
  GitlabPosition,
} from "../types";

export class GitlabApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(`GitLab API ${status}: ${message}`);
    this.name = "GitlabApiError";
    this.status = status;
    this.body = body;
  }
}

type RequestInitWithJson = Omit<RequestInit, "body"> & { json?: unknown };

export type RetryOptions = {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
};

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const asInt = Number.parseInt(header, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const asDate = Date.parse(header);
  if (Number.isFinite(asDate)) {
    return Math.max(0, asDate - Date.now());
  }
  return null;
}

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (m) return m[1] ?? null;
  }
  return null;
}

function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | null,
  opts: RetryOptions,
): number {
  if (retryAfterMs !== null) {
    return Math.min(opts.maxDelayMs, retryAfterMs);
  }
  const exp = opts.baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * opts.baseDelayMs;
  return Math.min(opts.maxDelayMs, exp + jitter);
}

export class GitlabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly retry: RetryOptions;

  constructor(
    token: string,
    baseUrl: string = GITLAB_API_URL,
    retry: Partial<RetryOptions> = {},
  ) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.retry = { ...DEFAULT_RETRY, ...retry };
  }

  private async requestRaw(
    path: string,
    init: RequestInitWithJson = {},
  ): Promise<Response> {
    const { json, headers: rawHeaders, ...rest } = init;
    const headers: Record<string, string> = {
      "PRIVATE-TOKEN": this.token,
      Accept: "application/json",
      ...(rawHeaders as Record<string, string> | undefined),
    };

    let body: string | undefined;
    if (json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(json);
    }

    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;

    let attempt = 0;
    while (true) {
      let response: Response;
      try {
        response = await fetch(url, { ...rest, headers, body });
      } catch (err) {
        if (attempt >= this.retry.maxRetries) throw err;
        await sleep(computeBackoffMs(attempt, null, this.retry));
        attempt++;
        continue;
      }

      if (response.ok) return response;

      const shouldRetry =
        RETRYABLE_STATUS.has(response.status) &&
        attempt < this.retry.maxRetries;
      if (shouldRetry) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get("Retry-After"),
        );
        const delay = computeBackoffMs(attempt, retryAfterMs, this.retry);
        await sleep(delay);
        attempt++;
        continue;
      }

      let parsed: unknown = null;
      const text = await response.text();
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      throw new GitlabApiError(
        response.status,
        response.statusText || "Request failed",
        parsed,
      );
    }
  }

  private async request<T>(
    path: string,
    init: RequestInitWithJson = {},
  ): Promise<T> {
    const response = await this.requestRaw(path, init);
    if (response.status === 204) {
      return undefined as unknown as T;
    }
    return (await response.json()) as T;
  }

  private appendQuery(url: string, key: string, value: string): string {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  }

  private async paginate<T>(
    path: string,
    init: RequestInitWithJson = {},
  ): Promise<T[]> {
    const absolute = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const firstUrl = this.appendQuery(absolute, "per_page", "100");

    const out: T[] = [];
    let nextUrl: string | null = firstUrl;

    while (nextUrl !== null) {
      const response = await this.requestRaw(nextUrl, init);
      const chunk = (await response.json()) as T[];
      if (Array.isArray(chunk)) out.push(...chunk);

      // Prefer X-Next-Page (older GitLab) then Link header (rel=next).
      const xNextPage = response.headers.get("X-Next-Page");
      const linkNext = parseNextLink(response.headers.get("Link"));

      if (xNextPage && xNextPage.trim().length > 0) {
        nextUrl = this.appendQuery(firstUrl, "page", xNextPage.trim());
      } else if (linkNext) {
        nextUrl = linkNext;
      } else {
        nextUrl = null;
      }
    }
    return out;
  }

  private projectPath(projectId: string | number): string {
    return `/projects/${encodeURIComponent(String(projectId))}`;
  }

  getMr(projectId: string | number, mrIid: number): Promise<GitlabMr> {
    return this.request<GitlabMr>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}`,
    );
  }

  getMrChanges(
    projectId: string | number,
    mrIid: number,
  ): Promise<GitlabMrChanges> {
    return this.request<GitlabMrChanges>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/changes`,
    );
  }

  listNotes(projectId: string | number, mrIid: number): Promise<GitlabNote[]> {
    return this.paginate<GitlabNote>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/notes`,
    );
  }

  listDiscussions(
    projectId: string | number,
    mrIid: number,
  ): Promise<GitlabDiscussion[]> {
    return this.paginate<GitlabDiscussion>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/discussions`,
    );
  }

  createNote(
    projectId: string | number,
    mrIid: number,
    body: string,
  ): Promise<GitlabNote> {
    return this.request<GitlabNote>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/notes`,
      { method: "POST", json: { body } },
    );
  }

  updateNote(
    projectId: string | number,
    mrIid: number,
    noteId: number,
    body: string,
  ): Promise<GitlabNote> {
    return this.request<GitlabNote>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/notes/${noteId}`,
      { method: "PUT", json: { body } },
    );
  }

  createDiscussionOnDiff(
    projectId: string | number,
    mrIid: number,
    body: string,
    position: GitlabPosition,
  ): Promise<GitlabDiscussion> {
    return this.request<GitlabDiscussion>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}/discussions`,
      { method: "POST", json: { body, position } },
    );
  }

  updateMrDescription(
    projectId: string | number,
    mrIid: number,
    description: string,
  ): Promise<GitlabMr> {
    return this.request<GitlabMr>(
      `${this.projectPath(projectId)}/merge_requests/${mrIid}`,
      { method: "PUT", json: { description } },
    );
  }
}

export function createGitlabClient(
  token: string,
  baseUrl?: string,
): GitlabClient {
  return new GitlabClient(token, baseUrl);
}

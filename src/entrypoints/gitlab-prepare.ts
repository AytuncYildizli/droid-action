#!/usr/bin/env bun

/**
 * Prepare step for the GitLab CI/CD Component.
 *
 * Responsibilities (v1, automatic review on MR pipelines only):
 *   1. Parse GitLab CI env into a normalized context.
 *   2. Decide whether this pipeline should run a review (automaticReview
 *      flag + merge_request_event source).
 *   3. Ensure a sticky tracking note exists on the MR; reuse the existing
 *      one if a prior pipeline already created it.
 *   4. Write a small JSON state file so the post-step (and `droid exec`)
 *      can look up the MR IID, note ID, and other context.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { parseGitlabContext, isMergeRequestContext } from "../gitlab/context";
import { setupGitlabToken, MissingGitlabTokenError } from "../gitlab/token";
import { GitlabClient } from "../gitlab/api/client";
import {
  buildTrackingNoteBody,
  findExistingTrackingNote,
} from "../gitlab/operations/tracking-note";
import { buildGitlabReviewPrompt } from "../gitlab/review-prompt";

type PrepareState = {
  shouldRunReview: boolean;
  projectId: string;
  projectPath: string;
  mrIid: number | null;
  trackingNoteId: number | null;
  diffBaseSha: string | null;
  sourceBranchSha: string | null;
  pipelineUrl: string | null;
  jobUrl: string | null;
  promptPath: string | null;
  reason?: string;
};

function promptFilePath(): string {
  return process.env.DROID_PROMPT_FILE || "/tmp/droid-prompts/droid-prompt.txt";
}

function stateFilePath(): string {
  return (
    process.env.DROID_STATE_FILE ||
    path.join(process.env.CI_PROJECT_DIR || "/tmp", ".droid-state.json")
  );
}

async function writeState(state: PrepareState): Promise<void> {
  const filePath = stateFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2));
  console.log(`Wrote droid state to ${filePath}`);
}

async function run(): Promise<void> {
  const context = parseGitlabContext();

  const baseState: PrepareState = {
    shouldRunReview: false,
    projectId: context.project.id,
    projectPath: context.project.pathWithNamespace,
    mrIid: context.mr?.iid ?? null,
    trackingNoteId: null,
    diffBaseSha: context.mr?.diffBaseSha ?? null,
    sourceBranchSha: context.mr?.sourceBranchSha ?? null,
    pipelineUrl: context.pipelineUrl,
    jobUrl: context.jobUrl,
    promptPath: null,
  };

  if (!isMergeRequestContext(context)) {
    console.log(
      "Not a merge_request_event pipeline; skipping droid review prepare.",
    );
    await writeState({
      ...baseState,
      reason: "not-merge-request-event",
    });
    return;
  }

  if (!context.inputs.automaticReview) {
    console.log("automatic_review is disabled; skipping droid review prepare.");
    await writeState({
      ...baseState,
      reason: "automatic-review-disabled",
    });
    return;
  }

  let token: string;
  try {
    token = setupGitlabToken();
  } catch (err) {
    if (err instanceof MissingGitlabTokenError) {
      console.error(err.message);
    }
    throw err;
  }

  const client = new GitlabClient(token, context.apiUrl);
  const mrIid = context.mr.iid;

  const existingNotes = await client.listNotes(context.project.id, mrIid);
  const existing = findExistingTrackingNote(existingNotes);

  const noteBody = buildTrackingNoteBody({
    state: "running",
    pipelineUrl: context.pipelineUrl,
    jobUrl: context.jobUrl,
    triggerUsername: context.user.login,
    securityReviewRan: context.inputs.automaticSecurityReview,
  });

  let trackingNoteId: number;
  if (existing) {
    await client.updateNote(context.project.id, mrIid, existing.id, noteBody);
    trackingNoteId = existing.id;
    console.log(`Reused existing tracking note ${trackingNoteId}`);
  } else {
    const created = await client.createNote(
      context.project.id,
      mrIid,
      noteBody,
    );
    trackingNoteId = created.id;
    console.log(`Created tracking note ${trackingNoteId}`);
  }

  console.log("Fetching MR changes to build review prompt...");
  const changes = await client.getMrChanges(context.project.id, mrIid);
  const mr = await client.getMr(context.project.id, mrIid);

  const diff = (changes.changes || [])
    .map((c) => {
      const header = `diff --git a/${c.old_path} b/${c.new_path}`;
      return `${header}\n${c.diff}`;
    })
    .join("\n");

  const prompt = buildGitlabReviewPrompt({
    projectPath: context.project.pathWithNamespace,
    mrIid,
    mrTitle: mr.title ?? context.mr.title,
    diff,
    reviewDepth: context.inputs.reviewDepth,
  });

  const promptPath = promptFilePath();
  await fs.mkdir(path.dirname(promptPath), { recursive: true });
  await fs.writeFile(promptPath, prompt);
  console.log(`Wrote review prompt (${prompt.length} bytes) to ${promptPath}`);

  await writeState({
    ...baseState,
    shouldRunReview: true,
    trackingNoteId,
    promptPath,
  });
}

if (import.meta.main) {
  run().catch((error) => {
    console.error("gitlab-prepare failed:", error);
    process.exit(1);
  });
}

export { run };

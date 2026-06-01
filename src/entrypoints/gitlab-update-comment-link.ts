#!/usr/bin/env bun

/**
 * Post-step for the GitLab CI/CD Component: edit the sticky tracking note
 * to reflect the final outcome (success/failure) and link to the pipeline.
 *
 * Inputs (env):
 *   GITLAB_TOKEN           - access token (api scope)
 *   DROID_STATE_FILE       - JSON state written by gitlab-prepare
 *   DROID_SUCCESS          - "true" | "false" set by the CI job
 *   DROID_ERROR_DETAILS    - optional error blob to embed on failure
 *   AUTOMATIC_SECURITY_REVIEW - "true" to render the security badge
 *   TRIGGER_USERNAME       - optional, e.g. GITLAB_USER_LOGIN
 *   CI_PIPELINE_URL / CI_JOB_URL - used to keep links fresh
 */

import * as fs from "fs/promises";
import * as path from "path";
import { setupGitlabToken } from "../gitlab/token";
import { GitlabClient } from "../gitlab/api/client";
import { buildTrackingNoteBody } from "../gitlab/operations/tracking-note";

type PrepareState = {
  shouldRunReview: boolean;
  projectId: string;
  projectPath: string;
  mrIid: number | null;
  trackingNoteId: number | null;
  pipelineUrl: string | null;
  jobUrl: string | null;
  reason?: string;
};

function stateFilePath(): string {
  return (
    process.env.DROID_STATE_FILE ||
    path.join(process.env.CI_PROJECT_DIR || "/tmp", ".droid-state.json")
  );
}

async function readState(): Promise<PrepareState | null> {
  const filePath = stateFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as PrepareState;
  } catch (err) {
    console.warn(`Could not read droid state file at ${filePath}:`, err);
    return null;
  }
}

async function run(): Promise<void> {
  const state = await readState();
  if (!state) {
    console.log("No droid state available; nothing to update.");
    return;
  }

  if (!state.shouldRunReview || !state.mrIid || !state.trackingNoteId) {
    console.log(
      `Skipping note update (shouldRunReview=${state.shouldRunReview}, ` +
        `mrIid=${state.mrIid}, trackingNoteId=${state.trackingNoteId}).`,
    );
    return;
  }

  const token = setupGitlabToken();
  const apiUrl =
    process.env.CI_API_V4_URL ||
    process.env.GITLAB_API_URL ||
    "https://gitlab.com/api/v4";

  const client = new GitlabClient(token, apiUrl);

  const droidSuccess = process.env.DROID_SUCCESS !== "false";
  const errorDetails = process.env.DROID_ERROR_DETAILS || null;
  const securityReviewRan = process.env.AUTOMATIC_SECURITY_REVIEW === "true";
  const triggerUsername =
    process.env.TRIGGER_USERNAME || process.env.GITLAB_USER_LOGIN || null;

  const pipelineUrl = process.env.CI_PIPELINE_URL || state.pipelineUrl;
  const jobUrl = process.env.CI_JOB_URL || state.jobUrl;

  const body = buildTrackingNoteBody({
    state: droidSuccess ? "success" : "failure",
    pipelineUrl,
    jobUrl,
    triggerUsername,
    errorDetails,
    securityReviewRan,
  });

  await client.updateNote(
    state.projectId,
    state.mrIid,
    state.trackingNoteId,
    body,
  );

  console.log(
    `Updated tracking note ${state.trackingNoteId} on MR !${state.mrIid} ` +
      `(state=${droidSuccess ? "success" : "failure"}).`,
  );
}

if (import.meta.main) {
  run().catch((error) => {
    console.error("gitlab-update-comment-link failed:", error);
    process.exit(1);
  });
}

export { run };

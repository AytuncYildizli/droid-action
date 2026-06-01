import { describe, expect, it } from "bun:test";
import {
  DROID_TRACKING_MARKER,
  buildTrackingNoteBody,
  findExistingTrackingNote,
} from "../../src/gitlab/operations/tracking-note";

describe("buildTrackingNoteBody", () => {
  it("includes the tracking marker in every state", () => {
    for (const state of ["running", "success", "failure"] as const) {
      const body = buildTrackingNoteBody({ state });
      expect(body).toContain(DROID_TRACKING_MARKER);
    }
  });

  it("renders pipeline + job links when provided", () => {
    const body = buildTrackingNoteBody({
      state: "running",
      pipelineUrl: "https://gitlab.com/p/-/pipelines/1",
      jobUrl: "https://gitlab.com/p/-/jobs/2",
    });
    expect(body).toContain("Pipeline: https://gitlab.com/p/-/pipelines/1");
    expect(body).toContain("Job log: https://gitlab.com/p/-/jobs/2");
  });

  it("renders security badge when securityReviewRan is true", () => {
    const body = buildTrackingNoteBody({
      state: "running",
      securityReviewRan: true,
    });
    expect(body).toContain("security%20review-enabled");
  });

  it("omits security badge when securityReviewRan is false", () => {
    const body = buildTrackingNoteBody({
      state: "running",
      securityReviewRan: false,
    });
    expect(body).not.toContain("security%20review-enabled");
  });

  it("embeds error details only on failure state", () => {
    const failure = buildTrackingNoteBody({
      state: "failure",
      errorDetails: "boom",
    });
    expect(failure).toContain("<details>");
    expect(failure).toContain("boom");

    const success = buildTrackingNoteBody({
      state: "success",
      errorDetails: "boom",
    });
    expect(success).not.toContain("<details>");
  });
});

describe("findExistingTrackingNote", () => {
  it("finds the note containing the droid marker", () => {
    const notes = [
      { id: 1, body: "regular comment" },
      { id: 2, body: `${DROID_TRACKING_MARKER}\nDroid is reviewing...` },
      { id: 3, body: "another comment" },
    ];
    expect(findExistingTrackingNote(notes)?.id).toBe(2);
  });

  it("returns undefined when no tracking note exists", () => {
    const notes = [{ id: 1, body: "regular comment" }];
    expect(findExistingTrackingNote(notes)).toBeUndefined();
  });
});

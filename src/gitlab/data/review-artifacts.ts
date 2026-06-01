/**
 * Compute and persist the three artifact files that the GitLab review
 * prompts read from disk:
 *
 *   - mr.diff               : concatenated unified diff for every changed file
 *   - existing_comments.json : array of notes already on the MR (system+human)
 *   - mr_description.txt    : MR title + description
 *
 * These mirror the artifacts the GitHub Action precomputes
 * (`pr.diff`, `existing_comments.json`, `pr_description.txt`) so the GitLab
 * Pass-1 / Pass-2 prompts can refer to them by stable paths and the model
 * doesn't have to round-trip through MCP tools to fetch them.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { GitlabClient } from "../api/client";
import type { GitlabMr, GitlabMrChanges, GitlabNote } from "../types";

export type GitlabReviewArtifactPaths = {
  diffPath: string;
  commentsPath: string;
  descriptionPath: string;
};

export type GitlabReviewArtifacts = GitlabReviewArtifactPaths & {
  mr: GitlabMr;
  changes: GitlabMrChanges;
  notes: GitlabNote[];
};

export type ComputeReviewArtifactsOptions = {
  client: GitlabClient;
  projectId: string | number;
  mrIid: number;
  outDir: string;
};

export function buildDiffContent(changes: GitlabMrChanges): string {
  const files = changes.changes ?? [];
  if (files.length === 0) {
    return "";
  }
  return files
    .map((c) => {
      const oldPath = c.old_path || c.new_path;
      const newPath = c.new_path || c.old_path;
      const header = `diff --git a/${oldPath} b/${newPath}`;
      return `${header}\n${c.diff}`;
    })
    .join("\n");
}

export function buildDescriptionContent(mr: GitlabMr): string {
  const title = mr.title ?? "";
  const description = mr.description ?? "";
  return `Title: ${title}\n\n${description}\n`;
}

export async function computeReviewArtifacts(
  opts: ComputeReviewArtifactsOptions,
): Promise<GitlabReviewArtifacts> {
  const { client, projectId, mrIid, outDir } = opts;

  await fs.mkdir(outDir, { recursive: true });

  const [mr, changes, notes] = await Promise.all([
    client.getMr(projectId, mrIid),
    client.getMrChanges(projectId, mrIid),
    client.listNotes(projectId, mrIid),
  ]);

  const diffPath = path.join(outDir, "mr.diff");
  const commentsPath = path.join(outDir, "existing_comments.json");
  const descriptionPath = path.join(outDir, "mr_description.txt");

  const diffContent = buildDiffContent(changes);
  const descriptionContent = buildDescriptionContent(mr);

  await Promise.all([
    fs.writeFile(diffPath, diffContent),
    fs.writeFile(commentsPath, JSON.stringify(notes, null, 2)),
    fs.writeFile(descriptionPath, descriptionContent),
  ]);

  return {
    diffPath,
    commentsPath,
    descriptionPath,
    mr,
    changes,
    notes,
  };
}

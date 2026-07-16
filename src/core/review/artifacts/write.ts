import * as fs from "fs/promises";
import * as path from "path";
import type {
  ReviewArtifactContents,
  ReviewArtifactNames,
  ReviewArtifactPaths,
} from "./types";

/**
 * Write the three review-artifact files into `outDir` in parallel,
 * creating `outDir` if it doesn't yet exist. Returns the resolved
 * on-disk paths so the caller can hand them straight to the prompt
 * builder.
 */
export async function writeReviewArtifacts(
  outDir: string,
  contents: ReviewArtifactContents,
  names: ReviewArtifactNames,
): Promise<ReviewArtifactPaths> {
  await fs.mkdir(outDir, { recursive: true });

  const diffPath = path.join(outDir, names.diff);
  const commentsPath = path.join(outDir, names.comments);
  const descriptionPath = path.join(outDir, names.description);

  await Promise.all([
    fs.writeFile(diffPath, contents.diff),
    fs.writeFile(commentsPath, JSON.stringify(contents.comments, null, 2)),
    fs.writeFile(descriptionPath, contents.description),
  ]);

  return { diffPath, commentsPath, descriptionPath };
}

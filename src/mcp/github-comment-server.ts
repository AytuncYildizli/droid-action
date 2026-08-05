#!/usr/bin/env node
// GitHub Comment MCP Server - Minimal server that only provides comment update functionality
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GITHUB_API_URL } from "../github/api/config";
import { Octokit } from "@octokit/rest";
import { updateDroidComment } from "../github/operations/comments/update-droid-comment";
import { sanitizeContent } from "../github/utils/sanitizer";

// Get repository information from environment variables
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;

if (!REPO_OWNER || !REPO_NAME) {
  console.error(
    "Error: REPO_OWNER and REPO_NAME environment variables are required",
  );
  process.exit(1);
}

const server = new McpServer({
  name: "GitHub Comment Server",
  version: "0.0.1",
});

server.tool(
  "update_droid_comment",
  "Update the Droid comment with progress and results (automatically handles both issue and PR comments)",
  {
    body: z.string().describe("The updated comment content"),
  },
  async ({ body }) => {
    try {
      const githubToken = process.env.GITHUB_TOKEN;
      const droidCommentId = process.env.DROID_COMMENT_ID;
      const eventName = process.env.GITHUB_EVENT_NAME;

      if (!githubToken) {
        throw new Error("GITHUB_TOKEN environment variable is required");
      }
      if (!droidCommentId) {
        throw new Error("DROID_COMMENT_ID environment variable is required");
      }

      const owner = REPO_OWNER;
      const repo = REPO_NAME;
      const commentId = parseInt(droidCommentId, 10);

      const octokit = new Octokit({
        auth: githubToken,
        baseUrl: GITHUB_API_URL,
      });

      const isPullRequestReviewComment =
        eventName === "pull_request_review_comment";

      let sanitizedBody = sanitizeContent(body);

      // CI Medic keeps its lifetime run budget in a marker on this comment.
      // Droid replaces the whole body, so carry the marker forward or every
      // successful run silently erases its own record of having happened.
      if (
        process.env.MEDIC_PR_NUMBER &&
        !isPullRequestReviewComment &&
        !sanitizedBody.includes("<!-- ci-medic:run=")
      ) {
        const existing = await octokit.rest.issues
          .getComment({ owner, repo, comment_id: commentId })
          .catch(() => null);
        const marker = existing?.data.body?.match(
          /<!-- ci-medic:run=\S+ count=\d+ -->/,
        )?.[0];
        if (marker) {
          sanitizedBody = `${sanitizedBody}\n\n${marker}`;
        }
      }

      const result = await updateDroidComment(octokit, {
        owner,
        repo,
        commentId,
        body: sanitizedBody,
        isPullRequestReviewComment,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        error: errorMessage,
        isError: true,
      };
    }
  },
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.on("exit", () => {
    server.close();
  });
}

runServer().catch(console.error);

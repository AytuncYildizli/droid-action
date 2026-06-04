export const GITLAB_API_URL = (
  process.env.CI_API_V4_URL || "https://gitlab.com/api/v4"
).replace(/\/+$/, "");

export const GITLAB_SERVER_URL = (
  process.env.CI_SERVER_URL || "https://gitlab.com"
).replace(/\/+$/, "");

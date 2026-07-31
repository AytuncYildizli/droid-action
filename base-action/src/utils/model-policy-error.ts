/**
 * Matches the 403 errors returned by the Factory API when a request uses a
 * model that the organization's model policy does not allow, including the
 * explicit opt-in variant ("This model requires explicit organization
 * opt-in by an admin.").
 */
const MODEL_POLICY_ERROR_PATTERNS = [
  /not available due to your organization['’]s security settings/i,
  /requires explicit organization opt-in/i,
];

export function isModelPolicyError(text: string | undefined | null): boolean {
  if (!text) {
    return false;
  }
  return MODEL_POLICY_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Remove `--model <value>` and `--reasoning-effort <value>` (including
 * `--flag=value` forms) from an argv array so droid exec falls back to the
 * organization's default model.
 */
export function stripModelArgs(args: string[]): string[] {
  const stripped: string[] = [];
  let skipNext = false;

  for (const arg of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (arg === "--model" || arg === "--reasoning-effort") {
      skipNext = true;
      continue;
    }
    if (arg.startsWith("--model=") || arg.startsWith("--reasoning-effort=")) {
      continue;
    }
    stripped.push(arg);
  }

  return stripped;
}

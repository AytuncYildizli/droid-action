/**
 * Platform-agnostic Droid command parser.
 *
 * Both GitHub and GitLab look for the same `@droid <command>` mentions
 * in PR/MR bodies and comments. This parser only operates on a raw
 * string; the per-platform context extraction (which fields of which
 * webhook payload to scan) stays in the platform-specific module
 * because the payload shapes diverge.
 */

export type DroidCommand =
  | "fill"
  | "review"
  | "security"
  | "security-full"
  | "default";

export interface ParsedCommand {
  command: DroidCommand;
  raw: string;
  location: "body" | "comment";
  timestamp?: string | null;
}

/**
 * Parses text to detect specific @droid commands.
 *
 * Returns `null` when no `@droid` mention is present, the generic
 * `default` command for a bare `@droid`, or the specific subcommand
 * when matched. `location` defaults to "body" and is overridden by
 * the caller when the text came from a comment.
 */
export function parseDroidCommand(text: string): ParsedCommand | null {
  if (!text) {
    return null;
  }

  const fillMatch = text.match(/@droid\s+fill/i);
  if (fillMatch) {
    return { command: "fill", raw: fillMatch[0], location: "body" };
  }

  // Note: `@droid review security` will match as just `@droid review`.
  const reviewMatch = text.match(/@droid\s+review/i);
  if (reviewMatch) {
    return { command: "review", raw: reviewMatch[0], location: "body" };
  }

  const securityFullMatch = text.match(/@droid\s+security\s+--full/i);
  if (securityFullMatch) {
    return {
      command: "security-full",
      raw: securityFullMatch[0],
      location: "body",
    };
  }

  // Check after security-full to avoid false matches.
  const securityMatch = text.match(/@droid\s+security(?:\s|$|[^-\w])/i);
  if (securityMatch) {
    return {
      command: "security",
      raw: securityMatch[0].trim(),
      location: "body",
    };
  }

  const droidMatch = text.match(/@droid/i);
  if (droidMatch) {
    return { command: "default", raw: droidMatch[0], location: "body" };
  }

  return null;
}

import type { Octokits } from "../github/api/client";

export type MedicConfig = {
  instructions: string;
  workflows: { exclude: string[] };
  retry: {
    mode: "off" | "always" | "smart";
    max_per_job: number;
    eligible: string[];
    exclude: string[];
  };
  fix: {
    enabled: boolean;
    max_attempts: number;
    protected_paths: string[];
    scope: string[];
    commit_prefix: string;
  };
  skip: {
    draft_prs: boolean;
    labels: string[];
    branches: string[];
    authors: string[];
  };
  max_runs_per_pr: number;
};

export const defaultMedicConfig = (): MedicConfig => ({
  instructions: "",
  workflows: { exclude: [] },
  retry: { mode: "smart", max_per_job: 1, eligible: [], exclude: [] },
  fix: {
    enabled: false,
    max_attempts: 2,
    protected_paths: [".github/workflows/**"],
    scope: ["lint", "types", "tests", "build"],
    commit_prefix: "fix(ci): ",
  },
  skip: { draft_prs: true, labels: ["no-droid-ci"], branches: [], authors: [] },
  max_runs_per_pr: 10,
});

// Deliberately small parser for the documented config shape. Values are merged
// with action inputs, so malformed or unsupported lines safely remain defaults.
function parseConfig(text: string): Partial<MedicConfig> {
  try {
    return JSON.parse(text) as Partial<MedicConfig>;
  } catch {
    const result: Record<string, unknown> = {};
    let section = "";
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trimEnd();
      if (!line.trim() || line.startsWith("---")) continue;
      const sectionMatch = /^([A-Za-z_]+):\s*$/.exec(line);
      if (sectionMatch) {
        section = sectionMatch[1]!;
        result[section] = {};
        continue;
      }
      const match = /^\s*([A-Za-z_]+):\s*(.+)$/.exec(line);
      if (!match) continue;
      const key = match[1]!;
      const value = match[2]!;
      const parsed = value.replace(/^['"]|['"]$/g, "");
      const target = section
        ? (result[section] as Record<string, unknown>)
        : result;
      target[key] = parseScalar(parsed);
    }
    return result as Partial<MedicConfig>;
  }
}

function parseScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  if (value.startsWith("[") || value.startsWith("{")) {
    try {
      // Flow-style YAML leaves keys unquoted, which JSON.parse rejects.
      const quoted = value
        .replace(/'/g, '"')
        .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
      return JSON.parse(quoted);
    } catch {
      return value;
    }
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) return value.map((entry) => String(entry));
  if (typeof value === "string" && value.trim()) {
    return value
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asString(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

// Coerces every field back to its declared type. Repository config is
// untrusted input, so a malformed value must degrade to the base value rather
// than leave a nested object undefined for downstream gate checks.
function mergeConfig(
  base: MedicConfig,
  override: Partial<MedicConfig>,
): MedicConfig {
  const source = asRecord(override);
  const workflows = asRecord(source.workflows);
  const retry = asRecord(source.retry);
  const fix = asRecord(source.fix);
  const skip = asRecord(source.skip);
  const mode = asString(retry.mode, base.retry.mode);

  return {
    instructions: asString(source.instructions, base.instructions),
    workflows: {
      exclude: asStringArray(workflows.exclude, base.workflows.exclude),
    },
    retry: {
      mode:
        mode === "off" || mode === "always" || mode === "smart"
          ? mode
          : base.retry.mode,
      max_per_job: asNumber(retry.max_per_job, base.retry.max_per_job),
      eligible: asStringArray(retry.eligible, base.retry.eligible),
      exclude: asStringArray(retry.exclude, base.retry.exclude),
    },
    fix: {
      enabled: asBoolean(fix.enabled, base.fix.enabled),
      max_attempts: asNumber(fix.max_attempts, base.fix.max_attempts),
      protected_paths: asStringArray(
        fix.protected_paths,
        base.fix.protected_paths,
      ),
      scope: asStringArray(fix.scope, base.fix.scope),
      commit_prefix: asString(fix.commit_prefix, base.fix.commit_prefix),
    },
    skip: {
      draft_prs: asBoolean(skip.draft_prs, base.skip.draft_prs),
      labels: asStringArray(skip.labels, base.skip.labels),
      branches: asStringArray(skip.branches, base.skip.branches),
      authors: asStringArray(skip.authors, base.skip.authors),
    },
    max_runs_per_pr: asNumber(source.max_runs_per_pr, base.max_runs_per_pr),
  };
}

export async function loadMedicConfig(
  octokit: Octokits,
  owner: string,
  repo: string,
  ref: string,
  path: string,
  actionInputs: Partial<MedicConfig>,
): Promise<MedicConfig> {
  let fileConfig: Partial<MedicConfig> = {};
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    if (!Array.isArray(response.data) && "content" in response.data) {
      fileConfig = parseConfig(
        Buffer.from(response.data.content, "base64").toString("utf8"),
      );
    }
  } catch {
    // Configuration is optional.
  }
  return mergeConfig(
    mergeConfig(defaultMedicConfig(), fileConfig),
    actionInputs,
  );
}

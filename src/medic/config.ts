import { parse as parseYaml } from "yaml";
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

// Callers supply only the keys they mean to change; every absent key keeps the
// value it already had rather than reverting to a default.
export type MedicConfigOverride = {
  instructions?: string;
  workflows?: Partial<MedicConfig["workflows"]>;
  retry?: Partial<MedicConfig["retry"]>;
  fix?: Partial<MedicConfig["fix"]>;
  skip?: Partial<MedicConfig["skip"]>;
  max_runs_per_pr?: number;
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

// A hand-rolled parser previously handled only `key: value` on one line, which
// silently dropped block sequences and any top-level key following a nested
// block. Dropping a `protected_paths` list to the default reads as success, so
// the failure mode was an invisible loss of a safety limit. Parse real YAML.
function parseConfig(text: string): MedicConfigOverride {
  try {
    return asRecord(parseYaml(text)) as MedicConfigOverride;
  } catch {
    // A malformed file must not silently run with defaults, because the
    // defaults may be weaker than what the author wrote.
    throw new MedicConfigError("configuration file is not valid YAML");
  }
}

export class MedicConfigError extends Error {}

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
  override: MedicConfigOverride,
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
  ref: string | undefined,
  path: string,
  actionInputs: MedicConfigOverride,
): Promise<MedicConfig> {
  let fileConfig: MedicConfigOverride = {};
  let raw: string | undefined;
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ...(ref ? { ref } : {}),
    });
    if (!Array.isArray(response.data) && "content" in response.data) {
      raw = Buffer.from(response.data.content, "base64").toString("utf8");
    }
  } catch {
    // Configuration is optional; only its contents are validated.
  }
  if (raw !== undefined) fileConfig = parseConfig(raw);
  return mergeConfig(
    mergeConfig(defaultMedicConfig(), fileConfig),
    actionInputs,
  );
}

export type FailedCheck = {
  workflow: string;
  job: string;
  steps: string[];
};

// A repository names its jobs "unit" or "tsc", not "tests" and "types", so
// matching the configured category words literally would switch auto-fix off
// almost everywhere. Each category carries the names repositories actually
// use; anything unrecognized stays out of scope rather than being waved
// through, and the reason is reported so it is debuggable rather than silent.
const CATEGORY_ALIASES: Record<string, string[]> = {
  lint: [
    "lint",
    "eslint",
    "tslint",
    "prettier",
    "format",
    "fmt",
    "style",
    "clippy",
    "rubocop",
    "ruff",
    "flake8",
  ],
  types: ["type", "typecheck", "tsc", "mypy", "pyright", "flow"],
  tests: [
    "test",
    "spec",
    "unit",
    "integration",
    "e2e",
    "jest",
    "vitest",
    "pytest",
    "rspec",
    "mocha",
  ],
  build: [
    "build",
    "compile",
    "bundle",
    "package",
    "webpack",
    "vite",
    "rollup",
    "esbuild",
  ],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function checkCategories(check: FailedCheck): string[] {
  const words = tokenize([check.job, ...check.steps].join(" "));
  return Object.entries(CATEGORY_ALIASES)
    .filter(([, aliases]) =>
      words.some((word) => aliases.some((alias) => word.startsWith(alias))),
    )
    .map(([category]) => category);
}

export function checkMatchesScope(
  scope: string[],
  check: FailedCheck,
): boolean {
  const words = tokenize([check.job, ...check.steps].join(" "));
  return scope.some((entry) => {
    const key = entry.toLowerCase().trim();
    // An unknown scope entry is matched on its own name, so a repository can
    // add a category such as "e2e" or "docs" without a code change.
    const aliases = CATEGORY_ALIASES[key] ?? [key];
    return words.some((word) =>
      aliases.some((alias) => word.startsWith(alias)),
    );
  });
}

export function checksInScope(
  scope: string[],
  checks: FailedCheck[],
): FailedCheck[] {
  return checks.filter((check) => checkMatchesScope(scope, check));
}

export function describeChecks(checks: FailedCheck[]): string {
  return checks.map((check) => `${check.workflow} / ${check.job}`).join(", ");
}

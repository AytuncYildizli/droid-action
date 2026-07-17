import * as core from "@actions/core";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { stat } from "fs/promises";
import { parse as parseShellArgs } from "shell-quote";
import { retryWithBackoff } from "./utils/retry";

const execAsync = promisify(exec);

/** Redact inline `--env KEY=value` secrets before logging a command string. */
function redactEnvSecrets(text: string): string {
  return text.replace(/--env\s+(\S+?)=\S+/g, "--env $1=***");
}

const BASE_ARGS = [
  "exec",
  "--output-format",
  "stream-json",
  "--skip-permissions-unsafe",
];

/**
 * Sanitizes JSON output to remove sensitive information when full output is disabled
 * Returns a safe summary message or null if the message should be completely suppressed
 */
function sanitizeJsonOutput(
  jsonObj: any,
  showFullOutput: boolean,
): string | null {
  if (showFullOutput) {
    // In full output mode, return the full JSON
    return JSON.stringify(jsonObj, null, 2);
  }

  // In non-full-output mode, provide minimal safe output
  const type = jsonObj.type;
  const subtype = jsonObj.subtype;

  // System initialization - safe to show
  if (type === "system" && subtype === "init") {
    return JSON.stringify(
      {
        type: "system",
        subtype: "init",
        message: "Droid Exec initialized",
        model: jsonObj.model || "unknown",
      },
      null,
      2,
    );
  }

  // Result messages - Always show the final result
  if (type === "result") {
    // These messages contain the final result and should always be visible
    return JSON.stringify(
      {
        type: "result",
        subtype: jsonObj.subtype,
        is_error: jsonObj.is_error,
        duration_ms: jsonObj.duration_ms,
        num_turns: jsonObj.num_turns,
        total_cost_usd: jsonObj.total_cost_usd,
        permission_denials: jsonObj.permission_denials,
      },
      null,
      2,
    );
  }

  // For any other message types, suppress completely in non-full-output mode
  return null;
}

export type DroidOptions = {
  droidArgs?: string;
  reasoningEffort?: string;
  pathToDroidExecutable?: string;
  allowedTools?: string;
  disallowedTools?: string;
  maxTurns?: string;
  mcpTools?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  showFullOutput?: string;
};

type PreparedConfig = {
  droidArgs: string[];
  promptPath: string;
  env: Record<string, string>;
};

export function prepareRunConfig(
  promptPath: string,
  options: DroidOptions,
): PreparedConfig {
  const droidArgs = [...BASE_ARGS];

  // Add reasoning effort only when explicitly requested
  if (options.reasoningEffort?.trim()) {
    droidArgs.push("--reasoning-effort", options.reasoningEffort.trim());
  }

  // Parse and add user's custom Droid arguments
  if (options.droidArgs?.trim()) {
    const parsed = parseShellArgs(options.droidArgs);
    const customArgs = parsed.filter(
      (arg): arg is string => typeof arg === "string",
    );
    droidArgs.push(...customArgs);
  }

  droidArgs.push("-f", promptPath);

  const customEnv: Record<string, string> = {};

  if (process.env.INPUT_ACTION_INPUTS_PRESENT) {
    customEnv.GITHUB_ACTION_INPUTS = process.env.INPUT_ACTION_INPUTS_PRESENT;
  }

  return {
    droidArgs,
    promptPath,
    env: customEnv,
  };
}

export async function runDroid(promptPath: string, options: DroidOptions) {
  // If MCP tools config is provided, register servers via `droid mcp add` before running exec
  if (options.mcpTools && options.mcpTools.trim()) {
    try {
      const cfg = JSON.parse(options.mcpTools);
      const servers = cfg?.mcpServers || {};
      const serverNames = Object.keys(servers);

      if (serverNames.length > 0) {
        console.log(
          `Registering ${serverNames.length} MCP servers: ${serverNames.join(", ")}`,
        );

        for (const [name, def] of Object.entries<any>(servers)) {
          const cmd = [def.command, ...(def.args || [])]
            .filter(Boolean)
            .join(" ");

          // Build env flags
          const envFlags = Object.entries(def.env || {})
            .map(([k, v]) => `--env ${k}=${String(v)}`)
            .join(" ");

          const addCmd = `droid mcp add ${name} "${cmd}" ${envFlags}`.trim();

          try {
            await retryWithBackoff(
              async () => {
                // Remove existing server if present (ignore errors) before each attempt
                try {
                  await execAsync(`droid mcp remove ${name}`);
                } catch (_) {
                  // Ignore - server might not exist
                }
                try {
                  await execAsync(addCmd, { env: { ...process.env } });
                } catch (err) {
                  // Redact inline --env secrets before they reach any log or rethrow.
                  const message =
                    err instanceof Error ? err.message : String(err);
                  throw new Error(redactEnvSecrets(message));
                }
              },
              { maxAttempts: 3, initialDelayMs: 2000, maxDelayMs: 10000 },
            );
            console.log(`  ✓ Registered MCP server: ${name}`);
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(
              `  ✗ Failed to register MCP server ${name}:`,
              message,
            );
            throw new Error(message);
          }
        }
      }
    } catch (e) {
      console.error("Failed to register MCP servers:", e);
      // Don't continue without MCP if we were expecting it
      throw new Error(`MCP server registration failed: ${e}`);
    }
  }

  const config = prepareRunConfig(promptPath, options);

  // Log prompt file size
  let promptSize = "unknown";
  try {
    const stats = await stat(config.promptPath);
    promptSize = stats.size.toString();
  } catch (e) {
    // Ignore error
  }

  console.log(`Prompt file size: ${promptSize} bytes`);

  // Log custom environment variables if any
  const customEnvKeys = Object.keys(config.env).filter(
    (key) => key !== "DROID_ACTION_INPUTS_PRESENT",
  );
  if (customEnvKeys.length > 0) {
    console.log(`Custom environment variables: ${customEnvKeys.join(", ")}`);
  }

  // Log custom arguments if any
  if (options.droidArgs && options.droidArgs.trim() !== "") {
    console.log(`Custom Droid arguments: ${options.droidArgs}`);

    // Check for deprecated MCP tool naming
    const enabledToolsMatch = options.droidArgs.match(
      /--enabled-tools\s+["\']?([^"\']+)["\']?/,
    );
    if (enabledToolsMatch && enabledToolsMatch[1]) {
      const tools = enabledToolsMatch[1].split(",").map((t) => t.trim());
      const oldStyleTools = tools.filter((t) => t.startsWith("mcp__"));

      if (oldStyleTools.length > 0) {
        console.warn(
          `Warning: Found ${oldStyleTools.length} tools with deprecated mcp__ prefix. Update to new pattern (e.g., github_comment___update_droid_comment)`,
        );
      }
    }
  }

  // Output to console
  console.log(`Running Droid Exec with prompt from file: ${config.promptPath}`);
  console.log(`Full command: droid ${config.droidArgs.join(" ")}`);

  // Use custom executable path if provided, otherwise default to "droid"
  const droidExecutable = options.pathToDroidExecutable || "droid";

  // Determine if full output should be shown
  // Show full output if explicitly set to "true" OR if GitHub Actions debug mode is enabled
  const isDebugMode = process.env.ACTIONS_STEP_DEBUG === "true";
  let showFullOutput = options.showFullOutput === "true" || isDebugMode;

  if (isDebugMode && options.showFullOutput !== "false") {
    console.log("Debug mode detected - showing full output");
    showFullOutput = true;
  } else if (!showFullOutput) {
    console.log("Running Droid Exec (full output hidden for security)...");
    console.log(
      "Rerun in debug mode or enable `show_full_output: true` in your workflow file for full output.",
    );
  }

  // Run Droid Exec with retry for transient failures. Uses the shared
  // retryWithBackoff so backoff timing lives in one place (3 total attempts,
  // 5s then 10s delays).
  let lastExitCode = 1;

  const runDroidOnce = (): Promise<number> => {
    const droidProcess = spawn(droidExecutable, config.droidArgs, {
      stdio: ["ignore", "pipe", "inherit"],
      env: {
        ...process.env,
        ...config.env,
      },
    });

    // Handle Droid process errors
    droidProcess.on("error", (error) => {
      console.error("Error spawning Droid process:", error);
    });

    // Capture output for parsing execution metrics
    let sessionId: string | undefined;
    droidProcess.stdout.on("data", (data) => {
      const text = data.toString();

      // Try to parse as JSON and handle based on verbose setting
      const lines = text.split("\n");
      lines.forEach((line: string, index: number) => {
        if (line.trim() === "") return;

        try {
          // Check if this line is a JSON object
          const parsed = JSON.parse(line);
          if (!sessionId && typeof parsed === "object" && parsed !== null) {
            const detectedSessionId = parsed.session_id;
            if (
              typeof detectedSessionId === "string" &&
              detectedSessionId.trim()
            ) {
              sessionId = detectedSessionId;
              console.log(`Detected Droid session: ${sessionId}`);
            }
          }
          const sanitizedOutput = sanitizeJsonOutput(parsed, showFullOutput);

          if (sanitizedOutput) {
            process.stdout.write(sanitizedOutput);
            if (index < lines.length - 1 || text.endsWith("\n")) {
              process.stdout.write("\n");
            }
          }
        } catch (e) {
          // Not a JSON object
          if (showFullOutput) {
            // In full output mode, print as is
            process.stdout.write(line);
            if (index < lines.length - 1 || text.endsWith("\n")) {
              process.stdout.write("\n");
            }
          }
          // In non-full-output mode, suppress non-JSON output
        }
      });
    });

    // Handle stdout errors
    droidProcess.stdout.on("error", (error) => {
      console.error("Error reading Droid stdout:", error);
    });

    // Wait for Droid Exec to finish
    return new Promise<number>((resolve) => {
      droidProcess.on("close", (code) => {
        resolve(code || 0);
      });

      droidProcess.on("error", (error) => {
        console.error("Droid process error:", error);
        resolve(1);
      });
    });
  };

  try {
    await retryWithBackoff(
      async () => {
        lastExitCode = await runDroidOnce();
        if (lastExitCode !== 0) {
          console.log(`Droid Exec exited with code ${lastExitCode}`);
          throw new Error(`Droid Exec exited with code ${lastExitCode}`);
        }
      },
      { maxAttempts: 3, initialDelayMs: 5000, maxDelayMs: 20000 },
    );
    core.setOutput("conclusion", "success");
    return;
  } catch (_) {
    // All retry attempts exhausted
    console.error(
      `Droid Exec failed after 3 total attempts (exit code: ${lastExitCode})`,
    );
    core.setOutput("conclusion", "failure");
    process.exit(lastExitCode);
  }
}

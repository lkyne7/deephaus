import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { LocalAiEngine, LocalAiRequest, LocalAiStatus } from "@deephaus/shared" with { "resolution-mode": "import" };

/**
 * Runs the Claude Code and Codex CLIs the user has installed and signed in to,
 * so card generation uses their own subscription. DeepHaus never sees their
 * credentials: sign-in stays inside each vendor's own CLI.
 *
 * Source documents are untrusted and these CLIs are agents, so a prompt-injected
 * PDF must find nothing to act with. Every run gets no tools, no MCP servers, no
 * user config, and an empty scratch directory. See docs/local-ai-engines.md.
 */

const RUN_TIMEOUT_MS = 5 * 60 * 1000;
const STATUS_TIMEOUT_MS = 15 * 1000;
const SHELL_TIMEOUT_MS = 5 * 1000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2_000_000;
const MAX_SCHEMA_CHARS = 16_000;

/** A sonnet-class model: strong cards without draining a plan's top-tier limits. */
const CLAUDE_MODEL = "sonnet";

/** Any of these would bill an API account, or another provider, instead of the plan. */
const PROVIDER_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "CODEX_API_KEY",
  "ELECTRON_RUN_AS_NODE",
];

const CLI_NAMES: Record<LocalAiEngine, string> = { claude: "claude", codex: "codex" };

const running = new Map<string, AbortController>();

export function parseLocalAiRequest(value: unknown): LocalAiRequest {
  const { id, engine, system, prompt, schema } = (value ?? {}) as Partial<LocalAiRequest>;
  if (
    typeof id !== "string" ||
    (engine !== "claude" && engine !== "codex") ||
    typeof system !== "string" ||
    typeof prompt !== "string" ||
    system.length + prompt.length > MAX_PROMPT_CHARS ||
    !schema ||
    typeof schema !== "object" ||
    JSON.stringify(schema).length > MAX_SCHEMA_CHARS
  ) {
    throw new Error("Invalid local AI request.");
  }
  return { id, engine, system, prompt, schema };
}

let shellPathPromise: Promise<string> | undefined;

/**
 * Apps opened from Finder inherit a minimal PATH, which misses Homebrew, nvm
 * and friends, and npm-installed CLIs also need `node` on it. Ask the login
 * shell, the way editors do.
 */
function searchPath(): Promise<string> {
  shellPathPromise ??= (async () => {
    const inherited = process.env.PATH ?? "";
    if (process.platform === "win32") return inherited;
    const known = [path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
    const shell = process.env.SHELL || "/bin/zsh";
    const result = await run(shell, ["-ilc", 'printf "__DH_PATH__%s__DH_PATH__" "$PATH"'], {
      timeoutMs: SHELL_TIMEOUT_MS,
      env: process.env,
    }).catch(() => null);
    const fromShell = result?.stdout.match(/__DH_PATH__(.*)__DH_PATH__/s)?.[1] ?? "";
    return [fromShell, inherited, ...known].filter(Boolean).join(path.delimiter);
  })();
  return shellPathPromise;
}

/** Never resolves `.cmd` shims: running those needs a shell, and these runs never use one. */
export function findExecutable(name: string, pathValue: string): string | null {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, file);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

export function cliEnv(pathValue: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PATH: pathValue };
  for (const key of PROVIDER_ENV) delete env[key];
  return env;
}

type RunResult = { code: number | null; stdout: string; stderr: string };

function run(
  command: string,
  args: string[],
  options: {
    timeoutMs: number;
    env: NodeJS.ProcessEnv;
    cwd?: string;
    input?: string;
    signal?: AbortSignal;
  },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      child.kill();
    };
    const timer = setTimeout(() => stop(new Error("The AI run timed out.")), options.timeoutMs);
    const onAbort = () => stop(new Error("Stopped."));
    if (options.signal?.aborted) onAbort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (append: (text: string) => void) => (data: Buffer) => {
      append(data.toString("utf8"));
      if (stdout.length + stderr.length > MAX_OUTPUT_BYTES) stop(new Error("The AI run returned too much output."));
    };
    child.stdout.on("data", collect((text) => (stdout += text)));
    child.stderr.on("data", collect((text) => (stderr += text)));
    // A CLI that exits early closes stdin; its exit code reports the real problem.
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input ?? "");

    const finish = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.on("error", (error) => {
      finish();
      reject(error);
    });
    child.on("close", (code) => {
      finish();
      if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
  });
}

async function resolveCli(engine: LocalAiEngine) {
  const pathValue = await searchPath();
  const command = findExecutable(CLI_NAMES[engine], pathValue);
  return command ? { command, env: cliEnv(pathValue) } : null;
}

export function parseClaudeStatus(stdout: string): Pick<LocalAiStatus, "signedIn" | "plan"> {
  try {
    const status = JSON.parse(stdout) as { loggedIn?: unknown; subscriptionType?: unknown };
    return {
      signedIn: status.loggedIn === true,
      plan: typeof status.subscriptionType === "string" ? status.subscriptionType : undefined,
    };
  } catch {
    return { signedIn: false };
  }
}

export function parseCodexStatus(output: string): Pick<LocalAiStatus, "signedIn" | "plan"> {
  return {
    signedIn: /logged in/i.test(output) && !/not logged in/i.test(output),
    plan: /using chatgpt/i.test(output) ? "ChatGPT" : undefined,
  };
}

async function engineStatus(engine: LocalAiEngine): Promise<LocalAiStatus> {
  const cli = await resolveCli(engine);
  if (!cli) return { engine, installed: false, signedIn: false };
  const args = engine === "claude" ? ["auth", "status", "--json"] : ["login", "status"];
  const result = await run(cli.command, args, { timeoutMs: STATUS_TIMEOUT_MS, env: cli.env }).catch(() => null);
  if (!result) return { engine, installed: true, signedIn: false };
  const parsed =
    engine === "claude"
      ? parseClaudeStatus(result.stdout)
      : parseCodexStatus(`${result.stdout}\n${result.stderr}`);
  return { engine, installed: true, ...parsed };
}

export function localAiStatus(): Promise<LocalAiStatus[]> {
  return Promise.all((["claude", "codex"] as const).map(engineStatus));
}

/** `--bare` would be simpler, but it never reads the OAuth sign-in this feature relies on. */
export function claudeArgs(schema: string, systemFile: string): string[] {
  return [
    "-p",
    "--restricted",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--model",
    CLAUDE_MODEL,
    "--output-format",
    "json",
    "--json-schema",
    schema,
    "--system-prompt-file",
    systemFile,
  ];
}

export function parseEnabledCodexFeatures(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns.length >= 2 && columns.at(-1) === "true")
    .map((columns) => columns[0]!);
}

/**
 * Codex has no way to allow-list tools, and `--sandbox read-only` still permits
 * reading any file. Turning off every enabled feature is what removes its shell,
 * code mode, web, browser, MCP and sub-agent tools, and it covers features added
 * in later versions without a change here.
 */
export function codexArgs(features: string[], schemaFile: string, outputFile: string, cwd: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    'web_search="disabled"',
    "-c",
    'approval_policy="never"',
    "-c",
    "project_doc_max_bytes=0",
    ...features.flatMap((feature) => ["--disable", feature]),
    "--output-schema",
    schemaFile,
    "-o",
    outputFile,
    "-C",
    cwd,
    "-",
  ];
}

function cliFailure(engine: LocalAiEngine, text: string): Error {
  const label = engine === "claude" ? "Claude Code" : "Codex";
  const detail = text.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300);
  return new Error(detail ? `${label}: ${detail}` : `${label} could not finish this run.`);
}

export function parseClaudeResult(stdout: string): string {
  let result: { is_error?: unknown; result?: unknown; structured_output?: unknown };
  try {
    result = JSON.parse(stdout) as typeof result;
  } catch {
    throw cliFailure("claude", stdout);
  }
  if (result.is_error === true) throw cliFailure("claude", String(result.result ?? ""));
  if (result.structured_output !== undefined) return JSON.stringify(result.structured_output);
  if (typeof result.result === "string") return result.result;
  throw cliFailure("claude", "");
}

async function runClaude(
  cli: NonNullable<Awaited<ReturnType<typeof resolveCli>>>,
  request: LocalAiRequest,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  const systemFile = path.join(cwd, "system.txt");
  await writeFile(systemFile, request.system);
  const result = await run(cli.command, claudeArgs(JSON.stringify(request.schema), systemFile), {
    cwd,
    env: cli.env,
    input: request.prompt,
    timeoutMs: RUN_TIMEOUT_MS,
    signal,
  });
  // A failed run still prints its JSON result, which holds the useful message.
  if (result.code !== 0 && !result.stdout.trim()) throw cliFailure("claude", result.stderr);
  return parseClaudeResult(result.stdout);
}

async function runCodex(
  cli: NonNullable<Awaited<ReturnType<typeof resolveCli>>>,
  request: LocalAiRequest,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  // Fail closed: without this list the tools below would stay switched on.
  const listed = await run(cli.command, ["features", "list"], { env: cli.env, timeoutMs: STATUS_TIMEOUT_MS, signal });
  const features = parseEnabledCodexFeatures(listed.stdout);
  if (listed.code !== 0 || features.length === 0) {
    throw new Error("Codex: couldn't confirm its tools were off, so nothing was sent. Update Codex and try again.");
  }

  const schemaFile = path.join(cwd, "schema.json");
  const outputFile = path.join(cwd, "answer.json");
  await writeFile(schemaFile, JSON.stringify(request.schema));
  const result = await run(cli.command, codexArgs(features, schemaFile, outputFile, cwd), {
    cwd,
    env: cli.env,
    input: `<instructions>\n${request.system}\n</instructions>\n\n${request.prompt}`,
    timeoutMs: RUN_TIMEOUT_MS,
    signal,
  });
  if (result.code !== 0) throw cliFailure("codex", result.stderr || result.stdout);
  return readFile(outputFile, "utf8");
}

export async function generateLocalAi(request: LocalAiRequest): Promise<string> {
  const cli = await resolveCli(request.engine);
  if (!cli) {
    throw new Error(`${request.engine === "claude" ? "Claude Code" : "Codex"} isn't installed on this computer.`);
  }
  const controller = new AbortController();
  running.set(request.id, controller);
  // The CLIs get a fresh, empty directory, so no project files or instructions load.
  const cwd = await mkdtemp(path.join(tmpdir(), "deephaus-ai-"));
  try {
    return await (request.engine === "claude" ? runClaude : runCodex)(cli, request, cwd, controller.signal);
  } finally {
    running.delete(request.id);
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function cancelLocalAi(id: string): void {
  running.get(id)?.abort();
}

export function cancelAllLocalAi(): void {
  for (const controller of running.values()) controller.abort();
}

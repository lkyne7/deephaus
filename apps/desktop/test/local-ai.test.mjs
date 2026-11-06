// The lockdown flags are what keep an untrusted document from reaching the
// user's files through their own agent CLI, so they are pinned here.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  claudeArgs,
  cliEnv,
  codexArgs,
  findExecutable,
  parseClaudeResult,
  parseClaudeStatus,
  parseCodexStatus,
  parseEnabledCodexFeatures,
  parseLocalAiRequest,
} = require("../dist/main/local-ai.js");

const valid = { id: "1", engine: "claude", system: "s", prompt: "p", schema: { type: "object" } };

test("claude runs with no tools, MCP servers, or user settings, and never --bare", () => {
  const args = claudeArgs("{}", "/tmp/system.txt");
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args[args.indexOf("--setting-sources") + 1], "");
  for (const flag of ["--restricted", "--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence"]) {
    assert.ok(args.includes(flag), flag);
  }
  // --bare ignores OAuth, which would break subscription sign-in.
  assert.ok(!args.includes("--bare"));
});

test("codex disables every enabled feature in a read-only sandbox", () => {
  const args = codexArgs(["shell_tool", "future_tool"], "/s.json", "/o.json", "/w");
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
  for (const flag of ["--ephemeral", "--ignore-user-config", "--ignore-rules"]) assert.ok(args.includes(flag), flag);
  const disabled = args.flatMap((arg, index) => (arg === "--disable" ? [args[index + 1]] : []));
  assert.deepEqual(disabled, ["shell_tool", "future_tool"]);
  assert.ok(!args.some((arg) => arg.includes("dangerously")));
  // Prompts travel over stdin, never as arguments.
  assert.equal(args.at(-1), "-");
});

test("reads enabled codex features and skips disabled ones", () => {
  const output = [
    "shell_tool                 stable             true",
    "memories                   stable             false",
    "code_mode_host             under development  true",
    "",
  ].join("\n");
  assert.deepEqual(parseEnabledCodexFeatures(output), ["shell_tool", "code_mode_host"]);
  assert.deepEqual(parseEnabledCodexFeatures("unexpected output"), []);
});

test("provider keys are removed so runs bill the plan, not an API account", () => {
  const env = cliEnv("/bin", {
    ANTHROPIC_API_KEY: "a",
    OPENAI_API_KEY: "b",
    CLAUDE_CODE_USE_BEDROCK: "1",
    ELECTRON_RUN_AS_NODE: "1",
    HOME: "/home/me",
  });
  assert.deepEqual(env, { HOME: "/home/me", PATH: "/bin" });
});

test("finds executables on PATH and ignores non-executable files", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dh-cli-"));
  writeFileSync(path.join(dir, "notes"), "");
  chmodSync(path.join(dir, "notes"), 0o644);
  writeFileSync(path.join(dir, "tool"), "");
  chmodSync(path.join(dir, "tool"), 0o755);
  assert.equal(findExecutable("tool", dir), path.join(dir, "tool"));
  assert.equal(findExecutable("notes", dir), null);
  assert.equal(findExecutable("missing", `${dir}${path.delimiter}`), null);
});

test("reads sign-in status without keeping account identifiers", () => {
  const claude = parseClaudeStatus(JSON.stringify({ loggedIn: true, subscriptionType: "max", email: "a@b.c" }));
  assert.deepEqual(claude, { signedIn: true, plan: "max" });
  assert.deepEqual(parseClaudeStatus("not json"), { signedIn: false });
  assert.deepEqual(parseCodexStatus("Logged in using ChatGPT"), { signedIn: true, plan: "ChatGPT" });
  assert.equal(parseCodexStatus("Not logged in").signedIn, false);
});

test("prefers structured output and surfaces CLI errors", () => {
  assert.equal(parseClaudeResult(JSON.stringify({ structured_output: { cards: [] }, result: "x" })), '{"cards":[]}');
  assert.equal(parseClaudeResult(JSON.stringify({ result: '{"cards":[]}' })), '{"cards":[]}');
  assert.throws(
    () => parseClaudeResult(JSON.stringify({ is_error: true, result: "You've hit your limit" })),
    /Claude Code: You've hit your limit/,
  );
  assert.throws(() => parseClaudeResult("oops"), /Claude Code/);
});

test("rejects malformed requests from the renderer", () => {
  assert.deepEqual(parseLocalAiRequest(valid), valid);
  assert.throws(() => parseLocalAiRequest({ ...valid, engine: "bash" }));
  assert.throws(() => parseLocalAiRequest({ ...valid, prompt: 1 }));
  assert.throws(() => parseLocalAiRequest({ ...valid, schema: null }));
  assert.throws(() => parseLocalAiRequest({ ...valid, prompt: "x".repeat(2_000_001) }));
  assert.throws(() => parseLocalAiRequest(null));
});

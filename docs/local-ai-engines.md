# Generating cards on a user's own Claude or ChatGPT plan

Status: desktop app only, from version 1.0.2. Web and mobile still use DeepHaus credits.

## Why this runs on the user's computer

The desktop app runs the `claude` and `codex` CLIs the user has already installed
and signed in to, the same way T3 Code does. DeepHaus never receives or stores a
Claude or ChatGPT credential. Do not replace this with a hosted "connect your
account" OAuth flow without checking the current terms:

- **Anthropic** does not permit third-party developers to offer Claude.ai login,
  to route requests through Free, Pro, Max or Ultra credentials on behalf of
  users, or to collect, store or intermediate Claude.ai credentials or session
  tokens. It does allow an end user to sign in to the unmodified Claude Code
  binary. [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance).
  Hosted access for Claude users would have to use their own Console API key.
- **OpenAI** has an official route, Sign in with ChatGPT with plan usage, but
  paid or remotely hosted apps need a client ID from a waitlist for selected
  commercial partners. [Request a client ID](https://developers.openai.com/siwc/request-client-id).
  If DeepHaus is accepted, ChatGPT plans could work on web and mobile too.

Keep to plain-text product names: Anthropic's names and logos need permission for
anything beyond accurately saying the product runs Claude Code. Sign-in stays a
command the user runs in a terminal, so the app offers no Claude login of its own.

## How a run works

1. Settings → Connections stores the engine per device (`deephaus.generationEngine`).
2. Generation requests carry `local_engine`. The server creates the job with no
   credit reservation and does not process it. Worker-extracted PDFs carry the
   engine through `requested_generation`.
3. Job polling sees `local_engine` and starts `runLocalGeneration`.
4. `POST /api/jobs/:id/local` hands out one chunk's prompts at a time, and saves
   each answer after the same validation, dedupe and card cap as hosted runs.
5. If a CLI is missing, signed out or out of quota, the job fails with that
   message. It never falls back to spending credits.

Source extraction, embeddings and every other AI feature stay hosted. Video
transcription and the other AI features (assistant, explain, speech and so on)
still use credits. Every plan can use this, including Basic.

## Keeping runs locked down

Source documents are untrusted and these CLIs are agents with file and shell
tools. `apps/desktop/src/main/local-ai.ts` removes them, and
`apps/desktop/test/local-ai.test.mjs` pins the flags.

- **Claude Code:** `--tools ""`, `--restricted`, `--strict-mcp-config` and no
  setting sources leave only `StructuredOutput`. Never use `--bare`: it ignores
  the OAuth sign-in.
- **Codex:** it has no tool allow-list, and `--sandbox read-only` still allows
  reading any file. Every feature `codex features list` reports as enabled is
  disabled per run, and the run is refused if that list can't be read. This left
  `request_user_input` and `apply_patch` in the request on Codex 0.166.0; an
  explicit `apply_patch` attempt failed and wrote nothing.
- **Both:** no shell, prompts over stdin, a fresh empty working directory, and
  provider API keys removed from the environment so usage bills the plan.

After a Codex upgrade, re-check the tool list. Point `model_providers` at a local
fake `/v1/responses` server and read the `tools` array in the request. What the
model says about its own tools is not reliable.

## Known limits

- Windows only finds real `.exe` files. npm's `.cmd` shims would need a shell, so
  they show as not installed. Windows and Linux are untested.
- Chunks run one at a time, so long books are slower than hosted runs.
- Closing the app mid-run leaves the job to time out after 15 minutes. Cards
  saved so far stay in the deck.
- When a run reaches the card cap it stops at that chunk, so later chunks aren't
  sampled the way hosted runs are.

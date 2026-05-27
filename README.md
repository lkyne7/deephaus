# DeepHaus

**DeepHaus** turns study material (notes, PDFs) into Anki flashcards and exports `.apkg` files for desktop Anki and AnkiMobile.

Repository: [github.com/lkyne7/deephaus](https://github.com/lkyne7/deephaus)

## Stack

- **Web:** Next.js 15 (App Router)
- **Mobile:** Expo (React Native)
- **Monorepo:** pnpm + Turborepo
- **Backend:** Supabase (auth, Postgres, storage)
- **Export:** [ankipack](https://github.com/ImGajeed76/ankipack) (Basic + Cloze)
- **LLM:** OpenAI structured output

## Project structure

```
apps/web          Next.js UI + API routes
apps/mobile       Expo mobile app
packages/shared   Schemas, chunking, deduplication
packages/apkg     .apkg builder + sample CLI
packages/llm      Card generation prompts + OpenAI client
packages/api-client Typed API client for web + mobile
supabase/         Database migrations
```

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Run the migration in `supabase/migrations/20250524000000_init.sql`
3. Create a private storage bucket named `pdfs`
4. Copy `.env.example` to `apps/web/.env.local` and fill in keys

### 3. Supabase Auth (email + password)

DeepHaus uses **Supabase Auth** for sign-in. No Auth0 or magic links required.

1. Supabase Dashboard → [**Authentication → Providers → Email**](https://supabase.com/dashboard/project/rdfijwmxlyvykcnxfurd/auth/providers)
   - Ensure **Email** is enabled
   - For local dev, turn **off** “Confirm email” so you can sign in immediately after creating an account

2. Supabase Dashboard → [**Authentication → URL Configuration**](https://supabase.com/dashboard/project/rdfijwmxlyvykcnxfurd/auth/url-configuration)
   - **Site URL:** `http://localhost:3000`

3. In the app: open [http://localhost:3000](http://localhost:3000) → **Create account** → sign in → **Projects**

### 4. Run web app

```bash
cp .env.example apps/web/.env.local
# Set DEEPHAUS_USE_MOCK_LLM=true to test without OpenAI

pnpm --filter @deephaus/web dev
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Run mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
# EXPO_PUBLIC_API_BASE_URL (your machine LAN IP for physical device testing)

pnpm dev:mobile
# or: pnpm mobile:ios / pnpm mobile:android
```

**Supabase Auth for mobile:** In Supabase Dashboard → Authentication → URL Configuration, add redirect URL `deephaus://auth/callback`. The app supports email/password and magic links.

**Physical device testing:** Run the web API (`pnpm dev:web`) and set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN IP (e.g. `http://192.168.1.10:3000`), not `localhost`.

### 6. Export sample deck (CLI)

```bash
pnpm --filter @deephaus/apkg build
pnpm --filter @deephaus/apkg export-sample
```

## Text → flashcards API

**One-shot (recommended):**

```http
POST /api/generate/text
Content-Type: application/json
Cookie: <supabase session cookie>

{
  "project_id": "uuid",
  "text": "Your study notes here…",
  "settings": {
    "cardMix": "both",
    "density": 5,
    "focusPrompt": "exam prep"
  }
}
```

Response (`201`):

```json
{
  "source": { "id": "…", "type": "text", "raw_text": "…" },
  "job": { "id": "…", "status": "ready", "progress": 100 },
  "cards": [ { "type": "basic", "front": "…", "back": "…" } ],
  "mock": false
}
```

**Multi-step (also used for PDFs):**

1. `POST /api/sources/text` — store text
2. `POST /api/generate` — generate cards from `source_id`
3. `GET /api/cards?job_id=…` — fetch cards

### Enable real AI cards

In `apps/web/.env.local`:

```bash
OPENAI_API_KEY=sk-your-key
DEEPHAUS_USE_MOCK_LLM=false
```

Without an OpenAI key, the API returns **sample mock cards** for testing.

## MVP features

- Paste text or upload PDF → LLM generates Basic/Cloze cards
- Review and edit cards before export
- Download/share `.apkg` for Anki import
- Async generation with job status polling
- Same API used by web and mobile

## Phase 2 (planned)

- PowerPoint, video, and audio ingestion
- OCR for scanned PDFs
- AnKing-style card templates

## License

MIT

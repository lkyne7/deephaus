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

### 3. Supabase Auth (email, Google, and Apple)

DeepHaus uses **Supabase Auth** on web and mobile. Email/password and mobile
magic links work without another identity service.

1. Supabase Dashboard → [**Authentication → Providers → Email**](https://supabase.com/dashboard/project/rdfijwmxlyvykcnxfurd/auth/providers)
   - Ensure **Email** is enabled
   - For local dev, turn **off** “Confirm email” so you can sign in immediately after creating an account

2. Supabase Dashboard → [**Authentication → URL Configuration**](https://supabase.com/dashboard/project/rdfijwmxlyvykcnxfurd/auth/url-configuration)
   - **Site URL:** `http://localhost:3000`
   - Add `http://localhost:3000/auth/callback`
   - Add `https://www.deephaus.ai/auth/callback`
   - Add `deephaus://auth/callback` for Expo builds

3. To enable Google sign-in, create a Google OAuth web client whose redirect URI
   is `https://<your-project-ref>.supabase.co/auth/v1/callback`, then enable and
   configure Google in Supabase Authentication → Providers.

4. To enable Apple sign-in, create an Apple Services ID and Sign in with Apple
   key. Add the Supabase callback URL to the Services ID, then enter the Services
   ID, Team ID, Key ID, and private key in Supabase Authentication → Providers.

Google sign-in credentials are separate from the Google Drive credentials below.
Supabase automatically links identities when providers return the same verified
email address.

### University verification email

Profile affiliations use a six-digit code sent through Resend. Verify a sending
domain in Resend, then configure these server-only variables:

```bash
RESEND_API_KEY=re_...
UNIVERSITY_VERIFICATION_FROM_EMAIL=DeepHaus <verify@your-domain.com>
```

Recognized institutions come from the bundled JetBrains `swot` domain registry.
Alumni, abused, and unknown domains are rejected.

### 4. Google Drive imports (optional)

Create a Google Cloud project and enable both **Google Drive API** and
**Google Picker API**. Configure an OAuth 2.0 Web application with:

- Authorized JavaScript origins: `http://localhost:3000` and the production app origin
- Authorized redirect URIs:
  - `http://localhost:3000/api/google-drive/callback`
  - `https://www.deephaus.ai/api/google-drive/callback`

Create a browser API key restricted to those origins and to Google Picker API.
The app requests the least-privilege `drive.file` scope, so it can only read
files users explicitly select in Picker.

Set these variables in `apps/web/.env.local` and in the Vercel web project:

```bash
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google-drive/callback
NEXT_PUBLIC_GOOGLE_API_KEY=
# Numeric Google Cloud project number (used by PickerBuilder.setAppId)
NEXT_PUBLIC_GOOGLE_APP_ID=
```

Use the production callback URL for `GOOGLE_REDIRECT_URI` in production.
Drive imports support Google Docs, Slides, and Sheets, plus PDF, DOCX, PPTX,
and XLSX files. Native Google files are exported as Office documents before
text extraction. Website URL imports require no additional configuration.

### 5. Run web app

```bash
cp .env.example apps/web/.env.local
# Set DEEPHAUS_USE_MOCK_LLM=true to test without OpenAI

pnpm --filter @deephaus/web dev
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Run mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
# Set EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
# EXPO_PUBLIC_API_BASE_URL (your machine LAN IP for physical device testing)

pnpm dev:mobile
# or: pnpm mobile:ios / pnpm mobile:android
```

**Supabase Auth for mobile:** In Supabase Dashboard → Authentication → URL Configuration, add redirect URL `deephaus://auth/callback`. The app supports email/password and magic links.

**Physical device testing:** Run the web API (`pnpm dev:web`) and set `EXPO_PUBLIC_API_BASE_URL` to your machine's LAN IP (e.g. `http://192.168.1.10:3000`), not `localhost`.

### 7. Export sample deck (CLI)

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

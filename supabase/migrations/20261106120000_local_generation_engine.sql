-- Generation that runs on the user's own Claude or ChatGPT plan through the
-- desktop app. The server never processes these jobs and reserves no credits;
-- the desktop app fetches prompts and returns model output step by step.
alter table public.generation_jobs
  add column if not exists local_engine text
    check (local_engine in ('claude', 'codex')),
  add column if not exists local_scope jsonb;

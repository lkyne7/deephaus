import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { vector } from '@electric-sql/pglite-pgvector';
import { readdir, readFile } from 'node:fs/promises';

// Only Supabase-owned infrastructure is represented here. Every application
// migration executes verbatim, including functions, policies and triggers.
export async function fullSchema() {
  const db = new PGlite({ extensions: { pgcrypto, vector } });
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      set search_path=public,extensions;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', created_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb);
      alter table storage.objects enable row level security;
      grant all on storage.objects to anon, authenticated, service_role;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    `);
    const directory = new URL('../../supabase/migrations/', import.meta.url);
    const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations) {
      try { await db.exec(await readFile(new URL(name, directory), 'utf8')); }
      catch (cause) { throw new Error(`Migration ${name}: ${cause.message}`, { cause }); }
    }
    return { db, migrations };
  } catch (error) { await db.close(); throw error; }
}

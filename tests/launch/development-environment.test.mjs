import { test } from 'node:test';
import assert from 'node:assert/strict';
import { developmentEnvironment, STAGING_URL } from '../../scripts/environments/development.mjs';

const config = { NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture' };
test('local web cannot inherit production services or secrets', () => {
  const env = developmentEnvironment(config, { HOME: '/tmp/home', OPENAI_API_KEY: 'production-secret', SUPABASE_URL: 'https://production.invalid', NEXT_PUBLIC_POWERSYNC_URL: 'https://production.invalid' }, ['OPENAI_API_KEY', 'GOOGLE_CLIENT_SECRET']);
  assert.equal(env.SUPABASE_URL, STAGING_URL);
  assert.equal(env.OPENAI_API_KEY, '');
  assert.equal(env.GOOGLE_CLIENT_SECRET, '');
  assert.equal(env.NEXT_PUBLIC_POWERSYNC_URL, '');
  assert.equal(env.DEEPHAUS_USE_MOCK_LLM, 'true');
  assert.equal(env.APP_BASE_URL, 'http://localhost:3000');
  assert.equal(env.HOME, '/tmp/home');
});
test('mobile receives only public staging settings and disables dotenv loading', () => {
  const env = developmentEnvironment({ ...config, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture', OPENAI_API_KEY: 'secret' }, { REVENUECAT_SECRET_API_KEY: 'secret' }, ['SUPABASE_SERVICE_ROLE_KEY'], true);
  assert.equal(env.APP_VARIANT, 'staging');
  assert.equal(env.EXPO_NO_DOTENV, '1');
  assert.equal(env.EXPO_PUBLIC_SUPABASE_URL, STAGING_URL);
  assert.equal(env.EXPO_PUBLIC_API_BASE_URL, 'http://localhost:3000');
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'REVENUECAT_SECRET_API_KEY']) assert.equal(key in env, false);
});
test('development rejects production and missing public settings', () => {
  assert.throws(() => developmentEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_URL: 'https://rdfijwmxlyvykcnxfurd.supabase.co' }), /staging Supabase/);
  assert.throws(() => developmentEnvironment({}), /staging Supabase/);
});
test('development rejects a production service-role JWT', () => {
  const key = 'ey.' + Buffer.from(JSON.stringify({ ref: 'rdfijwmxlyvykcnxfurd', role: 'service_role' })).toString('base64url') + '.sig';
  assert.throws(() => developmentEnvironment({ ...config, SUPABASE_SERVICE_ROLE_KEY: key }), /staging service-role/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedStagingEnvironments, STAGING_SUPABASE_URL } from '../../scripts/launch/hosted-staging-env.mjs';

const config = {
  NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  REVENUECAT_SECRET_API_KEY: 'subscriber_fixture',
  REVENUECAT_WEBHOOK_SECRET: 'webhook_fixture',
  LAUNCH_BILLING_ENABLED: 'true', LAUNCH_REVENUECAT_WEB_SANDBOX_KEY: 'strp_sb_fixture',
  LAUNCH_REVENUECAT_APPLE_KEY: 'appl_fixture',
  LAUNCH_POWERSYNC_ENABLED: 'true', LAUNCH_OFFLINE_MEDIA_ENABLED: 'true',
};
test('isolates server credentials and excludes unrelated production and fixture values', () => {
  const result = hostedStagingEnvironments({...config, OPENAI_API_KEY:'production_secret', E2E_PASSWORD:'fixture_secret'}, 'https://staging.example.com');
  assert.equal(result.web.REVENUECAT_ALLOW_SANDBOX_ENTITLEMENTS, 'true');
  assert.equal(result.web.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_fixture');
  assert.equal(result.mobile.EXPO_PUBLIC_API_BASE_URL, 'https://staging.example.com');
  assert.equal(Object.keys(result.mobile).every(key => key.startsWith('EXPO_PUBLIC_')), true);
  for (const value of ['production_secret','fixture_secret']) assert.equal(JSON.stringify(result).includes(value), false);
  for (const value of ['sb_secret_fixture','subscriber_fixture','webhook_fixture']) assert.equal(JSON.stringify(result.mobile).includes(value), false);
});
test('rejects production Supabase configuration and a mismatched legacy server key', () => {
  assert.throws(() => hostedStagingEnvironments({...config, NEXT_PUBLIC_SUPABASE_URL:'https://production.supabase.co'}, 'https://staging.example.com'));
  const key = 'ey.'+Buffer.from(JSON.stringify({ref:'production',role:'service_role'})).toString('base64url')+'.sig';
  assert.throws(() => hostedStagingEnvironments({...config, SUPABASE_SERVICE_ROLE_KEY:key}, 'https://staging.example.com'));
});
test('rejects local, non-HTTPS and path-specific endpoints', () => {
  for (const url of ['http://localhost:3100', 'https://127.0.0.1','https://mac.local','https://x.localhost','https://[::1]','https://user:pass@example.com','https://example.com/revenuecat']) {
    assert.throws(() => hostedStagingEnvironments(config, url));
  }
});
test('rejects disabled billing, missing webhook secret, and non-Apple native key', () => {
  for (const overrides of [{LAUNCH_BILLING_ENABLED:'false'},{REVENUECAT_WEBHOOK_SECRET:''},{LAUNCH_REVENUECAT_APPLE_KEY:'test_fixture'}]) {
    assert.throws(() => hostedStagingEnvironments({...config,...overrides}, 'https://staging.example.com'));
  }
});

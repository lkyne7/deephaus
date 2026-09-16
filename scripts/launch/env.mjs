import { readFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stagingOfflineSettings } from './offline-config.mjs';
import { stagingBillingSettings, storekitBillingKey } from './billing-config.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function stagingEnv({ requireSecret = true, networkOnly = false } = {}) {
  const config = path.join(root, '.env.launch-staging.local');
  const env = { ...process.env };
  // Prevent Next from silently filling absent staging credentials with values
  // from the developer's production-backed .env.local files.
  for (const file of ['apps/web/.env.local', 'apps/web/.env.development.local', 'apps/web/.env.production.local']) {
    const name = path.join(root, file);
    if (existsSync(name)) for (const key of Object.keys(parseEnv(readFileSync(name, 'utf8')))) env[key] = '';
  }
  const launchConfig = existsSync(config) ? parseEnv(readFileSync(config, 'utf8')) : {};
  Object.assign(env, launchConfig);
  const fixtures = path.join(root, '.env.launch-fixtures.local');
  if (existsSync(fixtures)) Object.assign(env, parseEnv(readFileSync(fixtures, 'utf8')));
  const expected = 'https://cktvxmclcxtymkozciaw.supabase.co';
  if (env.NEXT_PUBLIC_SUPABASE_URL !== expected) throw new Error('Launch runner requires the dedicated launch-staging Supabase URL.');
  if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error('Configure the staging publishable key in .env.launch-staging.local.');
  if (requireSecret && !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure the staging service-role key in .env.launch-staging.local.');
  // Reject a legacy JWT key from a different project before making any request.
  if (env.SUPABASE_SERVICE_ROLE_KEY?.startsWith('ey')) {
    const payload = JSON.parse(Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString());
    if (payload.ref !== 'cktvxmclcxtymkozciaw' || payload.role !== 'service_role') throw new Error('Server key does not belong to the staging project.');
  }
  env.DEEPHAUS_LAUNCH_ENV = 'staging';
  env.DEEPHAUS_LAUNCH_NETWORK_ONLY = networkOnly ? '1' : '';
  env.E2E_BASE_URL = networkOnly ? 'http://localhost:3101' : 'http://localhost:3100';
  env.E2E_SUPABASE_URL = expected;
  env.E2E_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  env.NEXT_PUBLIC_APP_URL = env.E2E_BASE_URL;
  env.APP_BASE_URL = env.E2E_BASE_URL;
  env.NEXT_PUBLIC_RELEASE_ID = 'launch-staging-local';
  const offline = stagingOfflineSettings(networkOnly ? {} : launchConfig);
  env.NEXT_PUBLIC_POWERSYNC_URL = offline.url;
  env.NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED = offline.media;
  const billing = stagingBillingSettings(launchConfig);
  env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = billing.webKey;
  env.REVENUECAT_ALLOW_SANDBOX_ENTITLEMENTS = billing.allowSandbox;
  return env;
}

/** Only public staging settings enter the native bundler. Never inherit server secrets. */
export function nativeStagingEnv({ storekit = false } = {}) {
  const staging = stagingEnv({ requireSecret: false });
  const systemKeys = new Set(['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'COLORTERM', 'DEVELOPER_DIR', 'SDKROOT', 'NODE_BINARY', 'JAVA_HOME', 'CI']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => systemKeys.has(key)));
  return {
    ...env,
    EXPO_NO_DOTENV: '1',
    REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1',
    APP_VARIANT: 'staging',
    EXPO_PUBLIC_SUPABASE_URL: staging.NEXT_PUBLIC_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: staging.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3100',
    EXPO_PUBLIC_POWERSYNC_URL: staging.NEXT_PUBLIC_POWERSYNC_URL,
    EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED: staging.NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED,
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: storekit ? storekitBillingKey(
      parseEnv(readFileSync(path.join(root, '.env.launch-staging.local'), 'utf8')),
    ) : stagingBillingSettings(
      parseEnv(readFileSync(path.join(root, '.env.launch-staging.local'), 'utf8')),
    ).nativeKey,
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: '',
    EXPO_PUBLIC_POSTHOG_API_KEY: '',
    EXPO_PUBLIC_RELEASE_ID: 'launch-staging-simulator',
  };
}

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import config from '../app.config';

beforeEach(() => {
  vi.stubEnv('APP_VARIANT', 'staging');
  vi.stubEnv('DEEPHAUS_STORE_BUILD', '1');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'https://cktvxmclcxtymkozciaw.supabase.co');
  vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_fixture');
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'https://staging.example.com');
  vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'appl_fixture');
});
afterEach(() => vi.unstubAllEnvs());
it('creates a separate staging identity for TestFlight', () => {
  expect(config().ios?.bundleIdentifier).toBe('com.deephaus.app.staging');
});
it.each(['http://localhost:3100', 'https://127.0.0.1', 'https://192.168.1.5', 'https://[::1]', 'https://mac.local', 'https://user:pass@example.com'])(
  'rejects an unsuitable store API URL: %s', (url) => {
    vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', url);
    expect(() => config()).toThrow('public HTTPS');
  },
);
it.each(['test_fixture', 'sk_fixture', ''])('rejects non-Apple billing key %s', (key) => {
  vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', key);
  expect(() => config()).toThrow('Apple RevenueCat');
});
it('keeps local simulator builds available', () => {
  vi.stubEnv('DEEPHAUS_STORE_BUILD', '');
  vi.stubEnv('EXPO_PUBLIC_API_BASE_URL', 'http://localhost:3100');
  vi.stubEnv('EXPO_PUBLIC_REVENUECAT_IOS_API_KEY', 'test_fixture');
  expect(config().ios?.bundleIdentifier).toBe('com.deephaus.app.staging');
});

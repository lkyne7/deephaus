import { stagingOfflineSettings } from '../launch/offline-config.mjs';
import { stagingBillingSettings } from '../launch/billing-config.mjs';

export const STAGING_URL = 'https://cktvxmclcxtymkozciaw.supabase.co';
const systemKeys = ['PATH', 'HOME', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TERM', 'DEVELOPER_DIR', 'SDKROOT', 'JAVA_HOME', 'CI'];

export function developmentEnvironment(config, inherited = {}, dotenvKeys = [], mobile = false) {
  if (config.NEXT_PUBLIC_SUPABASE_URL !== STAGING_URL || !config.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Configure the staging Supabase URL and public key in .env.launch-staging.local.');
  }
  if (config.SUPABASE_SERVICE_ROLE_KEY?.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(config.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString());
    if (claims.ref !== 'cktvxmclcxtymkozciaw' || claims.role !== 'service_role') throw new Error('Development requires the staging service-role key.');
  }
  const env = Object.fromEntries(systemKeys.filter(key => inherited[key] !== undefined).map(key => [key, inherited[key]]));
  const offline = stagingOfflineSettings(config);
  const billing = stagingBillingSettings(config);
  if (mobile) return {
    ...env, EXPO_NO_DOTENV: '1', APP_VARIANT: 'staging',
    EXPO_PUBLIC_SUPABASE_URL: STAGING_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_API_BASE_URL: 'http://localhost:3000',
    EXPO_PUBLIC_POWERSYNC_URL: offline.url,
    EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED: offline.media,
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: billing.nativeKey,
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY: '',
    EXPO_PUBLIC_POSTHOG_API_KEY: '',
    EXPO_PUBLIC_RELEASE_ID: 'development-staging',
  };
  // Empty values prevent Next/dotenv from filling missing keys from old production files.
  for (const key of dotenvKeys) env[key] = '';
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'MISTRAL_API_KEY', 'EXTRACTION_WORKER_SECRET']) {
    env[key] = config[key] ?? '';
  }
  return {
    ...env, NEXT_PUBLIC_SUPABASE_URL: STAGING_URL, SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000', APP_BASE_URL: 'http://localhost:3000',
    NEXT_PUBLIC_POWERSYNC_URL: offline.url, NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED: offline.media,
    NEXT_PUBLIC_REVENUECAT_WEB_API_KEY: billing.webKey,
    REVENUECAT_ALLOW_SANDBOX_ENTITLEMENTS: billing.allowSandbox,
    DEEPHAUS_USE_MOCK_LLM: config.OPENAI_API_KEY ? 'false' : 'true',
    NEXT_PUBLIC_RELEASE_ID: 'development-staging',
  };
}

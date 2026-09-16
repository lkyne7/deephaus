import { stagingBillingSettings, storekitBillingKey } from './billing-config.mjs';
import { stagingOfflineSettings } from './offline-config.mjs';

export const STAGING_SUPABASE_URL = 'https://cktvxmclcxtymkozciaw.supabase.co';

export function hostedStagingEnvironments(config, origin) {
  const api = new URL(origin);
  if (api.protocol !== 'https:' || api.username || api.password || api.pathname !== '/' || api.search || api.hash || !api.hostname.includes('.') || api.hostname.endsWith('.local') || api.hostname.endsWith('.localhost') || /^\d+(\.\d+){3}$/.test(api.hostname)) {
    throw new Error('Use a public HTTPS staging origin, without a path or credentials.');
  }
  if (config.NEXT_PUBLIC_SUPABASE_URL !== STAGING_SUPABASE_URL) throw new Error('Dedicated staging Supabase project required.');
  for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'REVENUECAT_SECRET_API_KEY', 'REVENUECAT_WEBHOOK_SECRET']) {
    if (!config[key]?.trim()) throw new Error(`Missing staging ${key}.`);
  }
  if (config.SUPABASE_SERVICE_ROLE_KEY.startsWith('ey')) {
    const claims = JSON.parse(Buffer.from(config.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url').toString());
    if (claims.ref !== 'cktvxmclcxtymkozciaw' || claims.role !== 'service_role') throw new Error('Server key is not a staging service-role key.');
  }
  const billing = stagingBillingSettings(config);
  if (billing.allowSandbox !== 'true') throw new Error('Enable sandbox billing before TestFlight.');
  const offline = stagingOfflineSettings(config);
  // Explicit allowlists: never forward process.env or the complete local config.
  const web = {
    NEXT_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.SUPABASE_SERVICE_ROLE_KEY,
    REVENUECAT_SECRET_API_KEY: config.REVENUECAT_SECRET_API_KEY,
    REVENUECAT_WEBHOOK_SECRET: config.REVENUECAT_WEBHOOK_SECRET,
    REVENUECAT_ALLOW_SANDBOX_ENTITLEMENTS: 'true',
    NEXT_PUBLIC_REVENUECAT_WEB_API_KEY: billing.webKey,
    NEXT_PUBLIC_POWERSYNC_URL: offline.url,
    NEXT_PUBLIC_OFFLINE_MEDIA_ENABLED: offline.media,
    NEXT_PUBLIC_APP_URL: api.origin,
    APP_BASE_URL: api.origin,
    NEXT_PUBLIC_RELEASE_ID: 'launch-staging-testflight',
  };
  const mobile = {
    EXPO_PUBLIC_API_BASE_URL: api.origin,
    EXPO_PUBLIC_SUPABASE_URL: STAGING_SUPABASE_URL,
    EXPO_PUBLIC_SUPABASE_ANON_KEY: config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    EXPO_PUBLIC_POWERSYNC_URL: offline.url,
    EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED: offline.media,
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY: storekitBillingKey(config),
    EXPO_PUBLIC_RELEASE_ID: 'launch-staging-testflight',
  };
  return { web, mobile };
}

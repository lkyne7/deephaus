/** Explicit sandbox-only billing settings; never inherit developer/live keys. */
export function stagingBillingSettings(config) {
  const enabled = config.LAUNCH_BILLING_ENABLED;
  if (enabled !== undefined && !['true', 'false'].includes(enabled))
    throw new Error('LAUNCH_BILLING_ENABLED must be true or false.');
  if (enabled !== 'true') return { webKey: '', nativeKey: '', allowSandbox: 'false' };
  const webKey = config.LAUNCH_REVENUECAT_WEB_SANDBOX_KEY?.trim() ?? '';
  const nativeKey = config.LAUNCH_REVENUECAT_TEST_STORE_KEY?.trim() ?? '';
  if (webKey && !/^(rcb_sb_|strp_sb_|test_)[A-Za-z0-9]+$/.test(webKey))
    throw new Error('Staging web billing requires a RevenueCat sandbox or Test Store key.');
  if (nativeKey && !/^test_[A-Za-z0-9]+$/.test(nativeKey))
    throw new Error('Simulator billing requires a RevenueCat Test Store key.');
  if (!webKey && !nativeKey) throw new Error('Configure at least one staging billing key.');
  return { webKey, nativeKey, allowSandbox: 'true' };
}

/** Apple SDK keys do not encode an environment. Only the separate simulator runner uses this. */
export function storekitBillingKey(config) {
  if (config.LAUNCH_BILLING_ENABLED !== 'true') throw new Error('Enable staging billing before StoreKit testing.');
  const key = config.LAUNCH_REVENUECAT_APPLE_KEY?.trim() ?? '';
  if (!/^appl_[A-Za-z0-9]+$/.test(key))
    throw new Error('Configure the public key from DeepHaus Staging (StoreKit) as LAUNCH_REVENUECAT_APPLE_KEY.');
  return key;
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagingBillingSettings, storekitBillingKey } from '../../scripts/launch/billing-config.mjs';

test('billing stays disabled without an explicit staging opt-in', () => {
  assert.deepEqual(stagingBillingSettings({NEXT_PUBLIC_REVENUECAT_WEB_API_KEY:'rcb_live'}),
    {webKey:'',nativeKey:'',allowSandbox:'false'});
});
test('Apple keys require the separate opted-in StoreKit runner', () => {
  assert.equal(storekitBillingKey({LAUNCH_BILLING_ENABLED:'true', LAUNCH_REVENUECAT_APPLE_KEY:'appl_fixture'}), 'appl_fixture');
  for (const config of [{}, {LAUNCH_REVENUECAT_APPLE_KEY:'appl_fixture'},
    {LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_APPLE_KEY:'test_fixture'},
    {LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_APPLE_KEY:'sk_live_fixture'}])
    assert.throws(() => storekitBillingKey(config));
  assert.equal(stagingBillingSettings({LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_APPLE_KEY:'appl_fixture',LAUNCH_REVENUECAT_TEST_STORE_KEY:'test_fixture'}).nativeKey,'test_fixture');
});
test('enables independent web sandbox and simulator Test Store keys', () => {
  assert.deepEqual(stagingBillingSettings({LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_WEB_SANDBOX_KEY:'rcb_sb_fixture',LAUNCH_REVENUECAT_TEST_STORE_KEY:'test_fixture'}),
    {webKey:'rcb_sb_fixture',nativeKey:'test_fixture',allowSandbox:'true'});
});
test('accepts Test Store on the web for integration testing', () => {
  assert.equal(stagingBillingSettings({LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_WEB_SANDBOX_KEY:'test_fixture'}).webKey,'test_fixture');
});
test('accepts the existing Stripe Billing sandbox while rejecting its live key', () => {
  assert.equal(stagingBillingSettings({LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_WEB_SANDBOX_KEY:'strp_sb_fixture'}).webKey,'strp_sb_fixture');
  assert.throws(() => stagingBillingSettings({LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_WEB_SANDBOX_KEY:'strp_live'}));
});
test('rejects live keys, missing keys, and malformed opt-ins', () => {
  for (const config of [
    {LAUNCH_BILLING_ENABLED:'yes'},
    {LAUNCH_BILLING_ENABLED:'true'},
    {LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_WEB_SANDBOX_KEY:'rcb_live'},
    {LAUNCH_BILLING_ENABLED:'true',LAUNCH_REVENUECAT_TEST_STORE_KEY:'appl_live'},
  ]) assert.throws(() => stagingBillingSettings(config));
});

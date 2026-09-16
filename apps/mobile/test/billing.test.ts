import { beforeEach, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  configure: vi.fn(), logIn: vi.fn(), logOut: vi.fn(),
  getOfferings: vi.fn(), getCustomerInfo: vi.fn(),
  purchasePackage: vi.fn(), restorePurchases: vi.fn(),
}));
vi.mock('expo-constants', () => ({ default: {
  appOwnership: 'standalone', expoConfig: { extra: { revenueCatIosApiKey: 'test_fixture' } },
} }));
vi.mock('expo-linking', () => ({ canOpenURL: vi.fn(), openURL: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('react-native-purchases', () => ({ default: sdk }));

beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });

function catalog() {
  const all = Object.fromEntries(['plus', 'pro'].map(plan => {
    const packages = ['monthly', 'annual'].map(period => ({
      identifier: `${plan}_${period}`, packageType: period === 'monthly' ? 'MONTHLY' : 'ANNUAL',
      product: { identifier: `deephaus_${plan}_${period}`, priceString: '$9.99', pricePerMonthString: '$9.99' },
    }));
    return [plan, { identifier: plan, monthly: packages[0], annual: packages[1], availablePackages: packages }];
  }));
  return { all, current: all.plus };
}

it.each([
  ['plus', 'monthly'], ['plus', 'annual'], ['pro', 'monthly'], ['pro', 'annual'],
] as const)('purchases the exact %s %s package and returns its customer state', async (plan, period) => {
  const billing = await import('../lib/billing');
  sdk.getOfferings.mockResolvedValue(catalog());
  const customerInfo = { entitlements: { active: { [plan]: {} } } };
  sdk.purchasePackage.mockResolvedValue({ customerInfo });
  await billing.configureBilling('account-a');
  expect(await billing.purchaseSubscription(plan, period)).toBe(customerInfo);
  expect(sdk.purchasePackage).toHaveBeenCalledWith(expect.objectContaining({ identifier: `${plan}_${period}` }));
});

it('does not purchase a different plan when the requested package is missing', async () => {
  const billing = await import('../lib/billing');
  const offerings = catalog(); delete offerings.all.pro;
  sdk.getOfferings.mockResolvedValue(offerings);
  await billing.configureBilling('account-a');
  await expect(billing.purchaseSubscription('pro', 'annual')).rejects.toThrow('not available');
  expect(sdk.purchasePackage).not.toHaveBeenCalled();
});

it('restores through the store SDK and propagates failure for retry', async () => {
  const billing = await import('../lib/billing');
  await billing.configureBilling('account-a');
  const info = { entitlements: { active: {} } };
  sdk.restorePurchases.mockResolvedValueOnce(info).mockRejectedValueOnce(new Error('Store unavailable'));
  expect(await billing.restoreBillingPurchases()).toBe(info);
  await expect(billing.restoreBillingPurchases()).rejects.toThrow('Store unavailable');
});

it('preserves purchase cancellation and failure without reporting success', async () => {
  const billing = await import('../lib/billing');
  await billing.configureBilling('account-a');
  sdk.getOfferings.mockResolvedValue(catalog());
  const cancelled = { userCancelled: true, code: '1' };
  sdk.purchasePackage.mockRejectedValueOnce(cancelled).mockRejectedValueOnce(new Error('Payment declined'));
  await expect(billing.purchaseSubscription('plus', 'monthly')).rejects.toBe(cancelled);
  expect(billing.isPurchaseCancelled(cancelled)).toBe(true);
  await expect(billing.purchaseSubscription('plus', 'monthly')).rejects.toThrow('Payment declined');
  expect(billing.isPurchaseCancelled(new Error('Payment declined'))).toBe(false);
});

it('serializes account configuration and signs back into the selected billing identity', async () => {
  const billing = await import('../lib/billing');
  await Promise.all([billing.configureBilling('account-a'), billing.configureBilling('account-b')]);
  expect(sdk.configure).toHaveBeenCalledWith({ apiKey: 'test_fixture', appUserID: 'account-a' });
  expect(sdk.logIn).toHaveBeenCalledWith('account-b');
  await billing.logOutBilling();
  await billing.configureBilling('account-a');
  expect(sdk.logOut).toHaveBeenCalledTimes(1);
  expect(sdk.logIn).toHaveBeenLastCalledWith('account-a');
});

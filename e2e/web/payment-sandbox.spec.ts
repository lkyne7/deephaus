import {test, expect} from '@playwright/test';
import {signIn} from './fixtures';

test('sandbox checkout rejects a declined card and completes a test purchase', async ({page}) => {
  test.setTimeout(120000);
  page.on('response',async response=>{
    if(response.url().startsWith('https://api.revenuecat.com/') && response.status()>=400)
      console.log('PROVIDER_ERROR', response.status(), new URL(response.url()).pathname);
  });
  test.skip(process.env.LAUNCH_PAYMENT_TESTS !== '1', 'Requires the explicit payment test runner.');
  expect(process.env.E2E_BASE_URL).toBe('http://localhost:3100');
  await signIn(page);
  const baseline = await (await page.request.get('/api/billing/status')).json();
  expect(baseline.plan, 'Use a Basic staging payment fixture before running purchases').toBe('basic');
  await page.goto('/dashboard?settings=billing');
  await expect(page.getByRole('button',{name:'Restore purchases',exact:true})).toBeEnabled({timeout:30000});
  await expect(page.getByRole('button',{name:'Choose',exact:true})).toHaveCount(4);
  for(const button of await page.getByRole('button',{name:'Choose',exact:true}).all())
    await expect(button).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Choose',exact:true}).first().click();
  const checkout = page;
  await checkout.waitForLoadState('domcontentloaded');
  await expect(checkout.getByText('Something went wrong',{exact:true})).toHaveCount(0);
  await expect(checkout.getByText('SANDBOX',{exact:true})).toBeVisible();

  await expect.poll(async()=>{
    for(const frame of checkout.frames()) if(await frame.getByRole('button',{name:'Subscribe',exact:true}).isVisible().catch(()=>false)) return true;
    return false;
  },{timeout:30000}).toBe(true);
  const paymentFrame = (await Promise.all(checkout.frames().map(async frame =>
    await frame.getByRole('button',{name:'Subscribe',exact:true}).isVisible().catch(()=>false) ? frame : null))).find(Boolean)!;
  await expect(paymentFrame.getByText('Test Mode',{exact:true})).toBeVisible();
  await paymentFrame.getByRole('textbox',{name:'Card number',exact:true}).fill('4000000000000002');
  await paymentFrame.getByRole('textbox',{name:'Expiration',exact:true}).fill('1230');
  await paymentFrame.getByRole('textbox',{name:'Credit or debit card CVC/CVV',exact:true}).fill('123');
  await paymentFrame.getByRole('textbox',{name:'Cardholder name',exact:true}).fill('DeepHaus Sandbox');
  await paymentFrame.getByRole('button',{name:'Subscribe',exact:true}).click();
  await expect(paymentFrame.getByText(/card was declined/i)).toBeVisible({timeout:30000});
  expect((await (await page.request.get('/api/billing/status')).json()).plan).toBe('basic');
  await paymentFrame.getByRole('textbox',{name:'Card number',exact:true}).fill('4242424242424242');
  await paymentFrame.getByRole('button',{name:'Subscribe',exact:true}).click();
  await expect.poll(async()=>{
    const result=await page.request.get('/api/billing/status');
    return result.ok() ? await result.json() : null;
  },{timeout:60000}).toMatchObject({plan:'plus',status:'active',environment:'sandbox',credits:{allowance:3000}});
});

test('sandbox purchase persists after reload and restore',async({page})=>{
  test.setTimeout(120000);
  test.skip(process.env.LAUNCH_PAYMENT_TESTS !== '1','Requires the explicit payment test runner.');
  expect(process.env.E2E_BASE_URL).toBe('http://localhost:3100');
  await signIn(page);
  await page.goto('/dashboard?settings=billing');
  await page.reload();
  await expect(page.getByRole('button',{name:'Restore purchases',exact:true})).toBeEnabled({timeout:30000});
  const before=await (await page.request.get('/api/billing/status')).json();
  expect(before).toMatchObject({plan:'plus',isActive:true,environment:'sandbox',credits:{allowance:3000}});
  await page.getByRole('button',{name:'Restore purchases',exact:true}).click();
  await expect(page.getByRole('button',{name:'Restore purchases',exact:true})).toBeEnabled();
  expect(await (await page.request.get('/api/billing/status')).json()).toMatchObject({plan:before.plan,status:before.status,productId:before.productId,expiresAt:before.expiresAt,credits:before.credits});
});

 test('sandbox checkout cancellation leaves a Basic account unchanged',async({page})=>{
  test.setTimeout(90000);
  test.skip(process.env.LAUNCH_PAYMENT_TESTS !== '1' || process.env.LAUNCH_PAYMENT_CANCELLATION !== '1','Requires the explicit payment test runner.');
  expect(process.env.E2E_BASE_URL).toBe('http://localhost:3100');
  await signIn(page);
  const before=await (await page.request.get('/api/billing/status')).json();
  expect(before.plan).toBe('basic');
  await page.goto('/dashboard?settings=billing');
  await expect(page.getByRole('button',{name:'Choose',exact:true}).first()).toBeEnabled({timeout:30000});
  await page.getByRole('button',{name:'Choose',exact:true}).first().click();
  await expect(page.getByText('SANDBOX',{exact:true})).toBeVisible({timeout:30000});
  await expect.poll(async()=>{
    for(const frame of page.frames()) if(await frame.getByRole('button',{name:'Subscribe',exact:true}).isVisible().catch(()=>false)) return true;
    return false;
  },{timeout:30000}).toBe(true);
  // RevenueCat registers browser Back as checkout cancellation.
  // The unnamed X dismisses only its sandbox banner.
  await page.goBack();
  await expect(page.getByText('SANDBOX',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Choose',exact:true}).first()).toBeEnabled({timeout:30000});
  await page.reload();
  expect(await (await page.request.get('/api/billing/status')).json()).toMatchObject({plan:before.plan,status:before.status,productId:before.productId,credits:before.credits});
});

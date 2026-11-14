import { expect, test } from '@playwright/test';

async function openDevice(page, kind) {
  await page.goto('/?crewPreview=180');
  await expect(page.locator('#loading')).toHaveCount(0, { timeout: 30000 });
  await page.locator('#more').click();
  await page.locator('#pause').click();
  await page.locator('#more').click();
  await page.locator('#zone-select').selectOption(kind === 'phone' ? 'room-2' : 'common');
  const pixel = await page.evaluate(kind => {
    const scene = window.demoDiagnostics();
    return kind === 'phone' ? scene.phonePixels[2] : scene.screenPixel;
  }, kind);
  await page.mouse.click(pixel.x, pixel.y);
  const iframe = page.locator('#modal iframe');
  await expect(iframe).toBeVisible();
  const route = kind === 'phone' ? '/app' : '/board';
  const device = iframe.contentFrame();
  await expect(device.locator('body')).toBeVisible();
  await expect.poll(() => device.locator('body').evaluate(() => location.pathname)).toContain(route);
  return device;
}

async function verifyDevice(device, username) {
  await expect(device.locator('.connection.connected')).toBeVisible();
  await expect(device.getByLabel('Password', { exact: true })).toHaveCount(0);
  if (username !== 'display') await expect(device.locator('.page-title .kicker')).toContainText(username, { ignoreCase: true });
}

test('original cabin phones load the current hologram assets through their station routes', async ({ request }) => {
  for (const name of ['lin', 'kai', 'mira', 'noa', 'sol']) {
    const prefix = '/stations/' + name;
    const preview = await request.get(prefix + '/body/preview.png?v=hologram-2');
    expect(preview.status()).toBe(200);
    expect(preview.headers()['content-type']).toContain('image/png');
    expect((await preview.body()).subarray(1, 4).toString()).toBe('PNG');
    const model = await request.get(prefix + '/body/orbital-body.glb');
    expect(model.status()).toBe(200);
    expect((await model.body()).subarray(0, 4).toString()).toBe('glTF');
    expect((await request.post(prefix + '/body/orbital-body.glb')).status()).toBe(403);
    expect((await request.get(prefix + '/body/not-an-asset.json')).status()).toBe(404);
  }
  expect((await request.get('/stations/display/body/orbital-body.glb')).status()).toBe(404);
  expect((await request.get('/stations/unknown/body/orbital-body.glb')).status()).toBe(404);
});

test('original phone home opens an interactive hologram with scans and history inside the cabin', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('orbital.lang', 'zh-TW'));
  const phone = await openDevice(page, 'phone');
  await verifyDevice(phone, 'mira');
  const card = phone.getByTestId('body-overview-card');
  await expect(card).toBeVisible();
  await expect.poll(() => card.locator('img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: info.outputPath('original-phone-home.png') });
  await card.click();
  await expect(phone.getByTestId('body-scene')).toHaveAttribute('data-renderer', 'ready');
  await expect(phone.getByTestId('body-scene')).toHaveAttribute('data-visual', 'hologram-v2');
  expect(await phone.locator('body').evaluate(() => location.pathname)).toBe('/stations/mira/app/body-map');
  await phone.getByRole('button', { name: '模擬掃描', exact: true }).click();
  await expect(phone.getByTestId('body-composition')).toContainText('32.4');
  await phone.getByLabel('掃描情境', { exact: true }).selectOption('training_strain');
  await phone.getByRole('button', { name: '模擬掃描', exact: true }).click();
  await expect(phone.getByTestId('body-composition')).toContainText('32.0');
  await phone.getByTestId('body-layer-muscle').click();
  const canvas = phone.locator('.body-canvas canvas');
  await canvas.scrollIntoViewIfNeeded();
  const size = await canvas.boundingBox();
  await canvas.click({ position: { x: size.width * .55, y: size.height * .59 } });
  await expect(phone.getByTestId('body-region-title')).toHaveText('左大腿');
  await phone.getByTestId('body-layer-fat').click();
  await expect(phone.getByTestId('body-layer-fat')).toHaveAttribute('aria-pressed', 'true');
  await expect(phone.locator('.body-finding')).toContainText('肌肉拉傷');
  await phone.getByRole('button', { name: '背面', exact: true }).click();
  await expect(phone.getByRole('button', { name: '背面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await phone.getByRole('button', { name: '正面', exact: true }).click();
  await phone.getByRole('button', { name: '歷史比較', exact: true }).click();
  const history = phone.getByLabel('目前掃描', { exact: true });
  const prior = await history.locator('option').last().getAttribute('value');
  await history.selectOption(prior);
  await expect(phone.locator('.body-history-banner')).toContainText('歷史掃描');
  await phone.getByRole('button', { name: '回到最新', exact: true }).click();
  await phone.getByRole('button', { name: '暫停投影動態', exact: true }).click();
  await canvas.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('original-phone-hologram.png') });
  expect(await phone.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#close').click();
  await expect(page.locator('#modal iframe')).toHaveCount(0);
});

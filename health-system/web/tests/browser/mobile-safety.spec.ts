import { test, expect, type Page } from '@playwright/test'

// Finish intercepted requests before Playwright disposes the page/request context.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' })
})

async function login(page: Page, username = 'mira') {
  await page.addInitScript(() => sessionStorage.setItem('orbital.lang', 'zh-TW'))
  const response = await page.request.post('/v1/auth/login', { data: { username, password: 'body-e2e-only' } })
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data.csrfToken as string
}
async function quietFeed(page: Page, emergencies: object[] = []) {
  await page.route('**/v1/snapshot?*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.emergencies = emergencies
    await route.fulfill({ response, json: body })
  })
}
const popup = (page: Page) => page.getByRole('alertdialog')
const number = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true })

test('home uses the appropriate layout and opens the dedicated radiation page', async ({ page }) => {
  await login(page)
  await quietFeed(page)
  await page.goto('/app/overview')
  if ((page.viewportSize()?.width ?? 0) <= 650) {
    await expect(page.locator('.mobile-home')).toBeVisible()
    await expect(page.getByTestId('demo-health-summary')).toHaveCount(0)
    await expect(page.locator('.vital-tile')).toHaveCount(4)
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await page.getByRole('button', { name: '輻射監測', exact: true }).click()
  } else {
    await page.getByTestId('summary-radiation').getByRole('button', { name: '查看輻射詳情', exact: true }).click()
  }
  await expect(page).toHaveURL(/\/app\/radiation$/)
  await expect(page.getByTestId('radiation-rate')).toBeVisible()
})

test('phone retains saved three-layer reports and the baseline review workflow', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 650, 'Phone-specific controls')
  const csrf = await login(page, 'sol')
  await quietFeed(page)
  const measurement = await page.request.post('/v1/manual-measurements', { headers: { 'X-CSRF-Token': csrf }, data: {
    schemaVersion: '1.3', commandId: crypto.randomUUID(), crewId: 'sol', isSynthetic: true,
    observedAt: new Date(Date.now() - 60000).toISOString(), method: 'mobile_integration', context: { activity: 'rest' },
    metrics: [{ code: 'heart_rate', value: 74, unit: '/min', quality: 'good' }],
  } })
  expect(measurement.status()).toBe(201)
  await page.goto('/app/news2')
  await page.getByRole('button', { name: '保存三層評估', exact: true }).click()
  const report = page.getByTestId('health-report')
  await expect(report).toBeVisible()
  const id = await report.getAttribute('data-id')
  expect((await page.request.get('/v1/health-reports/' + id)).status()).toBe(200)
  await page.reload()
  await expect(page.getByTestId('health-report')).toHaveAttribute('data-id', id!)
  await page.goto('/app/trends')
  await page.getByRole('button', { name: '個人基準與詳細分析', exact: true }).click()
  const controls = page.locator('.baseline-controls').first()
  await controls.locator(':scope > summary').click()
  await expect(controls.getByRole('button', { name: '建立基準候選', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '返回趨勢摘要', exact: true }).click()
  await expect(page.getByRole('tablist', { name: '指標', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test.describe('phone safety', () => {
  test.beforeEach(async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 650, 'Phone-specific controls')
    await login(page)
    await quietFeed(page)
  })

  test('acknowledging one emergency preserves the other, including equal timestamps', async ({ page }) => {
    await page.unroute('**/v1/snapshot?*')
    const at = new Date().toISOString()
    await quietFeed(page, [
      { id: 'notice-b', crewId: 'kai', source: 'manual', createdAt: at },
      { id: 'notice-a', crewId: 'leo', source: 'manual', createdAt: at },
    ])
    await page.goto('/app/overview')
    await expect(page.getByRole('button', { name: '緊急通知 2', exact: true })).toBeVisible()
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await expect(page.getByRole('button', { name: '緊急通知 1', exact: true })).toBeVisible()
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('orbital.emergency.ackIds.v1.mira')!))).toEqual(['notice-b'])
    await expect(popup(page)).toBeVisible()
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await expect(page.getByRole('button', { name: /^緊急通知/ })).toHaveCount(0)
    await page.reload()
    await expect(popup(page)).toHaveCount(0)
  })

  test('untouched measurements never reach a saveable review', async ({ page }) => {
    await page.goto('/app/measure')
    await page.getByRole('button', { name: '檢查量測', exact: true }).click()
    await expect(page.getByRole('button', { name: '保存量測', exact: true })).toHaveCount(0)
    await expect(page.getByRole('alert')).toBeVisible()
  })

  test('numeric inputs preserve readings outside slider limits and decimal precision', async ({ page }) => {
    await page.goto('/app/measure')
    for (const [metric, field, value] of [
      ['心率', '心率', '220'], ['血氧', '血氧', '65'], ['血壓', '收縮壓', '230'],
      ['體溫', '體溫', '33.5'], ['體溫', '體溫', '36.65'],
    ]) {
      await page.locator('.metric-choices').getByRole('button', { name: metric, exact: true }).click()
      await number(page, field).fill(value)
      if (metric === '血壓') await number(page, '舒張壓').fill('80')
      await page.getByRole('button', { name: '檢查量測', exact: true }).click()
      const saved = page.waitForResponse(r => r.url().endsWith('/v1/manual-measurements') && r.request().method() === 'POST')
      await page.getByRole('button', { name: '保存量測', exact: true }).click()
      const response = await saved
      expect(response.ok()).toBeTruthy()
      const payload = response.request().postDataJSON()
      expect(payload.metrics[0].value).toBe(Number(value))
      const id = (await response.json()).data.measurementIds[0]
      const read = await page.request.get('/v1/assistant/records/measurement/' + id)
      expect(read.ok()).toBeTruthy()
      expect((await read.json()).data.value).toBe(Number(value))
      await page.getByRole('button', { name: '新增下一筆', exact: true }).click()
      await expect(number(page, field)).toHaveValue('')
    }
  })

  test('NEWS2 can save an out-of-slider reading without manufacturing other inputs', async ({ page }) => {
    await page.goto('/app/news2')
    await page.getByLabel('評估紀錄', { exact: true }).selectOption('')
    await number(page, '血氧飽和度').fill('65')
    const saved = page.waitForResponse(r => r.url().endsWith('/v1/news2') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '儲存評估', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBeTruthy()
    const record = (await response.json()).data
    expect(record.inputs.spo2).toBe(65)
    expect(record.inputs.heart_rate).toBeNull()
    await page.reload()
    await expect(number(page, '血氧飽和度')).toHaveValue('65')
  })

  test('each history row identifies its UTC date across midnight and year boundaries', async ({ page }) => {
    const dates = ['2026-11-15T00:01:00Z', '2026-11-14T23:59:00Z', '2026-01-01T00:01:00Z', '2025-12-31T23:59:00Z']
    await page.route('**/v1/measurements?*', route => route.fulfill({ json: { data: {
      items: dates.map((observedAt, i) => ({
        id: 'history-' + i, crewId: 'mira', observedAt, metricCode: 'heart_rate', value: 72,
        unit: '/min', quality: 'good', provenance: { source: 'manual' }, context: {},
      })), nextCursor: null,
    } } }))
    await page.goto('/app/history')
    const rows = page.locator('.history-matrix tbody tr')
    await expect(rows).toHaveCount(4)
    for (let i = 0; i < dates.length; i++) {
      await expect(rows.nth(i).getByRole('rowheader')).toContainText(dates[i].slice(0, 10))
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  })

  test('old acknowledgement timestamps and corrupt ID storage do not hide unread events', async ({ page }) => {
    await page.addInitScript(() => {
      sessionStorage.setItem('orbital.emergency.seenAt.mira', '2099-01-01T00:00:00Z')
      sessionStorage.setItem('orbital.emergency.ackIds.v1.mira', '{broken')
    })
    await page.unroute('**/v1/snapshot?*')
    await quietFeed(page, [{ id: 'old-but-unread', crewId: 'kai', source: 'manual', createdAt: '2025-01-01T00:00:00Z' }])
    await page.goto('/app/overview')
    await expect(page.getByRole('button', { name: '緊急通知 1', exact: true })).toBeVisible()
    await expect(popup(page)).toHaveCount(0)
    await page.getByRole('button', { name: '緊急通知 1', exact: true }).click()
    await expect(popup(page)).toBeVisible()
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await expect(popup(page)).toHaveCount(0)
  })

  test('storage write failures still allow confirmation and own sensor alerts remain visible', async ({ page }) => {
    await page.addInitScript(() => {
      const set = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('orbital.emergency.ackIds')) throw new DOMException('Quota', 'QuotaExceededError')
        return set.call(this, key, value)
      }
    })
    await page.unroute('**/v1/snapshot?*')
    const createdAt = new Date().toISOString()
    await quietFeed(page, [
      { id: 'own-manual', crewId: 'mira', source: 'manual', createdAt },
      { id: 'own-sensor', crewId: 'mira', source: 'sensor', createdAt },
    ])
    await page.goto('/app/overview')
    await expect(page.getByRole('button', { name: '緊急通知 1', exact: true })).toBeVisible()
    await expect(popup(page)).toContainText('訓練感測警示')
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await expect(popup(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^緊急通知/ })).toHaveCount(0)
  })

  test('acknowledgements are isolated by account', async ({ page }) => {
    await page.unroute('**/v1/snapshot?*')
    await quietFeed(page, [{ id: 'shared-notice', crewId: 'leo', source: 'manual', createdAt: new Date().toISOString() }])
    await page.goto('/app/overview')
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await login(page, 'kai')
    await page.reload()
    await expect(popup(page)).toBeVisible()
    await popup(page).getByRole('button', { name: '我知道了' }).click()
    await login(page, 'mira')
    await page.reload()
    await expect(popup(page)).toHaveCount(0)
  })

  test('opening aid defers pending notices but real new SSE alerts still interrupt', async ({ page, playwright, baseURL }) => {
    await page.unroute('**/v1/snapshot?*')
    const createdAt = new Date().toISOString()
    await quietFeed(page, [
      { id: 'pending-b', crewId: 'leo', source: 'manual', createdAt },
      { id: 'pending-a', crewId: 'kai', source: 'manual', createdAt },
    ])
    await page.goto('/app/overview')
    await popup(page).getByRole('button', { name: '開啟急救指引' }).click()
    await expect(page).toHaveURL(/\/app\/first-aid$/)
    await expect(popup(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '緊急通知 1', exact: true })).toBeVisible()
    const sender = await playwright.request.newContext({ baseURL })
    try {
      const auth = await sender.post('/v1/auth/login', { data: { username: 'kai', password: 'body-e2e-only' } })
      const csrf = (await auth.json()).data.csrfToken
      const commandId = crypto.randomUUID()
      const send = () => sender.post('/v1/emergencies', { data: { commandId }, headers: { 'X-CSRF-Token': csrf } })
      expect((await send()).ok()).toBeTruthy()
      await expect(popup(page)).toBeVisible()
      await expect(page.getByRole('button', { name: '緊急通知 2', exact: true })).toBeVisible()
      expect((await send()).ok()).toBeTruthy()
      await expect(page.getByRole('button', { name: '緊急通知 2', exact: true })).toBeVisible()
      // A new event arriving while the first is displayed must remain pending too.
      expect((await sender.post('/v1/emergencies', { data: { commandId: crypto.randomUUID() }, headers: { 'X-CSRF-Token': csrf } })).ok()).toBeTruthy()
      await expect(page.getByRole('button', { name: '緊急通知 3', exact: true })).toBeVisible()
      await popup(page).getByRole('button', { name: '我知道了' }).click()
      await expect(page.getByRole('button', { name: '緊急通知 2', exact: true })).toBeVisible()
    } finally { await sender.dispose() }
  })

  test('switching quality and metrics never restores a default and partial BP remains possible', async ({ page }) => {
    await page.goto('/app/measure')
    for (const metric of ['血氧', '體溫', '心率']) {
      await page.locator('.metric-choices').getByRole('button', { name: metric, exact: true }).click()
      await expect(number(page, metric)).toHaveValue('')
    }
    await number(page, '心率').fill('72')
    await page.getByRole('combobox', { name: '品質', exact: true }).selectOption('missing')
    await expect(number(page, '心率')).toHaveValue('')
    await page.getByRole('combobox', { name: '品質', exact: true }).selectOption('good')
    await expect(number(page, '心率')).toHaveValue('')
    await page.locator('.metric-choices').getByRole('button', { name: '血壓', exact: true }).click()
    await number(page, '收縮壓').fill('230')
    await expect(number(page, '舒張壓')).toHaveValue('')
    await expect(page.getByRole('slider', { name: '收縮壓滑桿' })).toBeDisabled()
    await page.getByLabel('品質或缺值原因', { exact: true }).fill('training missing diastolic')
    await page.getByRole('button', { name: '檢查量測', exact: true }).click()
    const saved = page.waitForResponse(r => r.url().endsWith('/v1/manual-measurements') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '保存量測', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBeTruthy()
    expect(response.request().postDataJSON().metrics.map((m: { value: number | null }) => m.value)).toEqual([230, null])
    await page.getByRole('button', { name: '新增下一筆', exact: true }).click()
    await page.getByRole('combobox', { name: '品質', exact: true }).selectOption('missing')
    await page.getByLabel('品質或缺值原因', { exact: true }).fill('training no device')
    await page.getByRole('button', { name: '檢查量測', exact: true }).click()
    const missing = page.waitForResponse(r => r.url().endsWith('/v1/manual-measurements') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '保存量測', exact: true }).click()
    expect((await missing).ok()).toBeTruthy()
  })

  test('NEWS2 preserves boundaries, decimals, partial inputs and linked-to-manual switching', async ({ page }) => {
    const csrf = await login(page)
    const seeded = await page.request.post('/v1/manual-measurements', { headers: { 'X-CSRF-Token': csrf }, data: {
      schemaVersion: '1.3', runId: null, crewId: 'mira', commandId: crypto.randomUUID(),
      observedAt: new Date(Date.now() - 1000).toISOString(), method: 'manual_training_entry',
      isSynthetic: true, measurementGroupId: null, context: { measurementSite: 'fingertip' },
      metrics: [{ code: 'spo2', unit: '%', value: 65, quality: 'good', qualityReason: null }],
    } })
    expect(seeded.ok()).toBeTruthy()
    await page.goto('/app/news2')
    await page.getByLabel('評估紀錄', { exact: true }).selectOption('')
    const spo2 = number(page, '血氧飽和度')
    await expect(spo2).toHaveValue('')
    await spo2.fill('101')
    expect(await spo2.evaluate((e: HTMLInputElement) => e.validity.rangeOverflow)).toBeTruthy()
    await spo2.fill('0')
    await expect(page.getByRole('slider', { name: '血氧飽和度滑桿' })).toBeDisabled()
    await page.getByRole('tab', { name: '心率', exact: true }).click()
    const pulse = number(page, '心率')
    await pulse.fill('-1')
    expect(await pulse.evaluate((e: HTMLInputElement) => e.validity.rangeUnderflow)).toBeTruthy()
    await pulse.fill('220')
    await page.getByRole('tab', { name: '血壓', exact: true }).click()
    await number(page, '收縮壓').fill('230')
    await page.getByRole('tab', { name: '呼吸', exact: true }).click()
    await number(page, '呼吸頻率').fill('45')
    await number(page, '呼吸觀察秒數 (s)').fill('60')
    await page.getByRole('tab', { name: '體溫', exact: true }).click()
    await number(page, '體溫').fill('36.65')
    await page.getByRole('button', { name: '口腔', exact: true }).click()
    await page.getByLabel('體溫量測方法', { exact: true }).fill('manual_training_entry')
    const saved = page.waitForResponse(r => r.url().endsWith('/v1/news2') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '儲存評估', exact: true }).click()
    const response = await saved
    expect(response.ok()).toBeTruthy()
    const record = (await response.json()).data
    expect(record.inputs).toMatchObject({ spo2: 0, heart_rate: 220, blood_pressure_systolic: 230, respiratory_rate: 45, temperature: 36.65 })
    await number(page, '體溫').fill('')
    const cleared = page.waitForResponse(r => r.url().endsWith('/v1/news2') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '儲存評估', exact: true }).click()
    expect((await (await cleared).json()).data.inputs.temperature).toBeNull()
    await page.getByRole('tab', { name: /^(已填 )?血氧$/ }).click()
    const latest = page.getByRole('button', { name: /^用最近一筆量測/ })
    await expect(latest).toBeVisible()
    await latest.click()
    await expect(spo2).toHaveCount(0)
    await page.getByRole('button', { name: '改成手動輸入', exact: true }).click()
    await expect(spo2).toHaveValue('0')
  })

  test('manual zero values, sliders and language switches retain the same draft', async ({ page }, info) => {
    await page.goto('/app/measure')
    await number(page, '心率').fill('0')
    await expect(page.locator('.slider-head output')).toContainText('0')
    await expect(page.getByRole('slider')).toBeDisabled()
    await page.getByRole('button', { name: /切換至英文|Switch to English/ }).click()
    await expect(number(page, 'Heart rate')).toHaveValue('0')
    await number(page, 'Heart rate').fill('')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await expect(page.getByRole('slider')).toBeEnabled()
    await page.getByRole('button', { name: 'Increase Heart rate', exact: true }).click()
    await expect(number(page, 'Heart rate')).toHaveValue('73')
    await number(page, 'Heart rate').fill('220')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await page.screenshot({ path: info.outputPath('precise-input.png'), fullPage: true })
  })

})


test('wide layout keeps numeric entry and desktop NEWS2 controls', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 650, 'Wide layout only')
  await login(page)
  await quietFeed(page)
  await page.goto('/app/measure')
  await expect(number(page, '心率')).toHaveValue('')
  await number(page, '心率').fill('220')
  await page.getByRole('button', { name: '檢查量測', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存量測', exact: true })).toBeVisible()
  await page.goto('/app/news2')
  await page.getByLabel('評估紀錄', { exact: true }).selectOption('')
  await expect(page.locator('.news2-phone')).toHaveCount(0)
  await number(page, '心率').fill('220')
  await expect(number(page, '心率')).toHaveValue('220')
})


test('history dates and pagination stay UTC in both local timezone settings', async ({ browser, page, baseURL }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 650, 'Phone history only')
  for (const timezoneId of ['Asia/Taipei', 'America/Los_Angeles']) {
    const context = await browser.newContext({ baseURL, timezoneId, viewport: page.viewportSize()! })
    try {
      const target = await context.newPage()
      await login(target)
      await quietFeed(target)
      const dates = ['2026-11-15T00:01:00Z', '2026-11-14T23:59:00Z', '2026-11-01T00:01:00Z',
        '2026-10-31T23:59:00Z', '2026-01-01T00:01:00Z', '2025-12-31T23:59:00Z',
        '2025-12-30T23:59:00Z', '2025-12-29T23:59:00Z']
      await target.route('**/v1/measurements?*', route => route.fulfill({ json: { data: {
        items: dates.map((observedAt, i) => ({ id: 'dated-' + i, observedAt, metricCode: 'heart_rate',
          value: 72, quality: 'good', unit: '/min', provenance: { source: 'manual' }, context: {} })), nextCursor: null,
      } } }))
      await target.goto('/app/history')
      const rows = target.locator('.history-matrix tbody tr')
      await expect(rows).toHaveCount(7)
      for (let i = 0; i < 7; i++) {
        await expect(rows.nth(i).getByRole('rowheader')).toContainText(dates[i].slice(0, 10))
        await expect(rows.nth(i).getByRole('rowheader')).toContainText(dates[i].slice(11, 19))
      }
      await rows.first().getByRole('rowheader').getByRole('button').click()
      await expect(target.locator('.history-detail')).toContainText('00:01')
      await target.getByRole('button', { name: '返回列表', exact: true }).click()
      await target.getByRole('button', { name: '較舊', exact: true }).click()
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText('2025-12-29')
      await target.getByRole('button', { name: '較新', exact: true }).click()
      await expect(rows.first()).toContainText('2026-11-15')
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    } finally {
      for (const openPage of context.pages()) await openPage.unrouteAll({ behavior: 'wait' })
      await context.close()
    }
  }
})

test('precise values cannot be rounded by slider step controls', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) > 650, 'Phone sliders only')
  await login(page)
  await quietFeed(page)
  await page.goto('/app/measure')
  for (const [metric, value] of [['心率', '72.5'], ['體溫', '36.65']]) {
    await page.locator('.metric-choices').getByRole('button', { name: metric, exact: true }).click()
    await number(page, metric).fill(value)
    await expect(page.getByRole('slider')).toBeDisabled()
    await expect(page.getByRole('button', { name: '增加 ' + metric, exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '減少 ' + metric, exact: true })).toBeDisabled()
    await expect(number(page, metric)).toHaveValue(value)
  }
  await page.goto('/app/news2')
  await page.getByLabel('評估紀錄', { exact: true }).selectOption('')
  for (const [metric, value] of [['心率', '72.5'], ['體溫', '36.65']]) {
    await page.getByRole('tab', { name: metric, exact: true }).click()
    await number(page, metric).fill(value)
    await expect(page.getByRole('slider')).toBeDisabled()
    await expect(page.getByRole('button', { name: '增加', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '減少', exact: true })).toBeDisabled()
    await expect(number(page, metric)).toHaveValue(value)
  }
})

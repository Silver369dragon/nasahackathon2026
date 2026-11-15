import { test, expect, type Page } from '@playwright/test'

// Finish intercepted requests before Playwright disposes the page/request context.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' })
})

// Other suites publish real emergencies to the shared disposable server.
// Body tests exercise scan data and WebGL, so keep unrelated notifications out of their UI.
test.beforeEach(async ({ page }) => {
  await page.route('**/v1/snapshot?*', async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.emergencies = []
    await route.fulfill({ response, json: body })
  })
})

async function login(page: Page, username = 'mira') {
  await page.addInitScript(() => sessionStorage.setItem('orbital.lang','zh-TW'))
  const response = await page.request.post('/v1/auth/login', {data:{username,password:'body-e2e-only'}})
  expect(response.ok()).toBeTruthy()
  return (await response.json()).data.csrfToken as string
}
// Phones show body details behind two tabs; open one before using what is inside it.
async function bodyTab(page: Page, id: 'region' | 'injury') {
  const tab = page.getByTestId('body-tab-' + id)
  if (await tab.isVisible() && await tab.getAttribute('aria-selected') !== 'true') await tab.click()
}
async function seed(page: Page, csrf: string, preset: string) {
  const response = await page.request.post('/v1/body-scans/demo',{data:{requestId:crypto.randomUUID(),preset},headers:{'X-CSRF-Token':csrf}})
  expect(response.status()).toBe(201)
  return (await response.json()).data.scan
}

test('mobile hologram selects real meshes, changes layers and compares saved scans', async ({ page }, info) => {
  const errors:string[]=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('console',message=>{if(message.type()==='error'&&/THREE|WebGL|shader/i.test(message.text()))errors.push(message.text())})
  const token=await login(page)
  await seed(page,token,'baseline')
  await seed(page,token,'training_strain')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  await expect(page.getByTestId('body-composition')).toContainText('32.0')
  await page.screenshot({path:info.outputPath('body-first-screen.png')})
  await page.getByTestId('body-layer-muscle').click()
  await expect(page.getByTestId('body-layer-muscle')).toHaveAttribute('aria-pressed','true')
  await page.screenshot({path:info.outputPath('body-muscle.png'),fullPage:true})
  const canvas=page.locator('.body-canvas canvas')
  const size=await canvas.boundingBox()
  expect(size).not.toBeNull()
  // Hit the actual anatomical left thigh on the projected model, not a DOM overlay.
  await canvas.click({position:{x:size!.width*.55,y:size!.height*.59}})
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  await page.getByTestId('body-layer-fat').click()
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  await expect(page.locator('.body-finding')).toContainText('肌肉拉傷')
  await bodyTab(page,'region')
  await page.getByRole('button',{name:'比較與掃描細節',exact:true}).click()
  await expect(page.getByTestId('body-comparison')).toBeVisible()
  await page.screenshot({path:info.outputPath('body-mobile.png'),fullPage:true})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  expect(errors).toEqual([])
})

test('scan controls persist a recovery scan and history shows the matching injury state', async ({ page }, info) => {
  const token=await login(page)
  await seed(page,token,'baseline')
  const strain=await seed(page,token,'training_strain')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  await page.getByLabel('掃描情境',{exact:true}).selectOption('recovery')
  await page.getByRole('button',{name:'模擬掃描',exact:true}).click()
  await expect(page.getByRole('button',{name:'掃描中…',exact:true})).toBeDisabled()
  await expect(page.locator('.body-finding-tags').first()).toContainText('恢復中')
  await expect(page.getByTestId('body-composition')).toContainText('32.7')
  const latest=(await (await page.request.get('/v1/body-scans/latest')).json()).data.scan
  await page.reload()
  await expect(page.getByTestId('body-composition')).toContainText('32.7')
  await page.getByRole('button',{name:'歷史比較',exact:true}).click()
  await page.getByLabel('目前掃描',{exact:true}).selectOption(strain.id)
  await expect(page.locator('.body-history-banner')).toContainText('歷史掃描')
  await expect(page.locator('.body-finding-tags').first()).toContainText('需注意')
  await expect(page.getByTestId('body-composition')).toContainText('32.0')
  await page.getByRole('button',{name:'回到最新',exact:true}).click()
  await expect(page.locator('.body-finding-tags').first()).toContainText('恢復中')
  expect((await (await page.request.get('/v1/body-scans/'+latest.id)).json()).data.scan.id).toBe(latest.id)
  await bodyTab(page,'region')
  await page.getByRole('button',{name:'比較與掃描細節',exact:true}).click()
  await page.screenshot({path:info.outputPath('history-comparison.png'),fullPage:true})
})

test('empty, partial and failed WebGL views retain accessible body information', async ({ page }, info) => {
  await login(page,'kai')
  await page.route('**/body/orbital-body.glb',route=>route.abort())
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','fallback')
  await expect(page.locator('.body-empty')).toContainText('第一次掃描')
  await page.getByRole('button',{name:'左大腿',exact:true}).click()
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  const token=await login(page)
  await seed(page,token,'partial')
  await page.reload()
  const missing=page.getByRole('button',{name:'左前臂',exact:true})
  const available=page.getByRole('button',{name:'右前臂',exact:true})
  // Fallback meshes mount before the scan request finishes; wait for the data-driven colors.
  await expect.poll(async () =>
    await missing.evaluate(element=>getComputedStyle(element).fill) !==
    await available.evaluate(element=>getComputedStyle(element).fill)).toBe(true)
  await page.getByRole('button',{name:'背面',exact:true}).click()
  await expect.poll(async () =>
    await page.getByRole('button',{name:'背部',exact:true}).evaluate(element=>getComputedStyle(element).fill) !==
    await available.evaluate(element=>getComputedStyle(element).fill)).toBe(true)
  await bodyTab(page,'region')
  await page.getByLabel('選擇身體部位',{exact:true}).selectOption('left_forearm')
  await expect(page.locator('.body-missing')).toContainText('尚無可用')
  await expect(page.getByTestId('body-composition')).toContainText('—')
  await page.getByRole('button',{name:/^(切換至英文|Switch to English)$/}).click()
  await expect(page.getByTestId('body-region-title')).toHaveText('Left forearm')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy()
  await page.screenshot({path:info.outputPath('fallback-english.png'),fullPage:true})
})

test('lost scan response retries the same saved command without a duplicate scan', async ({page})=>{
  const token=await login(page)
  await seed(page,token,'baseline')
  await page.goto('/app/body-map')
  await expect(page.getByRole('button',{name:'模擬掃描',exact:true})).toBeEnabled()
  const commands:{requestId:string;preset:string}[]=[]
  let accepted=''
  await page.route('**/v1/body-scans/demo',async route=>{
    commands.push(route.request().postDataJSON())
    const result=await route.fetch()
    if(commands.length===1){accepted=(await result.json()).data.scan.id;await route.abort();return}
    await route.fulfill({response:result})
  })
  await page.getByRole('button',{name:'模擬掃描',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('尚未確認掃描結果')
  await page.getByRole('button',{name:'重試掃描',exact:true}).click()
  await expect(page.getByRole('button',{name:'模擬掃描',exact:true})).toBeEnabled()
  expect(commands.length).toBe(2)
  expect(commands[0]).toEqual(commands[1])
  const history=(await(await page.request.get('/v1/body-scans')).json()).data.items
  expect(history.filter((scan:{id:string})=>scan.id===accepted)).toHaveLength(1)
})

test('dragging rotates without selecting, back keeps anatomical left and zoom works', async({page})=>{
  const token=await login(page)
  await seed(page,token,'baseline')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  await page.getByRole('button',{name:'暫停投影動態',exact:true}).click()
  const canvas=page.locator('.body-canvas canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box=(await canvas.boundingBox())!
  const before=await canvas.screenshot()
  const client=await page.context().newCDPSession(page)
  const origin={x:box.x+box.width*.55,y:box.y+box.height*.59}
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[origin]})
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:origin.x+45,y:origin.y}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[origin]})
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect(page.getByTestId('body-region-title')).toHaveText('全身總覽')
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.5,y:box.y+box.height*.4}]})
  for(let n=1;n<=6;n++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*.5+n*10,y:box.y+box.height*.4}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  await expect(page.getByTestId('body-region-title')).toHaveText('全身總覽')
  expect((await canvas.screenshot()).equals(before)).toBe(false)
  await page.getByRole('button',{name:'背面',exact:true}).click()
  const size=(await canvas.boundingBox())!
  await canvas.click({position:{x:size.width*.45,y:size.height*.59}})
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  const back=await canvas.screenshot()
  await page.getByRole('button',{name:'放大人體',exact:true}).click()
  expect((await canvas.screenshot()).equals(back)).toBe(false)
  await page.getByRole('button',{name:'重設視角',exact:true}).click()
  await expect(page.getByRole('button',{name:'正面',exact:true})).toHaveAttribute('aria-pressed','true')
  const unzoomed=await canvas.screenshot()
  const cx=size.x+size.width*.5,cy=size.y+size.height*.5
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:cx-25,y:cy,id:1},{x:cx+25,y:cy,id:2}]})
  for(let n=1;n<=5;n++)await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:cx-25-n*5,y:cy,id:1},{x:cx+25+n*5,y:cy,id:2}]})
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
  expect((await canvas.screenshot()).equals(unzoomed)).toBe(false)
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  await client.detach()
})

test('hologram projection can pause and honors reduced motion without disabling selection',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'})
  const token=await login(page)
  await seed(page,token,'baseline')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  await expect(page.getByRole('button',{name:'播放投影動態',exact:true})).toBeVisible()
  const canvas=page.locator('.body-canvas canvas')
  const still=await canvas.screenshot()
  // Check stability over several intended animation ticks, not just one frame.
  await page.waitForTimeout(200)
  expect((await canvas.screenshot()).equals(still)).toBe(true)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await page.getByRole('button',{name:'播放投影動態',exact:true}).click()
  await expect.poll(async()=>(await canvas.screenshot()).equals(still)).toBe(false)
  await page.getByRole('button',{name:'暫停投影動態',exact:true}).click()
  const paused=await canvas.screenshot()
  await page.waitForTimeout(200)
  expect((await canvas.screenshot()).equals(paused)).toBe(true)
  const box=(await canvas.boundingBox())!
  await canvas.click({position:{x:box.width*.55,y:box.height*.59}})
  await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  await page.getByRole('button',{name:'模擬掃描',exact:true}).click()
  await expect(page.getByRole('button',{name:'掃描中…',exact:true})).toBeDisabled()
  expect(await page.locator('.body-scan-plane').evaluate(element=>getComputedStyle(element).animationPlayState)).toBe('paused')
})

test('context loss during model loading stays in the usable fallback after the file arrives',async({page})=>{
  const token=await login(page)
  await seed(page,token,'baseline')
  let release!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  await page.route('**/body/orbital-body.glb',async route=>{
    const response=await route.fetch()
    await held
    await route.fulfill({response})
  })
  try{
    await page.goto('/app/body-map')
    const scene=page.getByTestId('body-scene')
    await expect(scene).toHaveAttribute('data-renderer','loading')
    await page.locator('.body-canvas canvas').evaluate((canvas:HTMLCanvasElement)=>{
      canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
    })
    await expect(scene).toHaveAttribute('data-renderer','fallback')
    const arrived=page.waitForResponse(response=>response.url().endsWith('/body/orbital-body.glb'))
    release()
    await(await arrived).finished()
    // GLTFLoader's decode callback follows the network completion asynchronously.
    await page.waitForTimeout(250)
    expect(await scene.getAttribute('data-renderer')).toBe('fallback')
    await expect(page.getByRole('button',{name:'放大人體',exact:true})).toBeDisabled()
    await page.getByRole('button',{name:'左大腿',exact:true}).click()
    await expect(page.getByTestId('body-region-title')).toHaveText('左大腿')
  }finally{release()}
})

test('offline refresh retains the scan and context loss falls back without losing history', async({page})=>{
  const token=await login(page)
  await seed(page,token,'baseline')
  await seed(page,token,'recovery')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  // refresh() also loads history before releasing its in-flight guard.
  await page.getByRole('button',{name:'歷史比較',exact:true}).click()
  await expect.poll(() => page.getByLabel('比較掃描',{exact:true}).locator('option').count()).toBeGreaterThan(1)
  await page.locator('.body-canvas canvas').evaluate((canvas:HTMLCanvasElement)=>{
    canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext()
  })
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','fallback')
  await page.route('**/v1/body-scans/latest',route=>route.abort())
  await page.evaluate(()=>window.dispatchEvent(new Event('online')))
  await expect(page.getByText('暫時無法連線，保留最後取得的掃描資料。')).toBeVisible()
  await expect(page.getByTestId('body-composition')).toContainText('32.7')
  await expect(page.getByLabel('比較掃描',{exact:true})).toBeEnabled()
})

test('home uses a static preview and leaving the body view releases WebGL', async({page},info)=>{
  const requests:string[]=[]
  page.on('request',request=>requests.push(request.url()))
  const token=await login(page)
  await seed(page,token,'baseline')
  await page.goto('/app/overview')
  // Phones show a button home screen instead of the body preview card.
  const phone=(page.viewportSize()?.width ?? 1000)<=650
  const card=phone ? page.getByRole('button',{name:'身體全息圖',exact:true}) : page.getByTestId('body-overview-card')
  await expect(card).toBeVisible()
  if(!phone){
    await expect(card).toContainText('32.4')
    await expect.poll(()=>card.locator('img').evaluate((img:HTMLImageElement)=>img.naturalWidth)).toBeGreaterThan(0)
  }
  expect(requests.filter(url=>/BodyScene-|orbital-body\.glb/.test(url))).toEqual([])
  await card.screenshot({path:info.outputPath('home-body-card.png')})
  await card.click()
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  await page.locator('.body-canvas canvas').evaluate((canvas:HTMLCanvasElement)=>{
    (window as unknown as {bodyTestCanvas:HTMLCanvasElement}).bodyTestCanvas=canvas
  })
  await page.getByRole('button',{name:'返回個人總覽',exact:true}).click()
  await expect(card).toBeVisible()
  await expect(page.locator('.body-canvas canvas')).toHaveCount(0)
  expect(await page.evaluate(()=>(window as unknown as {bodyTestCanvas:HTMLCanvasElement}).bodyTestCanvas.getContext('webgl2')?.isContextLost())).toBe(true)
  await card.click()
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
})

test('an older background response cannot replace a newly saved scan',async({page})=>{
  const token=await login(page)
  await seed(page,token,'training_strain')
  await seed(page,token,'baseline')
  await page.goto('/app/body-map')
  await expect(page.getByTestId('body-scene')).toHaveAttribute('data-renderer','ready')
  // The online refresh must start after initial history releases the in-flight guard.
  await page.getByRole('button',{name:'歷史比較',exact:true}).click()
  await expect.poll(() => page.getByLabel('比較掃描',{exact:true}).locator('option').count()).toBeGreaterThan(1)
  await expect(page.getByRole('button',{name:'模擬掃描',exact:true})).toBeEnabled()
  let release!:()=>void, captured!:()=>void
  const held=new Promise<void>(resolve=>{release=resolve})
  const fetched=new Promise<void>(resolve=>{captured=resolve})
  await page.route('**/v1/body-scans/latest',async route=>{
    const response=await route.fetch()
    captured()
    await held
    await route.fulfill({response})
  })
  try {
    await page.evaluate(()=>window.dispatchEvent(new Event('online')))
    await fetched
    await page.getByLabel('掃描情境',{exact:true}).selectOption('recovery')
    await page.getByRole('button',{name:'模擬掃描',exact:true}).click()
    await expect(page.getByTestId('body-composition')).toContainText('32.7')
    const history=page.waitForResponse(response=>response.url().endsWith('/v1/body-scans?limit=20'))
    release()
    await history
    await page.evaluate(()=>new Promise(requestAnimationFrame))
    expect(await page.getByTestId('body-composition').textContent()).toContain('32.7')
    expect(await page.locator('.body-finding-tags').first().textContent()).toContain('恢復中')
  } finally {release()}
})

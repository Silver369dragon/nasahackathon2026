import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

test('controls attach without autoplay, require monitor auth and CSRF, and retain finished/disconnected state', {timeout:60000}, async () => {
  let authorized = false, starts = 0, stops = 0, offline = false;
  const startCommands = [];
  let state = {id:'previous-run',datasetId:'crew-demo/1',status:'completed',durationMs:300000,elapsedMs:300000,accepted:1505,
    activities:[{crewId:'kai',activity:'rest',next:'rest',phase:'rest',phaseStartMs:180000}]};
  const root = fileURLToPath(new URL('.',import.meta.url));
  const server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    const json = (status,data) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if (url.pathname.endsWith('/prepare')) return res.writeHead(204).end();
    if (url.pathname === '/v1/session') {
      if (req.method === 'POST') authorized = true;
      return authorized?json(200,{data:{username:'monitor',roles:['monitor'],csrfToken:'test-csrf'}}):json(401,{error:{message:'Sign in'}});
    }
    if (url.pathname.endsWith('/demo/playback/start') || url.pathname.endsWith('/demo/playback/stop')) {
      if (!authorized || req.headers['x-csrf-token'] !== 'test-csrf') return json(403,{error:{message:'CSRF required'}});
      let body = '';
      for await (const chunk of req) body += chunk;
      const command = JSON.parse(body);
      assert.match(command.commandId,/^[a-f0-9-]{36}$/);
      if (url.pathname.endsWith('/start')) {
        startCommands.push(command.commandId);
        if (startCommands.length === 1) return json(503,{error:{message:'Retry request'}});
      }
      if (url.pathname.endsWith('/start')) {starts++;state={...state,id:'new-run',status:'playing',elapsedMs:0,accepted:5};}
      else {stops++;state={...state,status:'stopped'};}
      return json(200,{data:state});
    }
    if (url.pathname.endsWith('/demo/playback')) return offline?json(503,{error:{message:'Service offline'}}):json(200,{data:state});
    if (url.pathname === '/stations/display/board') return res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><title>Board</title>');
    if (url.pathname.startsWith('/stations/')) return json(200,{data:{scan:null}});
    const target = path.resolve(root,'.'+(url.pathname === '/'?'/index.html':url.pathname));
    if (!target.startsWith(root)) return res.writeHead(403).end();
    try {
      const content = await readFile(target);
      const mime = {'.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.html':'text/html'};
      res.writeHead(200,{'Content-Type':mime[path.extname(target)] || 'application/octet-stream'}).end(content);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.goto(base+'/playback.html');
    await page.waitForFunction(() => document.getElementById('status').textContent === '播放完成');
    assert.equal(await page.locator('#progress').getAttribute('value'),'300000');
    assert.equal(await page.locator('#start').isDisabled(),true);
    assert.equal(starts,0);
    await page.locator('input[name="password"]').fill('test-only');
    await page.locator('#sign-in').click();
    await page.waitForFunction(() => !document.getElementById('start').disabled);
    assert.equal(await page.locator('#login').isVisible(),false);
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('error').textContent === 'Retry request');
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('start').disabled);
    assert.equal(await page.locator('#start').textContent(),'重試開始要求');
    await page.locator('#start').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '播放中');
    assert.equal(starts,1);
    assert.equal(startCommands.length,2);
    assert.equal(startCommands[0],startCommands[1]);
    state={...state,elapsedMs:121000,accepted:610,activities:[{crewId:'kai',activity:'recovery',next:'rest',phase:'recovery',phaseStartMs:120000}]};
    await page.waitForFunction(() => document.getElementById('counts').textContent.includes('02:01'));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('counts').textContent.includes('02:01'));
    assert.equal(starts,1);
    offline=true;
    await page.waitForFunction(() => document.getElementById('status').textContent === '播放連線中斷');
    assert.equal(await page.locator('#progress').getAttribute('value'),'121000');
    assert.equal(await page.locator('#start').isDisabled(),true);
    offline=false;
    await page.waitForFunction(() => !document.getElementById('stop').disabled);
    await page.locator('#stop').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === '已停止');
    assert.equal(stops,1);
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth),390);
    await page.screenshot({path:fileURLToPath(new URL('../tmp/health-demo-v3/3d-controls.png',import.meta.url)),fullPage:true});
    const cabin = await browser.newPage();
    cabin.on('pageerror',error => errors.push(error.message));
    await cabin.goto(base+'/');
    await cabin.waitForFunction(() => window.demoDiagnostics?.().playback?.id === 'new-run');
    assert.equal(await cabin.locator('#pause').isVisible(),false);
    assert.equal(await cabin.locator('#speed').isDisabled(),true);
    assert.equal(await cabin.evaluate(() => window.demoDiagnostics().simulationTime),121);
    assert.deepEqual(await cabin.evaluate(() => window.demoDiagnostics().crewIds),['lin','kai','mira','noa','sol']);
    await cabin.reload();
    await cabin.waitForFunction(() => window.demoDiagnostics?.().playback?.status === 'stopped');
    assert.equal(starts,1);
    await cabin.locator('#more').click();
    await cabin.screenshot({path:fileURLToPath(new URL('../tmp/health-demo-v3/3d-cabin.png',import.meta.url))});
    await cabin.goto(base+'/?mode=simulation');
    await cabin.waitForFunction(() => window.demoDiagnostics?.().frame > 2);
    await cabin.locator('#more').click();
    await cabin.locator('#pause').click();
    assert.equal(await cabin.evaluate(() => window.demoDiagnostics().paused),true);
    assert.equal(await cabin.locator('#speed').isDisabled(),false);
    assert.equal(await cabin.evaluate(() => window.demoDiagnostics().playback),null);
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { playbackRequest } from './dataset-playback.mjs';

test('narrow proxy preserves backend session, CSRF and status without creating a player', async () => {
  const seen = [];
  const backend = http.createServer((req,res) => {
    seen.push({url:req.url,method:req.method,cookie:req.headers.cookie,csrf:req.headers['x-csrf-token']});
    res.writeHead(202,{'Content-Type':'application/json',...(req.url === '/v1/session'?{'Set-Cookie':'health_session=new-token; Path=/; HttpOnly; SameSite=Strict'}:{})});
    res.end(JSON.stringify({data:{id:'persisted',status:'completed',elapsedMs:300000}}));
  });
  await new Promise(resolve => backend.listen(0,'127.0.0.1',resolve));
  const upstream = `http://127.0.0.1:${backend.address().port}`;
  const proxy = http.createServer((req,res) => playbackRequest(req,res,req.url,upstream));
  await new Promise(resolve => proxy.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  try {
    const headers = {Origin:base,Cookie:'ship_station=wrong; health_session=right-token','X-CSRF-Token':'csrf','Content-Type':'application/json'};
    let response = await fetch(base+'/api/playback',{headers});
    assert.equal(response.status,202);
    assert.equal((await response.json()).data.elapsedMs,300000);
    response = await fetch(base+'/v1/demo/playback/start',{method:'POST',headers,body:'{}'});
    assert.equal(response.status,202);
    await response.arrayBuffer();
    assert.deepEqual(seen.at(-1),{url:'/v1/demo/playback/start',method:'POST',cookie:'health_session=right-token',csrf:'csrf'});
    response = await fetch(base+'/v1/session',{method:'POST',headers,body:'{}'});
    assert.match(response.headers.get('set-cookie'),/^health_session=new-token;/);
    await response.arrayBuffer();
    response = await fetch(base+'/api/playback/stop',{method:'POST',headers:{...headers,Origin:'http://untrusted.invalid'},body:'{}'});
    assert.equal(response.status,403);
    response = await fetch(base+'/v1/anything',{headers});
    assert.equal(response.status,404);
    assert.equal(seen.length,3);
  } finally {
    await Promise.all([new Promise(resolve => proxy.close(resolve)),new Promise(resolve => backend.close(resolve))]);
  }
});

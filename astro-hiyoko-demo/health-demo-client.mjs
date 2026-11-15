class DemoApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

/** @param {string} path
 * @param {{body?:unknown, token?:string, signal?:AbortSignal}} options */
export async function demoApi(path, {body, token, signal} = {}) {
  const response = await fetch(path, {
    method:body === undefined?'GET':'POST', credentials:'same-origin', cache:'no-store',
    signal:signal ?? AbortSignal.timeout(12000),
    headers:{Accept:'application/json', ...(body === undefined?{}:{'Content-Type':'application/json'}), ...(token?{'X-CSRF-Token':token}:{})},
    ...(body === undefined?{}:{body:JSON.stringify(body)}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new DemoApiError(payload?.error?.message || (typeof payload?.error === 'string'?payload.error:'無法取得播放狀態'),response.status);
  }
  return payload?.data ?? payload;
}

export function createDemoReader() {
  let prepared = false;
  return async function read() {
    if (!prepared) {
      const ready = await fetch('/stations/display/prepare', {
        method:'POST', headers:{'X-Ship-Setup':'1'}, signal:AbortSignal.timeout(12000),
      });
      if (!ready.ok) throw new Error('無法連線醫療服務；保留最後已提交進度。');
      prepared = true;
    }
    try { return await demoApi('/stations/display/v1/demo/playback'); }
    catch (error) { if (error.status === 401) prepared = false; throw error; }
  };
}

// @ts-check
import {t} from './i18n.js';

/** @typedef {import('../health-system/web/src/radiation').RadiationSnapshot} RadiationSnapshot */

// Presentation only. The server owns mission time and all dose calculations.
/**
 * @param {{setRadiationSnapshot(snapshot: RadiationSnapshot | null): void, radiationCanvas: HTMLCanvasElement}} equipment
 * @param {{children: Array<{isHemisphereLight?: boolean, color?: {set(value: string): void}}>}} scene
 */
export function createRadiationMonitor(equipment, scene) {
  /** @type {RadiationSnapshot | null} */
  let snapshot = null;
  /** @type {HTMLElement | null} */
  let container = null;
  let connected = false;
  /** @param {string} selector @param {string} value */
  function label(selector,value) {
    const element=container?.querySelector(selector);
    if(element)element.textContent=value;
  }
  function refresh() {
    const live = connected && navigator.onLine && snapshot?.environment.sourceStatus === 'fresh' &&
      Date.now() - Date.parse(snapshot.checkpointAt) <= 5000;
    const display = snapshot && {...snapshot, environment:{...snapshot.environment, sourceStatus:live?'fresh':'unavailable'}};
    equipment.setRadiationSnapshot(display);
    const warning = live && snapshot.environment.radiationEvent !== 'background';
    scene.children.find(object=>object.isHemisphereLight)?.color?.set(warning?'#ffcb7c':'#d8efff');
    if (!container?.isConnected || !container.querySelector('#radiation-rate')) return;
    /** @type {Record<string,string>} */
    const labels={background:'Background',elevated_exposure:'Elevated Exposure',radiation_event:'Radiation Event'};
    label('#radiation-rate', live && snapshot && snapshot.environment.rateUsvH != null ? snapshot.environment.rateUsvH.toFixed(1) : '—');
    label('#radiation-event', t(live && snapshot ? labels[snapshot.environment.radiationEvent] : 'Data unavailable'));
    label('#radiation-increment', live && snapshot && snapshot.sharedExposure.currentMsv != null ? snapshot.sharedExposure.currentMsv.toFixed(4)+' mSv' : '—');
    label('#radiation-saved', snapshot?.checkpointAt ?? '—');
    container.querySelector('canvas')?.getContext('2d')?.drawImage(equipment.radiationCanvas,0,290,1280,300,0,0,1280,300);
  }
  let timer = setInterval(refresh,1000);
  window.addEventListener('pagehide',()=>clearInterval(timer));
  window.addEventListener('pageshow',event=>{if(event.persisted){clearInterval(timer);timer=setInterval(refresh,1000);refresh();}});
  return {
    /** @param {RadiationSnapshot | null} next @param {string} status */
    receive(next,status) {
      if (!snapshot || !next || next.missionId !== snapshot.missionId || next.version >= snapshot.version) snapshot=next;
      connected=status==='connected'; refresh();
    },
    /** @param {HTMLElement} target */
    open(target) {
      container=target;
      container.innerHTML=`<section class="radiation-enlarged"><h2>${t('Space Radiation Monitoring')} <small>SIMULATION</small></h2>
        <p>${t('Current Radiation Dose Equivalent Rate')}</p><strong class="radiation-display-value"><span id="radiation-rate">—</span> μSv/h</strong>
        <p id="radiation-event"></p><p>${t('Shared increment')}: <span id="radiation-increment"></span></p>
        <canvas id="radiation-canvas" width="1280" height="300" aria-label="Radiation dose equivalent rate trend"></canvas>
        <p>${t('Last saved')}: <span id="radiation-saved"></span></p><p>${t('Shared exposure estimate; no medical safety threshold.')}</p>
        <a href="/health/system" target="_blank" rel="noopener">${t('Open monitoring station')}</a></section>`;
      refresh();
    },
  };
}

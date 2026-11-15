import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronUp, CircleDot, History, Layers3, ScanLine, Shield, Sparkles, TriangleAlert } from 'lucide-react'
import { stamp, tx, type Lang, type Session } from './domain'
import { activeFindings, bodyNumber, compareScans, fatPercent, presetLabels, regionLabel, regions,
  type BodyFinding, type BodyLayer, type RegionCode, type ScanPreset, type ValueComparison } from './body-map'
import { useBodyScans } from './useBodyScans'
import { BodyLoadBoundary } from './BodyLoadBoundary'
import { BodySilhouette } from './BodySilhouette'
import './body-map.css'

const BodyScene = lazy(() => import('./BodyScene'))
const layers: [BodyLayer,string,string][] = [['overview','Overview','總覽'],['muscle','Muscle','肌肉'],['fat','Fat','脂肪']]
function rememberedRegion(key: string): RegionCode | null {
  try { return regions.find(r => r.code === sessionStorage.getItem(key))?.code ?? null } catch { return null }
}
function Delta({value,lang}: {value: ValueComparison;lang: Lang}) {
  if (value.delta == null) return <span className="body-delta muted">{tx(lang,'Not comparable','無可比較資料')}</span>
  const Icon = value.delta > 0 ? ArrowUp : value.delta < 0 ? ArrowDown : Check
  return <span className="body-delta"><Icon size={12}/>{value.delta > 0 ? '+' : ''}{value.delta.toFixed(value.delta !== 0 && Math.abs(value.delta)<.1 ? 2 : 1)}</span>
}
function Finding({item,lang,onSelect}: {item: BodyFinding;lang:Lang;onSelect:(code:RegionCode)=>void}) {
  const names = {strain:['Muscle strain','肌肉拉傷'],bruise:['Bruise','挫傷'],abrasion:['Abrasion','擦傷']}
  const statuses = {active:['Active','需注意'],recovering:['Recovering','恢復中'],resolved:['Resolved','已恢復']}
  const severity = {mild:['Mild','輕度'],moderate:['Moderate','中度'],severe:['Severe','重度']}
  const local = (pair:string[]) => tx(lang,pair[0],pair[1])
  return <article className={'body-finding '+item.status}>
    <button className="body-finding-title" onClick={() => onSelect(item.regionCode)}>
      <span className="body-finding-dot"/><strong>{regionLabel(item.regionCode,lang)} · {local(names[item.kind])}</strong><ArrowUpRight size={16}/>
    </button>
    <div className="body-finding-tags"><span>{local(statuses[item.status])}</span><span>{local(severity[item.severity])}</span></div>
    <p>{item.functionalImpact === 'reduced_load' ? tx(lang,'Reduced capacity under load','負重活動受到影響')
      : item.functionalImpact === 'improving_mobility' ? tx(lang,'Mobility is improving','活動能力逐步恢復') : item.functionalImpact}</p>
    <small>{tx(lang,'Since ','發生於 ')}{stamp(item.onsetAt,lang)}</small>
  </article>
}

type Panel = 'region'|'injury'

export default function BodyMap({session,lang,deny,back,tabbed=false}: {session:Session;lang:Lang;deny:()=>void;back:()=>void;tabbed?:boolean}) {
  const data = useBodyScans(session,deny)
  const t = (en:string,zh:string) => tx(lang,en,zh)
  const regionKey = 'orbital-body-region:'+session.username
  const [selectedRegion,setSelectedRegion] = useState<RegionCode|null>(() => rememberedRegion(regionKey))
  const [layer,setLayer] = useState<BodyLayer>('overview')
  const [scanId,setScanId] = useState<string|null>(null)
  const [previousId,setPreviousId] = useState<string|null>(null)
  const [historyOpen,setHistoryOpen] = useState(false)
  const [expanded,setExpanded] = useState(false)
  const [preset,setPreset] = useState<ScanPreset>('baseline')
  // Phone layout opens on the body model and scan controls; a panel shows only after a tab or region is chosen.
  const [panel,setPanel] = useState<Panel|null>(null)
  const gripStart = useRef<number|null>(null)
  const swiped = useRef(false)
  const details = useRef<HTMLElement>(null)
  const scan = data.items.find(s => s.id === scanId) ?? data.latest
  const historical = !!scan && !!data.latest && scan.id !== data.latest.id
  const index = data.items.findIndex(s => s.id === scan?.id)
  const previous = previousId ? data.items.find(s => s.id === previousId) ?? null : data.items[index+1] ?? null
  const comparison = scan ? compareScans(scan,previous,selectedRegion) : null
  const findings = scan?.findings.filter(f => !selectedRegion || f.regionCode === selectedRegion) ?? []
  const attention = activeFindings(scan)
  const selectedReading = selectedRegion ? scan?.regions[selectedRegion] : null
  useEffect(() => {
    try {
      if (selectedRegion) sessionStorage.setItem(regionKey,selectedRegion)
      else sessionStorage.removeItem(regionKey)
    } catch { /* Selection is still available for this page. */ }
  },[regionKey,selectedRegion])
  const startScan = async () => {
    const result = await data.scan(preset)
    if (result) { setScanId(null); setPreviousId(null) }
  }
  const selectScan = (id:string) => {setScanId(id || null);setPreviousId(null)}
  const reveal = () => {setExpanded(v => !v)}

  const historyPanel = <section className="body-history-panel" id="body-history" aria-label={t('Scan comparison','掃描比較')}>
      <div className="body-history-title"><span><History size={16}/>{t('Compare your scans','看見身體的變化')}</span><small>{data.items.length} {t('loaded','筆紀錄')}</small></div>
      <div className="body-history-selects"><label>{t('Viewing','目前檢視')}<select aria-label={t('Viewing scan','目前掃描')} value={scanId ?? ''} onChange={e=>selectScan(e.target.value)}>
        <option value="">{t('Latest scan','最新掃描')}</option>{data.items.filter(s=>s.id!==data.latest?.id).map((s,i)=><option key={s.id} value={s.id}>{t('Scan','掃描')} {data.items.length-i-1} · {stamp(s.observedAt,lang)}</option>)}</select></label>
        <label>{t('Compare with','比較對象')}<select aria-label={t('Comparison scan','比較掃描')} value={previousId ?? ''} onChange={e=>setPreviousId(e.target.value||null)}>
          <option value="">{t('Previous scan (automatic)','前一次掃描（自動）')}</option>{data.items.filter(s=>s.id!==scan?.id).map(s=><option key={s.id} value={s.id}>{stamp(s.observedAt,lang)} · {s.id.slice(0,4)}</option>)}</select></label></div>
      {previous ? <p>{t('Difference from','差異比較基準：')}{stamp(previous.observedAt,lang)}</p> : <p>{t('Save a second scan to compare.','再保存一次掃描，就能比較前後變化。')}</p>}
      {data.nextCursor && <button className="body-more" onClick={()=>void data.more()} disabled={data.loadingMore}>{t('Load older scans','載入更早紀錄')}<ChevronDown size={15}/></button>}
    </section>
  const scanPanel = <>
        <div className="body-scan-controls">
          <label><span>{t('Scan scenario','掃描情境')}</span><select aria-label={t('Scan scenario','掃描情境')} value={data.pending?.preset ?? preset} disabled={data.scanning||!!data.pending} onChange={e=>setPreset(e.target.value as ScanPreset)}>
            {Object.entries(presetLabels).map(([id,pair])=><option key={id} value={id}>{t(pair[0],pair[1])}</option>)}</select></label>
          <button className="body-scan-button" onClick={()=>void startScan()} disabled={!data.demoEnabled||data.scanning}>
            <ScanLine size={19}/>{data.scanning?t('Scanning…','掃描中…'):data.pending?t('Retry scan','重試掃描'):t('Simulate scan','模擬掃描')}</button>
        </div>
        {data.error && <p className="body-notice" role="alert">{t('Scan delivery is unconfirmed. Retry the same request safely.','尚未確認掃描結果。重試會查核同一筆請求，不會重複保存。')}</p>}
        {data.loaded&&!data.demoEnabled && <p className="body-scan-disabled">{t('Simulation is disabled on this server. Saved scans remain available.','此伺服器未開啟模擬掃描，仍可閱讀已保存的紀錄。')}</p>}
  </>
  const regionPart = <>
        <div className="body-detail-title"><div><p className="body-eyebrow">{selectedRegion?t('REGION DETAIL','部位詳情'):t('YOUR BODY','全身狀態')}</p>
          <h2 data-testid="body-region-title">{selectedRegion?regionLabel(selectedRegion,lang):t('Whole body','全身總覽')}</h2></div>
          {selectedRegion?<button className="body-clear" onClick={()=>setSelectedRegion(null)}>{t('Whole body','回到全身')}</button>:<Shield size={24} strokeWidth={1.3}/>}</div>
        {!scan && <p className="body-empty">{t('Your first scan starts here. Explore the body, then run a simulated scan.','從第一次掃描開始。你可以先探索人體，再進行模擬掃描。')}</p>}
        <div className="body-composition" data-testid="body-composition">
          <div><span>{t('Muscle mass','肌肉量')}</span><strong>{bodyNumber(comparison?.muscleMassKg.current)}<small>kg</small></strong>{comparison&&previous&&<Delta value={comparison.muscleMassKg} lang={lang}/>}</div>
          <div><span>{t('Fat mass','脂肪量')}</span><strong>{bodyNumber(comparison?.fatMassKg.current)}<small>kg</small></strong>{comparison&&previous&&<Delta value={comparison.fatMassKg} lang={lang}/>}</div>
        </div>
        {!selectedRegion && <div className="body-total-strip"><span>{t('Body mass','身體質量')}<b>{bodyNumber(scan?.totals.bodyMassKg)} kg</b></span><span>{t('Body fat','體脂率')}<b>{bodyNumber(fatPercent(scan))}%</b></span></div>}
        {selectedRegion&&scan&&(!selectedReading||selectedReading.quality!=='good')&&<p className="body-missing" role="status"><TriangleAlert size={15}/>{t('This region has no usable reading.','此部位尚無可用的量測資料。')}</p>}
        <div className="body-region-picker"><label htmlFor="body-region">{t('Explore a region','選擇身體部位')}</label><select id="body-region" value={selectedRegion??''} onChange={e=>setSelectedRegion((e.target.value||null) as RegionCode|null)}>
          <option value="">{t('Whole body','全身總覽')}</option>{regions.map(r=><option key={r.code} value={r.code}>{regionLabel(r.code,lang)}</option>)}</select></div>
  </>
  const injuryPart = <>
        <div className="body-findings-header"><h3>{t('Injury observations','傷勢觀察')}</h3><span>{activeFindings(scan,selectedRegion).length}</span></div>
        {findings.length?findings.map(item=><Finding key={item.id} item={item} lang={lang} onSelect={setSelectedRegion}/>):<div className="body-no-findings"><Shield size={20}/><p>{scan?t('No injuries recorded in this scan.','本次掃描未記錄傷勢。'):t('Awaiting scan observations','等待掃描結果')}</p></div>}
        <div className="body-attention" hidden={!selectedRegion||attention.length===0}><button onClick={()=>setSelectedRegion(null)}>{t('View all observations','查看全身傷勢觀察')}<ArrowUpRight size={14}/></button></div>
  </>
  const extraPart = <>
        <button className="body-detail-expand" aria-expanded={expanded} onClick={reveal}>{t('Comparison & scan details','比較與掃描細節')}{expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>
        {expanded&&<div className="body-detail-extra">
          {comparison&&<div className="body-comparison-table" data-testid="body-comparison"><div><span>{t('Measure','項目')}</span><span>{t('Current','目前')}</span><span>{t('Previous','前次')}</span><span>Δ kg</span></div>
            {(['muscleMassKg','fatMassKg'] as const).map(key=><div key={key}><span>{key==='muscleMassKg'?t('Muscle','肌肉'):t('Fat','脂肪')}</span><b>{bodyNumber(comparison[key].current)}</b><span>{bodyNumber(comparison[key].previous)}</span><Delta value={comparison[key]} lang={lang}/></div>)}</div>}
          {!previous&&<p>{t('A second scan is needed for comparison.','需要第二次掃描才能比較。')}</p>}
          {previous&&<p>{t('Compared with ','比較對象：')}{stamp(previous.observedAt,lang)}</p>}
          <dl><dt>{t('Source','資料來源')}</dt><dd>{t('Orbital scanner · simulated','船內掃描器・模擬資料')}</dd><dt>{t('Observed','掃描時間')}</dt><dd>{scan?stamp(scan.observedAt,lang):'—'}</dd><dt>{t('Quality','資料品質')}</dt><dd>{!scan?'—':selectedRegion?selectedReading?.quality==='good'?t('Available','可用'):t('Unavailable','未取得'):t('See each region','依部位顯示')}</dd></dl>
        </div>}
  </>
  const tabs: [Panel,string,string,typeof Layers3][] = [['region','Body overview','全身總覽',Layers3],['injury','Injuries','傷勢觀察',TriangleAlert]]

  return <section className={'body-console'+(tabbed?' tabbed'+(panel?' panel-open':''):'')} data-testid="body-map">
    <header className="body-heading">
      <div className="body-heading-title"><button className="body-back" onClick={back} aria-label={t('Back to overview','返回個人總覽')}><ArrowLeft size={19}/></button>
        <div><p className="body-eyebrow">PERSONAL BIOLOGY / 01</p><h1>{t('Body hologram','身體全息圖')}</h1></div></div>
      <button className={'body-history-toggle '+(historyOpen?'active':'')} onClick={() => setHistoryOpen(v=>!v)} aria-expanded={historyOpen} aria-controls="body-history"><History size={17}/>{t('History','歷史比較')}</button>
    </header>
    <div className="body-scan-meta"><span><span className={'body-live-dot '+(data.offline?'offline':'')}/>{session.username.toUpperCase()}<span className="body-synthetic">{t('SIMULATED','模擬資料')}</span></span>
      <span>{!data.loaded ? t('Connecting…','連線中…') : scan ? stamp(scan.observedAt,lang) : t('No scans yet','尚無掃描紀錄')}</span></div>
    <div className="body-mobile-summary"><span>{t('Muscle','肌肉')}<b>{bodyNumber(scan?.totals.muscleMassKg)}<small>kg</small></b></span><span>{t('Fat','脂肪')}<b>{bodyNumber(scan?.totals.fatMassKg)}<small>kg</small></b></span><span>{t('Observations','傷勢觀察')}<b>{scan?attention.length:'—'}<small>{t('regions','處')}</small></b></span></div>
    {data.offline && <div className="body-notice" role="status">{t('Connection unavailable. Showing the last received scan.','暫時無法連線，保留最後取得的掃描資料。')}<button onClick={() => void data.refresh(true)}>{t('Reconnect','重新連線')}</button></div>}
    {historical && <div className="body-history-banner"><History size={15}/>{t('Historical scan','歷史掃描')}<button onClick={() => selectScan('')}>{t('Return to latest','回到最新')}</button></div>}
    {historyOpen && historyPanel}
    <div className="body-workbench">
      <div className="body-visual-column">
        <div className="body-layer-tabs" role="group" aria-label={t('Body layers','身體圖層')}>
          {layers.map(([id,en,zh])=><button key={id} onClick={()=>setLayer(id)} aria-pressed={id===layer} data-testid={'body-layer-'+id}>{id==='overview'?<Layers3 size={16}/>:id==='muscle'?<Sparkles size={16}/>:<CircleDot size={16}/>}{t(en,zh)}</button>)}
        </div>
        <BodyLoadBoundary fallback={<>
          <div className="body-notice" role="status" data-testid="body-renderer-unavailable">
            {t('3D view could not load. You can still select regions in the 2D view.', '3D 檢視載入失敗，仍可使用平面圖選擇部位與閱讀資料。')}
            <button onClick={() => window.location.reload()}>{t('Reload page','重新載入頁面')}</button>
          </div>
          <div className="body-viewport"><div className="body-fallback">
            <BodySilhouette selected={selectedRegion} scan={scan} onSelect={setSelectedRegion} lang={lang}/>
          </div></div>
        </>}>
          <Suspense fallback={<div className="body-viewport body-model-status">{t('Preparing your body view…','正在準備人體檢視…')}</div>}>
            <BodyScene scan={scan} layer={layer} selectedRegion={selectedRegion} onSelect={setSelectedRegion} lang={lang} scanning={data.scanning}/>
          </Suspense>
        </BodyLoadBoundary>
        <div className="body-legend"><span className={'body-gradient '+layer}/><span>{layer==='overview'?t('Body overview','身體總覽'):layer==='muscle'?t('Regional muscle mass · kg','分區肌肉量・kg'):t('Regional fat mass · kg','分區脂肪量・kg')}</span><span className="body-legend-missing"/>{t('Unavailable','未取得')}</div>
        {scanPanel}
      </div>
      {!tabbed ? <article className={'body-detail '+(expanded?'expanded':'')} ref={details}>
        <button className="body-sheet-grip" aria-label={expanded?t('Collapse details','收合詳情'):t('Expand details','展開詳情')} aria-expanded={expanded}
          onClick={()=>{if(swiped.current){swiped.current=false;return}reveal()}} onPointerDown={e=>{gripStart.current=e.clientY;swiped.current=false;e.currentTarget.setPointerCapture(e.pointerId)}} onPointerUp={e=>{
            if(gripStart.current!==null&&Math.abs(e.clientY-gripStart.current)>20){setExpanded(e.clientY<gripStart.current);swiped.current=true}
            gripStart.current=null
          }}><span/>{expanded?<ChevronDown size={16}/>:<ChevronUp size={16}/>}</button>
        {regionPart}
        {injuryPart}
        {extraPart}
      </article> : <>
        <div className="body-tabs" role="tablist" aria-label={t('Body details','身體資料')}>
          {tabs.map(([id,en,zh,Icon])=><button key={id} role="tab" aria-selected={panel===id} aria-controls={'body-panel-'+id} data-testid={'body-tab-'+id}
            className={panel===id?'selected':''} onClick={()=>setPanel(current=>current===id?null:id)}>
            <Icon size={18} aria-hidden="true"/><span>{id==='region'&&selectedRegion?regionLabel(selectedRegion,lang):t(en,zh)}</span>
            {id==='injury'&&<b>{scan?attention.length:'—'}</b>}</button>)}
        </div>
        <div className="body-detail body-tab-panel" id="body-panel-region" role="tabpanel" hidden={panel!=='region'}>{regionPart}{extraPart}</div>
        <div className="body-detail body-tab-panel" id="body-panel-injury" role="tabpanel" hidden={panel!=='injury'}>{injuryPart}</div>
      </>}
    </div>
    <div className="body-footer"><span>ORBITAL · BODY SCAN</span><span>{t('Your body, over time.','看見身體，與它的變化。')}</span></div>
  </section>
}

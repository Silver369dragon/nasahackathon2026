import { useEffect, useRef, useState } from 'react'
import { api, ApiError, newId, restricted } from './api'
import { stamp, tx, type Lang, type PersonalAnalysis, type Session } from './domain'
import { baselineEligibility, baselineState, canActivateBaseline, type BaselineLifecycle } from './baseline-lifecycle'

type Props = {measurementId:string; referenceTo:string; analysisId?:string; lang:Lang; session:Session; deny:()=>void; refresh:()=>void}
export function BaselineControls(props: Props) {
  const {measurementId,referenceTo,analysisId,lang,session,deny,refresh} = props
  const t = (en:string,zh:string)=>tx(lang,en,zh)
  const [state,setState] = useState<BaselineLifecycle | null>(null)
  const [reason,setReason] = useState('')
  const [cutoff,setCutoff] = useState(referenceTo.slice(0,16))
  const [from,setFrom] = useState(''), [to,setTo] = useState('')
  const [busy,setBusy] = useState(false), [failed,setFailed] = useState(false), [retry,setRetry] = useState(0)
  const [actionError,setActionError] = useState<string | null>(null)
  const [recalculated,setRecalculated] = useState<PersonalAnalysis | null>(null)
  const command = useRef<{signature:string;id:string} | null>(null)
  const flight = useRef(false)
  useEffect(()=>{
    const controller = new AbortController()
    void api<BaselineLifecycle>('/baselines?'+new URLSearchParams({measurementId}),{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted){setState(data);setFailed(false)}
    }).catch(e=>{if(!controller.signal.aborted){if(restricted(e))deny();else setFailed(true)}})
    return ()=>controller.abort()
  },[measurementId,referenceTo,deny,retry])
  async function act(action:string) {
    if(!state || !reason.trim() || flight.current) return
    const target = action==='activate' ? state.candidateId : state.activeId ?? state.candidateId
    const payload:Record<string,unknown> = {expectedRevision:state.revision,reason:reason.trim()}
    let path:string
    if(action==='propose') {
      if(!cutoff) return
      path='/baselines/candidates/new'
      Object.assign(payload,{measurementId,referenceTo:new Date(cutoff+'Z').toISOString()})
    } else if(action==='recalculate') {
      if(!analysisId || !state.activeId) return
      path='/analyses/'+encodeURIComponent(analysisId)+'/recalculate'
      payload.baselineId=state.activeId
    } else {
      if(!target) return
      path='/baselines/'+encodeURIComponent(target)+'/actions'
      payload.action=action
      if(action==='exclude') {
        if(!from || !to || from>=to) return
        Object.assign(payload,{from:new Date(from+'Z').toISOString(),to:new Date(to+'Z').toISOString()})
      }
    }
    const signature=JSON.stringify({path,payload})
    if(command.current?.signature!==signature)command.current={signature,id:newId()}
    flight.current=true;setBusy(true);setFailed(false);setActionError(null)
    try{
      const result=await api<BaselineLifecycle | PersonalAnalysis>(path,{body:{...payload,commandId:command.current.id},token:session.csrfToken})
      if(action==='recalculate')setRecalculated(result as PersonalAnalysis)
      else setState(result as BaselineLifecycle)
      command.current=null;setRetry(n=>n+1);refresh()
    }catch(e){
      if(restricted(e))deny()
      else {setActionError(e instanceof ApiError ? e.code ?? 'unknown' : 'unknown');if(e instanceof ApiError && [409,422].includes(e.status)){command.current=null;setRetry(n=>n+1)}}
    }finally{setBusy(false);flight.current=false}
  }
  const frozen=state?.baseline?.status==='frozen'
  const errorText = actionError==='ACTIVE_ALERT' ? t('A related training alert is still active. Review it before resuming or activating a baseline.','相關訓練警示仍有效；請先檢視警示，再解除凍結或啟用基準。') :
    actionError==='REVISION_CONFLICT' ? t('The baseline changed. Review the refreshed version before trying again.','基準已變更。請審閱重新載入的版本後再操作。') :
    actionError==='BASELINE_FROZEN' ? t('Resume the frozen baseline before activating a replacement.','請先解除基準凍結，再啟用替代版本。') :
    t('Could not complete the baseline action. Check its current state and inputs, then retry.','無法完成基準操作。請核對目前狀態與輸入後重試。')
  return <details className="disclosure baseline-controls"><summary>{t('Baseline versions and review','基準版本與審核')}</summary>
    {!state && !failed && <p>{t('Loading baseline versions…','正在讀取基準版本…')}</p>}
    {(failed || actionError) && <p role="alert">{errorText} <button onClick={()=>setRetry(n=>n+1)}>{t('Refresh','重新整理')}</button></p>}
    {state && <>
      <p data-testid="baseline-lifecycle-status">{baselineState(state.status,lang)} · {t('Revision','修訂')} {state.revision}</p>
      {state.baseline && <p>{t('Current reference','現行基準')} v{state.baseline.version} · {baselineState(state.baseline.status,lang)}</p>}
      <fieldset disabled={busy}><legend>{t('Record the reason for this change','記錄變更原因')}</legend>
        <label>{t('Reason','原因')}<input value={reason} maxLength={180} onChange={e=>setReason(e.target.value)}/></label>
        <label>{t('Candidate cutoff (UTC)','候選基準截止（UTC）')}<input type="datetime-local" value={cutoff} onChange={e=>setCutoff(e.target.value)}/></label>
        <button className="secondary" disabled={!reason.trim() || !cutoff} onClick={()=>void act('propose')}>{t('Prepare baseline candidate','建立基準候選')}</button>
        {state.candidate && <div data-testid="baseline-candidate">
          <p>{t('Candidate','候選')} v{state.candidate.version} · {baselineState(state.candidate.status,lang)}<br/>
            {stamp(state.candidate.from,lang)} – {stamp(state.candidate.to,lang)}<br/>
            n={state.candidate.count} · {t('Mean','平均')} {state.candidate.mean ?? '—'} · SD={state.candidate.sd ?? '—'} · {state.candidate.excludedCount ?? 0} {t('excluded samples','筆排除樣本')}</p>
          {state.candidate.eligibilityReason && <p>{baselineEligibility(state.candidate.eligibilityReason,lang)}</p>}
          <button className="secondary" disabled={!reason.trim() || !canActivateBaseline(state)} onClick={()=>void act('activate')}>{t('Approve and activate candidate','審核並啟用候選')}</button>
          {frozen && <p>{t('Resume the frozen baseline before activating a replacement.','啟用替代版本前，須先解除基準凍結。')}</p>}
        </div>}
        {state.activeId && <div className="baseline-actions">
          <button className="secondary" disabled={!reason.trim()} onClick={()=>void act(frozen?'resume':'freeze')}>{frozen?t('Resume baseline','解除基準凍結'):t('Freeze baseline','凍結基準')}</button>
          <button className="secondary" disabled={!reason.trim()} onClick={()=>void act('unwell')}>{t('Record feeling unwell and freeze','記錄身體不適並凍結')}</button>
          <button className="secondary" disabled={!reason.trim()} onClick={()=>void act('retire')}>{t('Retire baseline','停用基準')}</button>
        </div>}
        {(state.activeId || state.candidateId) && <>
          <p>{t('Exclude a period from future baseline candidates. Existing results stay unchanged.','從之後的基準候選排除指定期間。既有結果保持不變。')}</p>
          <label>{t('Exclude from (UTC)','排除起點（UTC）')}<input type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></label>
          <label>{t('Exclude to (UTC)','排除終點（UTC）')}<input type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></label>
          <button className="secondary" disabled={!reason.trim() || !from || !to || from>=to} onClick={()=>void act('exclude')}>{t('Save exclusion period','保存排除期間')}</button>
        </>}
        {analysisId && state.activeId && <>
          <p>{t('Recalculate this observation with the current baseline as a separate single-observation revision. Its EWMA starts a new segment. Original evidence remains readable.',
            '以現行基準重算這筆觀察，另存單筆修訂。EWMA 從新段開始，原始分析仍可讀取。')}</p>
          <button className="secondary" disabled={!reason.trim()} onClick={()=>void act('recalculate')}>{t('Save recalculated revision','另存重算修訂')}</button>
          {recalculated && <p role="status">{t('Saved revision','已保存修訂')} {recalculated.id} · Z={recalculated.z ?? '—'} · EWMA={recalculated.ewma ?? '—'}</p>}
        </>}
      </fieldset>
      <details><summary>{t('Version history and exclusions','版本歷史與排除期間')}</summary>
        <ul>{state.versions.map(v=><li key={v.id}>v{v.version} · {baselineState(v.status,lang)} · n={v.count} · {v.reason}</li>)}</ul>
        <ul>{state.exclusions.map(e=><li key={e.id}>{stamp(e.from,lang)} – {stamp(e.to,lang)} · {e.reason}</li>)}</ul>
      </details>
      <details><summary>{t('Audit history','操作歷史')}</summary><ul>{state.audit.map(a=><li key={a.id}>{stamp(a.createdAt,lang)} · {a.action} · {a.reason}</li>)}</ul></details>
    </>}
  </details>
}

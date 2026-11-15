import { tx, type Lang, type PersonalBaseline } from './domain.ts'

export type BaselineVersion = Omit<PersonalBaseline,'mean' | 'sd'> & {
  mean: number | null; sd: number | null; status: string; reason?: string
  eligibilityReason?: string | null; excludedCount?: number
}
export type BaselineLifecycle = {
  seriesKey: string; revision: number; status: string; activeId: string | null; candidateId: string | null
  baseline: BaselineVersion | null; candidate: BaselineVersion | null; versions: BaselineVersion[]
  exclusions: { id: string; from: string; to: string; reason: string; kind: string; createdAt: string }[]
  audit: { id: string; action: string; baselineId: string | null; revision: number; reason: string; triggerEventId: string | null; createdAt: string }[]
}
export function baselineState(state: string, lang: Lang) {
  const names: Record<string,[string,string]> = {
    collecting: ['Collecting comparable samples','收集同條件樣本'],
    ready_for_review: ['Ready for review','待審核'], active: ['Active','使用中'],
    frozen: ['Frozen; fixed-reference analysis continues','已凍結；仍用固定參數分析'],
    rebuilding: ['Preparing replacement; current baseline retained','重建候選中；保留現行基準'],
    retired: ['Retired; history retained','已停用；歷史保留'],
  }
  return names[state] ? tx(lang,...names[state]) : state
}
export function canActivateBaseline(state: BaselineLifecycle) {
  return state.candidate?.status === 'ready_for_review' && state.baseline?.status !== 'frozen'
}
export function baselineEligibility(reason:string | null | undefined,lang:Lang) {
  const messages:Record<string,[string,string]>={
    profile_required:['Real measurements require a separately approved baseline profile.','實測資料須另有核准的基準設定。'],
    insufficient_samples:['At least 30 comparable valid samples are required.','至少需要 30 筆同條件有效樣本。'],
    zero_variance:['The samples have no variation; Z-score cannot be calculated.','樣本沒有變異，無法計算 Z 分數。'],
    variance_too_small:['Sample variation is too small for this training profile.','樣本變異不足以使用此訓練設定。'],
  }
  return reason ? messages[reason] ? tx(lang,...messages[reason]) : reason : ''
}

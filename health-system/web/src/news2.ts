import { tx, type Lang } from './domain.ts'

export const inputNames = {
  respiratory_rate: ['Respiratory rate', '呼吸頻率'], spo2: ['Oxygen saturation', '血氧飽和度'],
  spo2_scale: ['SpO₂ scale', '適用血氧尺度'], blood_pressure_systolic: ['Systolic pressure', '收縮壓'],
  heart_rate: ['Heart rate', '心率'], neurological_assessment: ['Consciousness (ACVPU)', '意識狀態（ACVPU）'],
  temperature: ['Temperature', '體溫'], supplemental_oxygen: ['Supplemental oxygen', '補氧狀態'],
  observationSeconds: ['Breathing observation duration', '呼吸觀察秒數'],
  temperatureSite: ['Temperature site', '體溫量測部位'], temperatureMethod: ['Temperature method', '體溫量測方法'],
  scale2Documented: ['Documented clinical selection of Scale 2', '尺度 2 的醫療指定紀錄'],
} as const
export type Field = keyof typeof inputNames
export type Vital = 'respiratory_rate' | 'spo2' | 'heart_rate' | 'temperature' | 'blood_pressure_systolic'
export const vitalCodes: Vital[] = ['respiratory_rate','spo2','blood_pressure_systolic','heart_rate','temperature']
export const scoreFields = ['respiratory_rate','spo2','blood_pressure_systolic','heart_rate',
  'neurological_assessment','temperature','supplemental_oxygen'] as const
type ScoreField = typeof scoreFields[number]
type RiskBand = 'low' | 'low_medium' | 'medium' | 'high'
type InputValue = string | number | boolean | null
type ScoringSnapshot = {
  ruleSetVersion?: string | null; normalizationVersion?: string | null; requestedProfile?: string
  configurationIssues?: string[]
  componentScores?: Partial<Record<ScoreField,number | null>>
  scoringInputs?: Partial<Record<Field,InputValue>>
  riskBand?: RiskBand | null; singleHighParameters?: ScoreField[]; interpretationVersion?: string | null
  scoringSource?: string | null; interpretationSource?: string | null
}
export type ScoringConfiguration = ScoringSnapshot & { enabled: boolean }
export const units: Partial<Record<Field, string>> = {
  respiratory_rate: '/min', observationSeconds: 's', spo2: '%', blood_pressure_systolic: 'mmHg',
  heart_rate: 'bpm', temperature: '°C',
}
export const choices: Partial<Record<Field, [string, string, string][]>> = {
  spo2_scale: [['scale1','Scale 1','尺度 1'],['scale2','Scale 2','尺度 2']],
  scale2Documented: [['true','Documented by clinician','已有醫療人員指定紀錄'],['false','Unconfirmed','尚未確認']],
  supplemental_oxygen: [['false','Room air','呼吸環境空氣'],['true','Receiving supplemental oxygen','正在使用補充氧氣']],
  neurological_assessment: [['A','Alert','清醒'],['C','New confusion','新發混亂'],['V','Responds to voice','對聲音有反應'],
    ['P','Responds to pain','對疼痛有反應'],['U','Unresponsive','無反應']],
  temperatureSite: [['oral','Oral','口腔'],['axillary','Axillary','腋下'],['tympanic','Tympanic','耳溫']],
}
export const nameOf = (field: Field, lang: Lang) => inputNames[field][lang === 'en' ? 0 : 1]
export function valueOf(field: Field, value: string | number | boolean | null, lang: Lang) {
  if (value == null) return '—'
  const match = choices[field]?.find(row => row[0] === String(value))
  return match ? tx(lang, match[1], match[2]) : String(value) + (units[field] ? ' ' + units[field] : '')
}
export type AssessmentSummary = {
  id: string; crewId: string; version: number; observedAt: string; updatedAt: string
  assessmentStatus: 'incomplete' | 'configuration_required' | 'scored'; validCount: number
  missingInputs: Field[]; invalidInputs: Field[]; missingDetails: Field[]; news2Score: number | null
  vitalReadings?: Partial<Record<Field,number>>
} & ScoringSnapshot
export type Assessment = AssessmentSummary & {
  inputs: Record<Field,InputValue>; effectiveInputs: Assessment['inputs']
  poorQuality: Field[]; measurementIds: Partial<Record<Vital,string>>
  invalidReasons: Partial<Record<Field, 'missing_context' | 'unusable_quality' | 'outside_training_window'>>
  linkedRecords: Partial<Record<Vital, {id: string; value: number | null; observedAt: string; source: string; quality: string; method: string; observationSeconds?: number | null}>>
}
export function assessmentText(a: Pick<AssessmentSummary,'news2Score'>, lang: Lang) {
  if (a.news2Score == null) return tx(lang, 'Full total unavailable', '完整總分未提供')
  return tx(lang, 'Training NEWS2 total: ', '訓練 NEWS2 總分：') + a.news2Score
}
export function interpretationFor(a: ScoringSnapshot & {news2Score:number | null}): {riskBand:RiskBand | null;singleHighParameters:ScoreField[]} {
  if(a.ruleSetVersion!=='rcp-news2-2017-training-v1') return {riskBand:null,singleHighParameters:[]}
  const singleHighParameters = a.singleHighParameters ?? scoreFields.filter(k=>a.componentScores?.[k]===3)
  const score=a.news2Score
  const riskBand=score==null ? null : a.interpretationVersion && a.riskBand !== undefined ? a.riskBand :
    score>=7 ? 'high' : score>=5 ? 'medium' : singleHighParameters.length ? 'low_medium' : 'low'
  return {riskBand,singleHighParameters}
}
export function interpretationNote(a:ScoringSnapshot,lang:Lang) {
  if(a.ruleSetVersion!=='rcp-news2-2017-training-v1' || a.interpretationVersion)return ''
  return tx(lang,'Chart comparison from saved scores; the original record did not save this classification.',
    '依保存分數進行圖表對照；原紀錄未保存這項分級。')
}
export function riskBandText(band:RiskBand | null,lang:Lang) {
  if(band==null)return tx(lang,'Unclassified: full total unavailable','無法分級：完整總分不可用')
  const labels:Record<RiskBand,[string,string]>={low:['Low','低'],low_medium:['Low–medium','低至中'],medium:['Medium','中'],high:['High','高']}
  return tx(lang,'RCP chart band (training): ','RCP 圖表分級（訓練）：')+tx(lang,...labels[band])
}
export function configurationText(a: ScoringSnapshot, lang: Lang) {
  if (a.ruleSetVersion === 'news2-training-completeness-v1')
    return tx(lang, 'Legacy completeness record; no saved score', '舊版完整度紀錄，未保存計分')
  if (a.configurationIssues?.includes('unknown_scoring_profile'))
    return tx(lang, 'Unsupported scoring version', '不支援此計分版本')
  if (a.configurationIssues?.some(issue => ['scoring_profile_disabled','scoring_profile_not_enabled'].includes(issue)))
    return tx(lang, 'Scoring disabled', '計分已停用')
  if (!a.ruleSetVersion)
    return tx(lang, 'Legacy completeness record; no saved score', '舊版完整度紀錄，未保存計分')
  return a.ruleSetVersion
}
export function problemText(a: AssessmentSummary, lang: Lang) {
  const join = (fields: Field[]) => fields.map(k => nameOf(k,lang)).join(lang === 'en' ? ', ' : '、')
  return [a.missingInputs.length ? tx(lang, 'Missing: ', '尚缺：') + join(a.missingInputs) : '',
    a.invalidInputs.length ? tx(lang, 'Recheck: ', '需複核：') + join(a.invalidInputs) : '',
    a.missingDetails.length ? tx(lang, 'Also record: ', '需補記：') + join(a.missingDetails) : '',
  ].filter(Boolean).join(' · ')
}

import { tx, type Lang } from './domain'

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
export type Vital = 'spo2' | 'heart_rate' | 'temperature' | 'blood_pressure_systolic'
export const vitalCodes: Vital[] = ['spo2','blood_pressure_systolic','heart_rate','temperature']
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
  assessmentStatus: 'incomplete' | 'configuration_required'; validCount: number
  missingInputs: Field[]; invalidInputs: Field[]; missingDetails: Field[]; news2Score: null
  vitalReadings?: Partial<Record<Field,number>>
}
export type Assessment = AssessmentSummary & {
  inputs: Record<Field,string | number | boolean | null>; effectiveInputs: Assessment['inputs']
  poorQuality: Field[]; measurementIds: Partial<Record<Vital,string>>
  invalidReasons: Partial<Record<Field, 'missing_context' | 'unusable_quality' | 'outside_training_window'>>
  linkedRecords: Partial<Record<Vital, {id: string; value: number | null; observedAt: string; source: string; quality: string; method: string}>>
}
export function problemText(a: AssessmentSummary, lang: Lang) {
  const join = (fields: Field[]) => fields.map(k => nameOf(k,lang)).join(lang === 'en' ? ', ' : '、')
  return [a.missingInputs.length ? tx(lang, 'Missing: ', '尚缺：') + join(a.missingInputs) : '',
    a.invalidInputs.length ? tx(lang, 'Recheck: ', '需複核：') + join(a.invalidInputs) : '',
    a.missingDetails.length ? tx(lang, 'Also record: ', '需補記：') + join(a.missingDetails) : '',
  ].filter(Boolean).join(' · ')
}

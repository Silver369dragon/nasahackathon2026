import { tx, type Lang } from './domain'

const labels: Record<string, [string, string]> = {
  good: ['Good', '良好'],
  poor: ['Poor quality', '品質不佳'],
  missing: ['Missing', '缺值'],
  invalid: ['Invalid', '無效'],
  fresh: ['Fresh', '最新'],
  stale: ['Stale', '已過期'],
  no_data: ['No data', '尚無資料'],
  last_measurement: ['Last measurement', '最近量測'],
  manual: ['Manual', '人工'],
  mock: ['Mock', '模擬器'],
  synthetic: ['Synthetic', '合成'],
  scenario: ['Scenario', '情境'],
  seated: ['Seated', '坐姿'],
  standing: ['Standing', '站姿'],
  supine: ['Supine', '仰臥'],
  rest: ['Rest', '休息'],
  exercise: ['Exercise', '運動'],
  recovery: ['Recovery', '恢復'],
  fingertip: ['Fingertip', '指尖'],
  earlobe: ['Earlobe', '耳垂'],
  oral: ['Oral', '口腔'],
  axillary: ['Axillary', '腋下'],
  tympanic: ['Tympanic', '耳溫'],
  peripheral: ['Peripheral', '周邊'],
  core: ['Core', '核心'],
  surface: ['Surface', '表面'],
  manual_training_entry: ['Manual entry', '人工輸入'],
  mock_generated: ['Mock generated', '模擬器產生'],
  emergency: ['Emergency monitoring', '緊急監測'],
  daily: ['Daily monitoring', '每日監測'],
  long_term: ['Long-term monitoring', '長期監測'],
  connected: ['Connected', '已連線'],
  offline: ['Offline', '離線'],
  syncing: ['Synchronizing', '同步中'],
  online: ['Online', '在線'],
  hardware: ['Hardware', '實體裝置'],
  replay: ['Replay', '重播'],
  wokwi: ['Wokwi', 'Wokwi 模擬韌體'],
}

export function label(key: string, lang: Lang) {
  const pair = labels[key]
  return pair ? tx(lang, ...pair) : key.replaceAll('_', ' ')
}

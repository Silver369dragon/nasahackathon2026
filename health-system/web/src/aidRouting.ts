export type AidTarget = 'unresponsive' | 'severe-bleeding' | 'first-aid'

const unresponsive = /無反應|沒(?:有)?反應|叫不醒|喚不醒|叫不動|沒有意識|失去意識|意識喪失|昏(?:倒|迷|厥)|沒(?:有)?呼吸|呼吸停止|停止呼吸|沒有正常呼吸|(?:心跳|心搏)停止|心臟驟停|心肺復甦|胸外按壓|\b(?:unresponsive|unconscious|collapsed|cardiac arrest|cpr|aed|chest compressions?|(?:isn'?t|not|stopped|no longer) (?:breathing|responding)|no (?:pulse|breathing|response)|won't wake(?: up)?|can(?:not|'t) (?:wake|rouse)|passed out|only gasping)\b/giu
const bleeding = /(?:嚴重|大量|危及生命的?|大)?外?出血|流血|血流(?:不止|不停|止不住|不斷)|血一直流|血止不住|噴血|血.{0,3}噴出|止血|\b(?:(?:(?:severe|heavy|major|uncontrolled|massive|profuse|external|life[- ]threatening) )?bleeding|(?:stop|control) (?:the )?bleeding|blood (?:is )?(?:spurting|gushing|pouring)|tourniquet)\b/giu
const general = /急救|緊急求助|救命|救人|緊急狀況|緊急情況|\b(?:first[- ]aid|medical emergency|emergency help|choking|help me now)\b/giu
const negated = /(?:\b(?:no|not|never|without|denies|isn't|aren't|wasn't|weren't|don't|doesn't)(?:\s+(?:an?y?|longer|currently|actually|having|need|signs? of))*\s+|(?:並非|不是|並無|沒有|否認|不需(?:要)?|不用|不曾|未曾|未|無|沒)\s*)$/iu
const equipment = /(?:感測器|裝置|系統|螢幕|網頁|按鈕|程式|設備|儀器|sensor|device|screen|app|button|monitor|system|server)\s*(?:(?:is|has|seems|became|was|does|will|突然|好像|一直|完全|現在)\s*)*$/iu

function mentions(clause: string, pattern: RegExp, ignoreEquipment = false) {
  for (const match of clause.matchAll(pattern)) {
    const before = clause.slice(0, match.index)
    if (negated.test(before) || (ignoreEquipment && equipment.test(before))) continue
    return true
  }
  return false
}

/** Routes to fixed local cards. Opening a card never sends an emergency notification. */
export function detectFirstAid(message: string): AidTarget | null {
  const text = message.normalize('NFKC').toLowerCase().replaceAll('’', "'").trim()
  const clauses = text.split(/[,.!?;，。！？；\n]|\+(?=\s)|\b(?:but|however)\b|但是|但|不過/u)
  const arrest = clauses.some(part => mentions(part, unresponsive, true))
  const blood = clauses.some(part => mentions(part, bleeding))
  if (arrest && blood) return 'first-aid'
  if (arrest) return 'unresponsive'
  if (blood) return 'severe-bleeding'
  if (clauses.some(part => mentions(part, general)) || /^help(?: me)?[!.? ]*$/u.test(text)) return 'first-aid'
  return null
}

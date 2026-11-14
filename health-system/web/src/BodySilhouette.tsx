import type { Lang } from './domain'
import { activeFindings, regionLabel, type BodyScan, type RegionCode } from './body-map'

// The fallback shares the exact same anatomical identifiers as the 3D model.
const shapes: [RegionCode, string][] = [
  ['head','M90 20 Q100 12 110 20 L112 40 Q100 55 88 40 Z'], ['neck','M94 48 H106 L109 62 H91 Z'],
  ['chest','M75 63 Q100 56 125 63 L120 95 H80 Z'], ['abdomen','M80 97 H120 L116 124 H84 Z'],
  ['pelvis','M84 126 H116 L122 150 L102 157 L98 157 L78 150 Z'], ['back','M75 63 Q100 56 125 63 L116 124 H84 Z'],
  ['right_shoulder','M73 62 L83 68 L76 82 L62 78 Z'], ['left_shoulder','M127 62 L117 68 L124 82 L138 78 Z'],
  ['right_upper_arm','M62 80 L76 84 L64 116 L52 112 Z'], ['left_upper_arm','M138 80 L124 84 L136 116 L148 112 Z'],
  ['right_forearm','M52 115 L64 119 L55 149 L45 146 Z'], ['left_forearm','M148 115 L136 119 L145 149 L155 146 Z'],
  ['right_hand','M44 148 L55 152 L51 171 Q39 175 39 167 Z'], ['left_hand','M156 148 L145 152 L149 171 Q161 175 161 167 Z'],
  ['right_thigh','M78 152 L98 159 L96 201 L79 201 Z'], ['left_thigh','M122 152 L102 159 L104 201 L121 201 Z'],
  ['right_knee','M79 204 H96 V218 H79 Z'], ['left_knee','M104 204 H121 V218 H104 Z'],
  ['right_lower_leg','M79 221 H96 L93 268 H81 Z'], ['left_lower_leg','M104 221 H121 L119 268 H107 Z'],
  ['right_foot','M81 271 H94 L96 287 H76 Q73 280 81 271Z'], ['left_foot','M106 271 H119 Q127 280 124 287 H104 Z'],
]
export function BodySilhouette({ back = false, selected = null, scan = null, onSelect, lang = 'zh-TW' }: {
  back?: boolean; selected?: RegionCode | null; scan?: BodyScan | null; onSelect?: (code: RegionCode) => void; lang?: Lang
}) {
  const findings = activeFindings(scan)
  return <svg viewBox="0 0 200 305" className="body-silhouette" aria-label={lang === 'en' ? 'Body map' : '身體部位圖'}>
    <g transform={back ? 'translate(200 0) scale(-1 1)' : undefined}>
      {shapes.filter(([code]) => back ? !['chest','abdomen'].includes(code) : code !== 'back').map(([code,d]) => {
        const unavailable = !!scan && scan.regions[code]?.quality !== 'good'
        return <path key={code} d={d}
        className={[selected === code ? 'selected' : '', findings.some(f => f.regionCode === code) ? 'injured' : '', unavailable ? 'unavailable' : ''].join(' ')}
        role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={regionLabel(code,lang)}
        aria-description={unavailable ? (lang === 'en' ? 'Reading unavailable' : '量測資料未取得') : undefined}
        onClick={() => onSelect?.(code)} onKeyDown={event => {
          if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(code) }
        }}/>
      })}
    </g>
  </svg>
}

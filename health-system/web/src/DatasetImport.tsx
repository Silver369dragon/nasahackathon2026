import { useRef, useState, type ChangeEvent } from 'react'
import { FileJson, Upload } from 'lucide-react'
import { api, ApiError, restricted } from './api'
import { stamp, tx, type Lang, type Session } from './domain'
import { radiationNumber } from './radiation'
import './dataset-import.css'

type Dataset = Record<string, unknown> & { schemaVersion: 'crew-dataset/1'; datasetId: string }
type ImportResult = { datasetId: string; radiation?: Record<string, unknown> | null; body?: Record<string, unknown> | null; measurements?: number | null }
type RadiationArchive = {
  datasetId: string
  profiles: { crewId: string; experienceYears: number; importedHistoryMsv: number; importedHistoryDays: number }[]
  environment: { timestamp: string; rateUsvH: number; cumulativeMsv: number; radiationEvent: string }[]
}
const maxFileBytes = 32 * 1024 * 1024

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function counts(value: unknown) {
  if (Array.isArray(value)) return String(value.length)
  if (!isObject(value)) return ''
  return Object.entries(value).filter(([, item]) => Array.isArray(item))
    .map(([key, item]) => `${key}: ${(item as unknown[]).length}`).join(' · ')
}

function summary(value: Record<string, unknown>) {
  return Object.entries(value).filter(([, item]) => typeof item === 'number')
    .map(([key, item]) => `${key}: ${item}`).join(' · ')
}

function Archive({ data, lang }: { data: RadiationArchive; lang: Lang }) {
  const t = (en: string, zh: string) => tx(lang, en, zh)
  const events: Record<string, string> = { background: t('Background', '背景輻射'), elevated_exposure: t('Elevated exposure', '暴露升高'), radiation_event: t('Radiation event', '輻射事件') }
  const transitions = data.environment.filter((point, index, points) =>
    index === 0 || index === points.length - 1 || point.radiationEvent !== points[index - 1].radiationEvent)
  return <div className="dataset-archive" data-testid="dataset-radiation-archive">
    <h3>{t('Imported radiation archive', '已匯入的輻射封存資料')} · Simulation</h3>
    <p>{t('Values below belong to this dataset and are separate from live mission readings.', '以下數值屬於本資料集，與即時任務讀值分開顯示。')}</p>
    <div className="dataset-table-scroll"><table><caption>{t('Crew experience and imported exposure history', '船員年資與本次匯入的暴露歷史')}</caption><thead><tr>
      <th>{t('Crew', '船員')}</th><th>{t('Years of service', '年資')}</th><th>{t('Exposure days', '暴露天數')}</th><th>{t('Historical dose', '歷史劑量')} (mSv)</th>
    </tr></thead><tbody>{data.profiles.map(profile => <tr key={profile.crewId}>
      <td>{profile.crewId}</td><td>{profile.experienceYears}</td><td>{radiationNumber(profile.importedHistoryDays, 1)}</td><td>{radiationNumber(profile.importedHistoryMsv, 4)}</td>
    </tr>)}</tbody></table></div>
    <div className="dataset-table-scroll"><table data-testid="dataset-radiation-transitions"><caption>{t('Environment series · start, event changes, and end', '環境時間序列 · 起點、事件轉換與終點')} ({data.environment.length} {t('total samples', '筆原始資料')})</caption><thead><tr>
      <th>{t('Time', '時間')}</th><th>μSv/h</th><th>{t('Cumulative', '累積')} mSv</th><th>{t('Event', '事件')}</th>
    </tr></thead><tbody>{transitions.map((point, index) => <tr key={point.timestamp + ':' + index}>
      <td>{stamp(point.timestamp, lang)}</td><td>{radiationNumber(point.rateUsvH, 3)}</td><td>{radiationNumber(point.cumulativeMsv, 4)}</td><td>{events[point.radiationEvent] ?? point.radiationEvent}</td>
    </tr>)}</tbody></table></div>
  </div>
}

export function DatasetImport({ session, lang, deny }: { session: Session; lang: Lang; deny: () => void }) {
  const [selected, setSelected] = useState<{ fileName: string; data: Dataset } | null>(null)
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const [archive, setArchive] = useState<RadiationArchive | null>(null)
  const [archiveError, setArchiveError] = useState(false)
  const selection = useRef(0)
  const t = (en: string, zh: string) => tx(lang, en, zh)

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    const version = ++selection.current
    setSelected(null)
    setResult(null)
    setArchive(null)
    setArchiveError(false)
    setError('')
    if (!file) return
    if (file.size > maxFileBytes) {
      setError(t('Choose a JSON file of 32 MiB or smaller.', '請選擇不超過 32 MiB 的 JSON 檔案。'))
      return
    }
    setReading(true)
    try {
      const data: unknown = JSON.parse(await file.text())
      if (version !== selection.current) return
      if (!isObject(data) || data.schemaVersion !== 'crew-dataset/1' || typeof data.datasetId !== 'string' || !data.datasetId.trim()) {
        setError(t('The file needs schemaVersion "crew-dataset/1" and a non-empty datasetId.', '檔案需包含 schemaVersion「crew-dataset/1」與非空白的 datasetId。'))
        return
      }
      if (!['radiation', 'body', 'measurements'].some(key => data[key] != null)) {
        setError(t('The dataset contains no radiation, body, or measurement section.', '資料集未包含輻射、身體掃描或生命徵象資料。'))
        return
      }
      setSelected({ fileName: file.name, data: data as Dataset })
    } catch {
      if (version === selection.current) setError(t('The file could not be read as JSON. Check its format and try again.', '無法將檔案讀取為 JSON，請檢查格式後重試。'))
    } finally {
      if (version === selection.current) setReading(false)
    }
  }

  async function importDataset() {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const saved = await api<ImportResult>('/datasets/import', {
        body: selected.data, token: session.csrfToken, signal: AbortSignal.timeout(120000),
      })
      setResult(saved)
      if (saved.radiation) {
        try {
          setArchive(await api<RadiationArchive>('/datasets/radiation?datasetId=' + encodeURIComponent(saved.datasetId), { signal: AbortSignal.timeout(15000) }))
        } catch (err) {
          if (restricted(err)) deny()
          else setArchiveError(true)
        }
      }
    } catch (err) {
      if (restricted(err)) deny()
      else setError(err instanceof ApiError && err.status < 500
        ? t('Import rejected: ', '匯入未受理：') + err.message
        : t('Import is unconfirmed. Retry the same file to confirm its saved status.', '尚未確認匯入結果。請重試同一檔案，以確認保存狀態。'))
    } finally {
      setBusy(false)
    }
  }

  return <section className="panel dataset-import" data-testid="dataset-import">
    <div className="dataset-import-heading"><FileJson size={21}/><h2>{t('Import crew dataset', '匯入船員資料集')}</h2></div>
    <p>{t('Choose one historical JSON dataset from the data team. The system routes its sections to radiation, body scans, and measurements. Observation times must be in the past.', '選擇資料團隊提供的一份歷史資料 JSON，系統會將內容分送至輻射、身體掃描與生命徵象資料。觀測時間必須早於現在。')}</p>
    <label className="dataset-file-label">{t('Dataset file · JSON · up to 32 MiB', '資料集檔案 · JSON · 上限 32 MiB')}
      <input type="file" accept=".json,application/json" disabled={busy || reading} onChange={event => void choose(event)} data-testid="dataset-file"/>
    </label>
    {reading && <p role="status">{t('Reading file…', '正在讀取檔案…')}</p>}
    {selected && <div className="dataset-preview" data-testid="dataset-preview">
      <strong>{selected.fileName}</strong><span>{t('Dataset ID', '資料集識別碼')}：{selected.data.datasetId}</span>
      <ul>{(['radiation', 'body', 'measurements'] as const).filter(key => selected.data[key] != null).map(key => <li key={key}>
        {key === 'radiation' ? t('Radiation', '輻射') : key === 'body' ? t('Body scans', '身體掃描') : t('Measurements', '生命徵象')}
        {counts(selected.data[key]) && <span> · {counts(selected.data[key])}</span>}
      </li>)}</ul>
      <p>{t('Selecting a file does not upload it. Import validates and saves the entire dataset.', '選取檔案尚未上傳；按下匯入後，系統會驗證並保存整份資料。')}</p>
      <button className="primary" disabled={busy || !!result} onClick={() => void importDataset()} data-testid="dataset-submit">
        <Upload size={16}/>{busy ? t('Importing…', '匯入中…') : t('Import dataset', '匯入資料集')}
      </button>
      {busy && !result && <p role="status">{t('Validating and saving the dataset. Large files may take up to two minutes; keep this page open.', '正在驗證並保存資料集。大型檔案可能需要最多兩分鐘，請保持此頁面開啟。')}</p>}
    </div>}
    {error && <p className="notice" role="alert">{error}</p>}
    {result && <div className="dataset-result" role="status" data-testid="dataset-result">
      <strong>{t('Dataset saved', '資料集已保存')} · {result.datasetId}</strong>
      {(['radiation', 'body'] as const).map(key => result[key] && <p key={key}>{key}: {summary(result[key])}</p>)}
      {typeof result.measurements === 'number' && <p data-testid="dataset-measurement-count">{t('Measurements saved', '已保存的生命徵象量測')}：{result.measurements}</p>}
      {result.radiation && <p>{t('Radiation data is archived; the live mission simulation remains separate.', '輻射資料已存入封存資料集；即時任務模擬另行顯示。')}</p>}
    </div>}
    {archiveError && <p className="notice" role="alert">{t('The dataset was saved, but the radiation archive could not be loaded.', '資料集已保存，但目前無法載入輻射封存資料。')}</p>}
    {archive && <Archive data={archive} lang={lang}/>}
  </section>
}

import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { api, restricted, stationBase } from './api'
import { stamp, tx, type Lang } from './domain'
import { activeFindings, bodyNumber, type LatestScan } from './body-map'
import './body-map.css'

export function BodyOverview({lang,open,deny}: {lang:Lang;open:()=>void;deny:()=>void}) {
  const [data,setData] = useState<LatestScan|null>(null)
  useEffect(()=>{
    const controller=new AbortController()
    void api<LatestScan>('/body-scans/latest',{signal:controller.signal}).then(result=>{
      if(!controller.signal.aborted)setData(result)
    }).catch(err=>{if(!controller.signal.aborted&&restricted(err))deny()})
    return()=>controller.abort()
  },[deny])
  const scan=data?.scan
  return <button className="body-home-card" onClick={open} data-testid="body-overview-card">
    <span className="body-home-art"><img src={stationBase+'/body/preview.png?v=hologram-2'} alt=""/></span>
    <span className="body-home-copy"><span className="body-eyebrow">BODY HOLOGRAM</span><strong>{tx(lang,'My body','我的身體')}</strong>
      <span className="body-home-description">{scan?stamp(scan.observedAt,lang):tx(lang,'Explore your body. Discover what has changed.','探索身體各部位，看見每一次變化。')}</span>
      <span className="body-home-stats"><span>{tx(lang,'Muscle','肌肉')} {bodyNumber(scan?.totals.muscleMassKg)} kg</span><span>{tx(lang,'Fat','脂肪')} {bodyNumber(scan?.totals.fatMassKg)} kg</span>
        {scan&&<span>{activeFindings(scan).length} {tx(lang,'observations','處需注意')}</span>}</span>
    </span><ArrowUpRight size={22}/>
  </button>
}

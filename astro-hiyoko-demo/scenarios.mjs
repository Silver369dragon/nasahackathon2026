export function scenarioReadings(samples,incident){
 return samples.map(c=>{
  const affected=incident?.crewId===c.id||incident?.type==='radiation';
  const offline=affected&&incident.type==='offline',environmental=affected&&incident.type==='radiation';
  return {...c,flag:!!affected,fallDetected:!!affected&&incident.type==='collapse',environmentalWarning:!!environmental,dataQuality:offline?'missing':'simulated',motion:offline?'unknown':affected&&incident.type==='collapse'?'immobile':'routine',heart:offline?null:environmental?c.heart:affected?(incident.type==='collapse'?48:112):c.heart,oxygen:offline?null:affected&&incident.type==='collapse'?94:c.oxygen,temperature:offline?null:c.temperature,eventId:affected?incident.id:null,eventState:affected?(incident.acknowledged?'acknowledged':'active'):null,source:'simulation'};
 });
}

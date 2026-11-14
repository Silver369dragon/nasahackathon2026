import {SHIP_SCALE} from './config.mjs';
export const exchanges=[
 ['The view never gets old.','Neither does watching you photograph it.'],
 ['Tea break after this shift?','Yes. This time, tether the cup.'],
 ['Another lap around the planet.','And still no traffic.'],
 ['The seedlings have new leaves.','Our smallest crew members are thriving.'],
 ['How was training?','My legs noticed. The window helped.'],
 ['Found my floating pen?','Check the ventilation grille. Again.'],
 ['Dinner together later?','Save me the window seat.'],
 ['All quiet on your shift?','Quiet enough to enjoy the stars.']
];
export function createSocial(){
 let active=null,next=8,count=0,lastTime=0;const pairs=new Map();
 const distance=(a,b)=>Math.hypot((a.position[0]-b.position[0])*SHIP_SCALE.x,(a.position[1]-b.position[1])*SHIP_SCALE.z);
 return {reset(){active=null;next=8;count=0;lastTime=0;pairs.clear();},update(time,routines,emergency=false){
   if(time<lastTime){this.reset();}lastTime=time;
   if(emergency){active=null;next=time+20;return null;}
   if(active&&(time-active.start>=8||distance(routines[active.a],routines[active.b])>5.5)){active=null;next=time+32;}
   if(!active&&time>=next){
     for(let a=0;a<routines.length&&!active;a++)for(let b=a+1;b<routines.length&&!active;b++){
       const ra=routines[a],rb=routines[b],key=`${a}/${b}`;
       // Encounters must share the corridor or a room: never talk through cabin walls.
       const sameZone=(Math.abs(ra.position[1])<.65&&Math.abs(rb.position[1])<.65)||(Math.sign(ra.position[1])===Math.sign(rb.position[1])&&Math.abs(ra.position[0]-rb.position[0])<1.6&&Math.abs(ra.position[1]-rb.position[1])<1.1);
       if(sameZone&&distance(ra,rb)<3.5&&time-(pairs.get(key)??-999)>120){active={a,b,start:time,index:count++%exchanges.length};pairs.set(key,time);}
     }
   }
   if(!active)return null;const turn=time-active.start<4?0:1;
   return {...active,speaker:turn?active.b:active.a,listener:turn?active.a:active.b,text:exchanges[active.index][turn],scripted:true};
 },get count(){return count;}};
}

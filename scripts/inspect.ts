import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

const level = LEVELS[0];
const e = new SimulationEngine(level) as any;
for (let i=0;i<20*30;i++) e.advance(1/30);
const states = [0,1,2,3,4];
for (const st of states) {
  const ids:number[]=[];
  for (let id=0;id<e.total;id++) if (e.state[id]===st) ids.push(id);
  console.log('state',st,'n',ids.length,'sample',ids.slice(0,10).map((id:number)=>({
    id, x:e.x[id].toFixed?.(0), y:e.y[id].toFixed?.(0), sheet:e.sheetIndex[id], cell:e.cellIndex[id], rej:e.rejectT[id].toFixed?.(1), sta:e.stamina[id].toFixed?.(0), vx:e.vx[id].toFixed?.(0), vy:e.vy[id].toFixed?.(0)
  })));
}
const s0=e.sheets[0];
let empty=0, occ=0, a=0,b=0;
for (let i=0;i<s0.occupant.length;i++){ if(s0.occupant[i]>=0)occ++; else empty++; if(s0.inspectorA[i]>=0)a++; if(s0.inspectorB[i]>=0)b++; }
console.log('sheet0 cells',{empty,occ,a,b}, 'bounds', s0.info);
const s1=e.sheets[1];
let onSpare=0; for(let id=0;id<e.total;id++) if(e.sheetIndex[id]===1 && e.state[id]<2) onSpare++;
console.log('active on spare',onSpare);

import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

const id = Number(process.argv[2] ?? 4);
const level = LEVELS.find((l) => l.id === id)!;
function run(flipTimes: number[], ctrls = false) {
  const e = new SimulationEngine(level);
  if (ctrls) { e.setFan(true); e.setLights(false); e.setTilt(0); }
  let fi=0; let guard=0;
  while (!e.completed && guard++ < 260*30) {
    e.advance(1/30);
    if (fi<flipTimes.length && e.time>=flipTimes[fi]) { e.flip(); fi++; }
  }
  const m=e.computeMetrics();
  return {flips:flipTimes.join('+')||'none', good:+ (m.goodRate*100).toFixed(1), dbl:+(m.doubleRate*100).toFixed(1), dblW:+(m.doubleWorms/m.total*100).toFixed(1), flat:m.flatSilks, t:+m.elapsed.toFixed(0), stars:e.getResult().stars};
}
const useControls = process.argv[3] !== 'raw';
const rows:any[]=[];
for (const t of [0,12,18,22,26,30,34,40,48,56]) rows.push(run(t?[t]:[], useControls));
rows.push(run([24,50],true), run([30,60],true), run([20,45,70],true));
console.table(rows);

import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

const level = LEVELS.find((l) => l.id === Number(process.argv[2] ?? 1))!;
const flipAt = Number(process.argv[3] ?? -1);
const e = new SimulationEngine(level);
let flipped = false;
for (let i = 0; i < 240 * 30 && !e.completed; i++) {
  e.advance(1 / 30);
  if (!flipped && flipAt >= 0 && e.time >= flipAt) { e.flip(); flipped = true; }
  if (i % 300 === 299) {
    const m = e.computeMetrics();
    console.log(`t=${m.elapsed.toFixed(0)} active=${m.active} search=${m.searching} insp=${m.inspecting} single=${m.singleCocoons} dblW=${m.doubleWorms} flat=${m.flatSilks} good=${(m.goodRate*100).toFixed(0)}`);
  }
}
const m = e.computeMetrics();
console.log('final', m);

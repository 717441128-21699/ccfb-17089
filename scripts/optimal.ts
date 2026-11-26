import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

function run(id: number, flips: number[], controls: boolean) {
  const level = LEVELS.find((l) => l.id === id)!;
  const e = new SimulationEngine(level);
  if (controls) {
    e.setLights(false);
    e.setFan(true);
    e.setTilt(0);
  }
  let fi = 0;
  let guard = 0;
  while (!e.completed && guard++ < 260 * 30) {
    e.advance(1 / 30);
    if (fi < flips.length && e.time >= flips[fi]) { e.flip(); fi++; }
  }
  const m = e.computeMetrics();
  return {
    id,
    strategy: controls ? `ctrl+${flips.join('/') || 'noflip'}` : 'default-noflip',
    good: +(m.goodRate * 100).toFixed(1),
    dblRate: +(m.doubleRate * 100).toFixed(1),
    flat: m.flatSilks,
    active: m.active,
    t: +m.elapsed.toFixed(0),
    stars: e.getResult().stars,
  };
}

const only = Number(process.argv[2] ?? 0);
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  console.table([
    run(level.id, [], false),
    run(level.id, [24, 52], true),
    run(level.id, [18, 42, 66], true),
  ]);
}

import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

function runStrategy(levelId: number, flips: number[], options: { lights?: boolean; fan?: boolean } = {}) {
  const level = LEVELS.find((l) => l.id === levelId)!;
  const engine = new SimulationEngine(level);
  if (options.lights !== undefined) engine.setLights(options.lights);
  if (options.fan !== undefined) engine.setFan(options.fan);
  const flipSet = [...flips].sort((a, b) => a - b);
  let flipIndex = 0;
  let guard = 0;
  while (!engine.completed && guard < 240 * 30) {
    engine.advance(1 / 30);
    while (flipIndex < flipSet.length && engine.time >= flipSet[flipIndex]) {
      engine.flip();
      flipIndex++;
    }
    guard++;
  }
  const m = engine.computeMetrics();
  return {
    level: `${level.id}.${level.name}`,
    flips: flips.join(',') || 'none',
    good: (m.goodRate * 100).toFixed(1),
    dblWorm: ((m.doubleWorms / m.total) * 100).toFixed(1),
    dblRate: (m.doubleRate * 100).toFixed(1),
    flat: m.flatSilks,
    active: m.active,
    t: m.elapsed.toFixed(0),
    stars: engine.getResult().stars,
  };
}

for (const id of [1, 2, 3, 4, 5, 6]) {
  console.table([
    runStrategy(id, []),
    runStrategy(id, [24]),
    runStrategy(id, [30]),
    runStrategy(id, [36]),
    runStrategy(id, [28, 58]),
  ]);
}

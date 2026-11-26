import { LEVELS } from '../src/game/levels.ts';
import { SimulationEngine } from '../src/sim/engine.ts';

const base = LEVELS[0];
function run(seed: number, flips: number[]) {
  const e = new SimulationEngine({ ...base, seed });
  let fi=0,g=0;
  while(!e.completed && g++<260*30){ e.advance(1/30); if(fi<flips.length&&e.time>=flips[fi]){e.flip();fi++;} }
  const m=e.computeMetrics();
  return { good:m.goodRate*100, flat:m.flatSilks, dbl:m.doubleRate*100, stars:e.getResult().stars };
}
for(let seed=24031; seed<24080; seed++){
  const no=run(seed,[]);
  if(no.good>=55 && no.good<=70){
    const opt=run(seed,[24,52]);
    if(opt.good>=90) console.log(seed, no, opt);
  }
}

import { LEVELS } from '../game/levels';
import { simClient } from '../game/client';
import { h, pct } from './dom';

type Navigate = (page: 'setup' | 'live' | 'replay' | 'result') => void;

export function renderResult(root: HTMLElement, navigate: Navigate): () => void {
  const result = simClient.result;
  const level = simClient.level ?? LEVELS.find((l) => l.id === result?.levelId) ?? LEVELS[0];
  if (!result) {
    root.replaceChildren(
      h('main', { class: 'guard panel' },
        h('h1', {}, '本关还没有评星结果'),
        h('p', {}, '先完成一匾上蔟，系统会按上茧率、双宫茧率和平板丝数量评星。'),
        h('div', { class: 'guard-actions' },
          h('button', { class: 'primary', onclick: () => navigate('setup') }, '选择关卡'),
          simClient.world ? h('button', { class: 'ghost', onclick: () => navigate('live') }, '返回实况') : null,
        ),
      ),
    );
    return () => {};
  }

  const m = result.metrics;
  const next = LEVELS.find((l) => l.id === level.id + 1);
  const t = result.thresholds.three;
  const starLabels = ['结茧未成', '勉强收蔟', '好茧满匾', '蚕状元'];

  root.replaceChildren(
    h('main', { class: 'result-page' },
      h('section', { class: `result-hero panel stars-${result.stars}` },
        h('div', { class: 'result-stars', 'aria-label': `${result.stars} 星` },
          [0, 1, 2].map((i) => h('span', { class: i < result.stars ? 'star lit' : 'star', style: `animation-delay:${0.18 + i * 0.18}s` }, '★')),
        ),
        h('div', { class: 'eyebrow' }, `第 ${level.id} 关 · ${level.name}`),
        h('h1', {}, starLabels[result.stars]),
        h('p', { class: 'result-sub' }, result.stars === 3 ? '翻蔟时机恰到好处，双宫和平板丝都被压到很低。' : result.stars === 2 ? '已经摸到好时机；再提前或延后几秒，并留意强光端。' : '蚕群在高端挤住了。试试在成团初期翻面，或先关灯开风扇。'),
        h('div', { class: 'result-actions' },
          h('button', { class: 'primary big', onclick: () => { simClient.start(level); navigate('live'); } }, '↻ 再来一次'),
          h('button', { class: 'gold big', onclick: () => navigate('replay') }, '回看单蚕轨迹'),
          next ? h('button', { class: 'ghost big', onclick: () => { simClient.start(next); navigate('live'); } }, `下一关：${next.name} →`) : h('button', { class: 'ghost big', onclick: () => navigate('setup') }, '回到关卡列表'),
        ),
      ),
      h('section', { class: 'result-grid' },
        metricCard('上茧率', pct(m.goodRate, 1), `三星线 ≥ ${pct(t.goodRate, 0)}`, m.goodRate >= t.goodRate),
        metricCard('双宫茧率', pct(m.doubleRate, 1), `三星线 ≤ ${pct(t.doubleRate, 0)}`, m.doubleRate <= t.doubleRate),
        metricCard('平板丝', `${m.flatSilks} 张`, `占 ${pct(m.flatRate, 1)} · 三星 ≤ ${pct(t.flatRate, 0)}`, m.flatRate <= t.flatRate),
      ),
      h('section', { class: 'result-detail panel' },
        h('div', {},
          h('h2', {}, '本匾账本'),
          h('div', { class: 'ledger' },
            ledgerRow('总蚕数', `${m.total}`),
            ledgerRow('单宫上茧', `${m.singleCocoons}`),
            ledgerRow('双宫茧', `${m.doubleCocoons} 颗（涉及 ${m.doubleWorms} 条）`),
            ledgerRow('平板丝', `${m.flatSilks} 张`),
            ledgerRow('手动捡蚕', `${m.rescued} 条`),
            ledgerRow('用时', `${m.elapsed.toFixed(0)} 秒`),
          ),
        ),
        h('div', { class: 'coach' },
          h('h2', {}, '老蚕农复盘'),
          h('p', {}, level.flipHint),
          h('p', {}, '一次不翻时，蚕会持续偏向当前高端，局部格位很快被占满；适时翻面后，原高端蚕群变成新下端，会重新爬向另一侧的空格里。'),
          h('div', { class: 'benchmark' },
            h('div', {}, h('strong', {}, '约 60%'), h('span', {}, '一次不翻的上茧率')),
            h('div', {}, h('strong', {}, '90%+'), h('span', {}, '合适时机翻蔟')),
          ),
          h('button', { class: 'ghost', onclick: () => navigate('setup') }, '调整蔟架布置'),
        ),
      ),
    ),
  );
  return () => {};
}

function metricCard(label: string, value: string, sub: string, pass: boolean) {
  return h('article', { class: `result-metric panel ${pass ? 'pass' : 'fail'}` },
    h('span', { class: 'metric-label' }, label),
    h('strong', {}, value),
    h('small', {}, sub),
    h('span', { class: 'pass-tag' }, pass ? '达标' : '未达标'),
  );
}

function ledgerRow(label: string, value: string) {
  return h('div', { class: 'ledger-row' }, h('span', {}, label), h('strong', {}, value));
}

import { CLUSTER_SPECS, LEVELS, layoutLevel } from '../game/levels';
import type { LevelConfig } from '../game/types';
import { simClient } from '../game/client';
import { h, pct } from './dom';

export function renderSetup(root: HTMLElement, navigate: (page: 'live' | 'setup' | 'replay' | 'result') => void) {
  let selectedId = simClient.level?.id ?? 1;
  let tilt = LEVELS[selectedId - 1]?.initialTilt ?? -10;
  let lightsOn = LEVELS[selectedId - 1]?.lightsOn ?? false;
  let fanOn = LEVELS[selectedId - 1]?.fanOn ?? true;

  const page = h('main', { class: 'setup-page' });
  root.replaceChildren(page);

  function render() {
    const level = LEVELS.find((l) => l.id === selectedId)!;
    tilt = level.initialTilt;
    lightsOn = level.lightsOn;
    fanOn = level.fanOn;
    page.replaceChildren(
      h('header', { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('div', { class: 'eyebrow' }, '蚕事解谜 · 上蔟'),
          h('h1', {}, '让每条熟蚕，自己找到一只方格'),
          h('p', { class: 'lead' }, '调蔟架倾角、把握翻蔟时机、开关灯与风扇，再把乱爬的蚕捡到空蔟片。适时翻蔟可冲上 90% 上茧率；一次不翻，通常只有六成左右。'),
          h('div', { class: 'hero-actions' },
            h('button', { class: 'primary big', onclick: () => start() }, `开始第 ${level.id} 关 · ${level.name}`),
            h('button', { class: 'ghost big', onclick: () => { selectedId = 1; render(); } }, '查看平衡样板关'),
          ),
        ),
        h('div', { class: 'hero-card' },
          h('div', { class: 'hero-stat' }, h('strong', {}, '数千条'), h('span', {}, '熟蚕独立推演')),
          h('div', { class: 'hero-stat' }, h('strong', {}, 'Web Worker'), h('span', {}, '轨迹与找格计算')),
          h('div', { class: 'hero-stat' }, h('strong', {}, 'PixiJS'), h('span', {}, '蔟片和蚕群渲染')),
        ),
      ),
      h('section', { class: 'level-strip', 'aria-label': '选择关卡' }, ...LEVELS.map((l) =>
        h('button', {
          class: `level-card ${l.id === selectedId ? 'active' : ''}`,
          onclick: () => { selectedId = l.id; render(); },
        },
          h('span', { class: 'level-no' }, `第 ${l.id} 关`),
          h('strong', {}, l.name),
          h('small', {}, l.solarTerm),
          h('span', { class: 'level-meta' }, `${l.worms.toLocaleString()} 条蚕 · ${l.placements.length} 张蔟片`),
        ),
      )),
      h('section', { class: 'setup-grid' },
        renderArrangement(level, tilt, lightsOn, fanOn, (next) => {
          tilt = next.tilt; lightsOn = next.lightsOn; fanOn = next.fanOn;
        }),
        renderBrief(level),
      ),
      h('section', { class: 'spec-section' },
        h('div', { class: 'section-title' }, h('h2', {}, '蔟片规格'), h('p', {}, '格孔大小、格数和四壁遮挡会改变试格成功率。')),
        h('div', { class: 'spec-grid' }, ...Object.values(CLUSTER_SPECS).map((spec) =>
          h('article', { class: 'spec-card' },
            h('h3', {}, spec.name),
            h('div', { class: 'spec-num' }, `${spec.cols}×${spec.rows}`),
            h('p', {}, spec.blurb),
            h('div', { class: 'meter' }, h('i', { style: `width:${spec.shelter * 100}%` })),
            h('small', {}, `遮挡 ${pct(spec.shelter, 0)} · 孔径 ${spec.aperture.toFixed(2)}`),
          ),
        )),
      ),
    );
  }

  function start() {
    const base = LEVELS.find((l) => l.id === selectedId)!;
    const configured: LevelConfig = { ...base, initialTilt: tilt, lightsOn, fanOn };
    simClient.start(configured);
    navigate('live');
  }

  render();
  return () => {};
}

function renderBrief(level: LevelConfig) {
  const activeCells = level.placements.filter((p) => !p.spare).reduce((sum, p) => sum + CLUSTER_SPECS[p.specId].cols * CLUSTER_SPECS[p.specId].rows, 0);
  const spareCells = level.placements.filter((p) => p.spare).reduce((sum, p) => sum + CLUSTER_SPECS[p.specId].cols * CLUSTER_SPECS[p.specId].rows, 0);
  return h('aside', { class: 'brief-panel panel' },
    h('h2', {}, level.name),
    h('p', { class: 'solar' }, level.solarTerm),
    h('p', {}, level.description),
    h('div', { class: 'brief-grid' },
      briefItem('熟蚕', `${level.worms.toLocaleString()} 条`),
      briefItem('有效格位', activeCells.toLocaleString()),
      briefItem('备用空蔟格', spareCells.toLocaleString()),
      briefItem('双宫概率', pct(level.doubleChance, 0)),
    ),
    h('div', { class: 'light-brief' },
      h('h3', {}, `光照：${level.light.name}`),
      h('p', {}, level.light.description),
    ),
    h('div', { class: 'tip-box' }, h('strong', {}, '老蚕农提示'), h('p', {}, level.flipHint)),
    h('div', { class: 'rules' },
      h('h3', {}, '评星看三项'),
      h('span', {}, '上茧率 ≥ 90%'),
      h('span', {}, '双宫茧率 ≤ 6%'),
      h('span', {}, '平板丝率 ≤ 5%'),
    ),
  );
}

function briefItem(label: string, value: string) {
  return h('div', { class: 'brief-item' }, h('span', {}, label), h('strong', {}, value));
}

function renderArrangement(level: LevelConfig, tilt: number, lightsOn: boolean, fanOn: boolean, onChange: (v: { tilt: number; lightsOn: boolean; fanOn: boolean }) => void) {
  const world = layoutLevel(level);
  const pad = 24;
  const vbW = world.width + pad * 2;
  const vbH = world.height + pad * 2;
  const sheetsSvg = world.sheets.map((s) => {
    const cells: string[] = [];
    for (let r = 0; r < s.rows; r++) {
      for (let c = 0; c < s.cols; c++) {
        cells.push(`<rect x="${s.x + c * s.cell + 0.6}" y="${s.y + r * s.cell + 0.6}" width="${s.cell - 1.2}" height="${s.cell - 1.2}" fill="${s.spare ? '#dcfce7' : '#f1d3a0'}" stroke="#8a6236" stroke-opacity=".45" stroke-width="1"/>`);
      }
    }
    return `
      <g>
        <rect x="${s.x - 9}" y="${s.y - 9}" width="${s.width + 18}" height="${s.height + 18}" rx="9" fill="${s.spare ? '#2f6b43' : '#704927'}"/>
        ${cells.join('')}
        <text x="${s.x}" y="${s.y - 17}" fill="${s.spare ? '#bbf7d0' : '#ffe7bd'}" font-size="20" font-weight="700">${s.label} · ${s.cols}×${s.rows}${s.spare && !s.label.includes('空') ? ' 空蔟' : ''}</text>
      </g>`;
  }).join('');
  const lightDots = level.light.sources.map((src) => {
    const x = src.nx * world.width;
    const y = src.ny * world.height;
    const on = src.kind === 'window' || lightsOn;
    return `<circle cx="${x}" cy="${y}" r="${Math.min(world.width, world.height) * src.radius * 0.45}" fill="${src.kind === 'window' ? '#93c5fd' : '#fbbf24'}" opacity="${on ? 0.16 : 0.03}"/>`;
  }).join('');

  const svg = `
    <svg viewBox="${-pad} ${-pad} ${vbW} ${vbH}" role="img" aria-label="${level.name}蔟架布置图" preserveAspectRatio="xMidYMid meet">
      <rect x="${-pad}" y="${-pad}" width="${vbW}" height="${vbH}" rx="18" fill="#21180f"/>
      ${lightDots}
      ${sheetsSvg}
      <g transform="translate(70 58)">
        <circle r="28" fill="#000" opacity=".35"/>
        <text x="-9" y="7" font-size="22" fill="#f87171" font-weight="900" transform="rotate(${tilt})">↑</text>
      </g>
    </svg>`;
  const svgWrap = h('div', { class: 'arrangement-svg', html: svg });

  const tiltValue = h('span', { class: 'control-value' }, `${tilt > 0 ? '+' : ''}${tilt}°`);
  const tiltSlider = h('input', {
    type: 'range', min: '-28', max: '28', step: '1', value: String(tilt),
    oninput: (e: Event) => {
      tilt = Number((e.target as HTMLInputElement).value);
      tiltValue.textContent = `${tilt > 0 ? '+' : ''}${tilt}°`;
      onChange({ tilt, lightsOn, fanOn });
      const arrow = svgWrap.querySelector('text');
      arrow?.setAttribute('transform', `rotate(${tilt})`);
    },
  }) as HTMLInputElement;

  const lightBtn = h('button', {
    class: `toggle ${lightsOn ? 'on' : ''}`,
    onclick: () => { lightsOn = !lightsOn; lightBtn.classList.toggle('on', lightsOn); lightBtn.textContent = lightsOn ? '💡 灯：开' : '🌙 灯：关'; onChange({ tilt, lightsOn, fanOn }); },
  }, lightsOn ? '💡 灯：开' : '🌙 灯：关');
  const fanBtn = h('button', {
    class: `toggle ${fanOn ? 'on' : ''}`,
    onclick: () => { fanOn = !fanOn; fanBtn.classList.toggle('on', fanOn); fanBtn.textContent = fanOn ? '🌀 风扇：开' : '♨️ 风扇：关'; onChange({ tilt, lightsOn, fanOn }); },
  }, fanOn ? '🌀 风扇：开' : '♨️ 风扇：关');

  return h('section', { class: 'arrangement panel' },
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', {}, '蔟架布置'), h('p', {}, '本关蔟片数量、规格和光照位置已经布置好；开局前可预设倾角与设备。')),
      h('div', { class: 'tag' }, `${world.sheets.length} 张蔟片`),
    ),
    svgWrap,
    h('div', { class: 'setup-controls' },
      h('label', { class: 'tilt-control' }, h('span', {}, '蔟架倾斜角'), tiltValue, tiltSlider,
        h('span', { class: 'range-labels' }, h('i', {}, '左端高'), h('i', {}, '水平'), h('i', {}, '右端高'))),
      h('div', { class: 'toggle-row' }, lightBtn, fanBtn),
    ),
  );
}

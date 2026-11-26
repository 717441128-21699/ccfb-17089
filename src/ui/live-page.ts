import { SimulationClient, simClient } from '../game/client';
import type { Snapshot } from '../game/types';
import { LiveScene } from '../render/LiveScene';
import { clear, formatTime, h, pct } from './dom';

type Navigate = (page: 'setup' | 'live' | 'replay' | 'result') => void;

const STATE_LABEL = ['乱爬找格', '绕格试壁', '单宫结茧', '双宫茧', '平板丝'];
const STATE_COLOR = ['#fef3c7', '#fdba74', '#fde68a', '#d8b4fe', '#cbd5e1'];

export function renderLive(root: HTMLElement, navigate: Navigate): () => void {
  let scene: LiveScene | null = null;
  let disposed = false;
  let selectedWorm: number | undefined;
  let targetSheet = simClient.world?.sheets.find((s) => s.spare)?.index;
  let pickMode = false;
  let lastSheetUi = 0;

  if (!simClient.workerAlive()) {
    navigate('setup');
    return () => {};
  }

  root.replaceChildren(h('div', { class: 'route-loading' }, '正在启动养蚕 Worker…'));

  const unsub = simClient.subscribe(() => {
    if (disposed) return;
    if (simClient.world && !scene) void mountScene();
    update();
  });

  if (simClient.world) void mountScene();

  async function mountScene() {
    if (!simClient.world || scene) return;
    root.replaceChildren(buildLayout());
    const host = root.querySelector<HTMLElement>('[data-canvas-host]')!;
    scene = new LiveScene(host, simClient.world);
    scene.lightSources = simClient.level?.light.sources ?? [];
    await scene.init();
    if (disposed) {
      scene.destroy();
      return;
    }
    if (simClient.level) scene.syncLights(simClient.level);
    scene.onPickWorm = (id, sheetIndex) => {
      if (id === null) {
        const sheet = simClient.world?.sheets.find((s) => s.index === sheetIndex);
        if (sheet?.spare) {
          targetSheet = sheetIndex;
          updateTargetButtons();
        }
        return;
      }
      selectedWorm = id;
      simClient.select(id);
      scene?.setSelected(id);
      if (pickMode) doRescue(id);
      updateSelected();
    };
    update();
  }

  function buildLayout() {
    const level = simClient.level!;
    const tilt = simClient.snapshot?.settings.tilt ?? level.initialTilt;
    const paused = simClient.snapshot?.settings.paused ?? false;
    const speed = simClient.snapshot?.settings.speed ?? 1;

    const tiltValue = h('span', { class: 'control-value', 'data-role': 'tilt-value' }, `${tilt > 0 ? '+' : ''}${tilt}°`);
    const tiltSlider = h('input', {
      type: 'range', min: '-30', max: '30', step: '1', value: String(tilt),
      'aria-label': '蔟架倾斜角度',
      oninput: (e: Event) => {
        const v = Number((e.target as HTMLInputElement).value);
        tiltValue.textContent = `${v > 0 ? '+' : ''}${v}°`;
        simClient.setTilt(v);
      },
    }) as HTMLInputElement;

    return h('div', { class: 'live-page' },
      h('header', { class: 'live-top panel' },
        h('button', { class: 'ghost', onclick: () => navigate('setup') }, '← 蔟架布置'),
        h('div', { class: 'live-title' },
          h('strong', {}, `第 ${level.id} 关 · ${level.name}`),
          h('span', { 'data-role': 'clock' }, '0:00'),
        ),
        h('div', { class: 'playback' },
          h('button', { class: 'ghost', 'data-role': 'pause', onclick: () => simClient.setPaused(!simClient.snapshot?.settings.paused) }, paused ? '▶ 继续' : '⏸ 暂停'),
          ...[1, 2, 4].map((v) => h('button', {
            class: `speed ${speed === v ? 'active' : ''}`,
            onclick: (e: MouseEvent) => { simClient.setSpeed(v); root.querySelectorAll('.speed').forEach((b) => b.classList.remove('active')); (e.currentTarget as HTMLButtonElement | null)?.classList.add('active'); },
          }, `${v}×`)),
        ),
      ),
      h('div', { class: 'live-layout' },
        h('section', { class: 'canvas-panel panel' },
          h('div', { class: 'canvas-host', 'data-canvas-host': '' }),
          h('div', { class: 'canvas-hint' }, '单击蚕查看；开启“拣蚕”后单击乱爬蚕，直接送到选中的空蔟片。滚轮缩放暂未开放，画面会自动适配蔟架。'),
          h('div', { class: 'event-ticker', 'data-role': 'events' }),
          h('div', { class: 'complete-overlay', 'data-role': 'complete', hidden: true }),
        ),
        h('aside', { class: 'side-panel' },
          h('section', { class: 'panel metrics-panel' },
            h('h2', {}, '上茧实况'),
            metricRow('上茧率', 'good', 'var(--gold)'),
            metricRow('双宫茧率', 'double', '#d8b4fe'),
            metricRow('平板丝', 'flat', '#cbd5e1'),
            h('div', { class: 'count-grid' },
              countBox('活动蚕', 'active'),
              countBox('试壁中', 'inspecting'),
              countBox('单宫茧', 'singleCocoons'),
              countBox('双宫茧', 'doubleCocoons'),
              countBox('平板丝', 'flatSilks'),
              countBox('已手拣', 'rescued'),
            ),
          ),
          h('section', { class: 'panel control-panel' },
            h('h2', {}, '蔟架操作'),
            h('label', { class: 'tilt-control' }, h('span', {}, '倾斜角（高端方向）'), tiltValue, tiltSlider,
              h('span', { class: 'range-labels' }, h('i', {}, '← 左高'), h('i', {}, '水平'), h('i', {}, '右高 →'))),
            h('button', { class: 'primary flip-all', onclick: () => simClient.flip() }, '🔄 全部蔟片翻个面（F）'),
            h('div', { class: 'switch-row' },
              h('button', { class: `toggle ${simClient.snapshot?.settings.lightsOn ?? level.lightsOn ? 'on' : ''}`, 'data-role': 'lights', onclick: (e: MouseEvent) => { const next = !simClient.snapshot?.settings.lightsOn; simClient.setLights(next); const btn = e.currentTarget as HTMLButtonElement | null; btn?.classList.toggle('on', next); if (btn) btn.textContent = next ? '💡 灯：开' : '🌙 灯：关'; } }, '💡 灯'),
              h('button', { class: `toggle ${simClient.snapshot?.settings.fanOn ?? level.fanOn ? 'on' : ''}`, 'data-role': 'fan', onclick: (e: MouseEvent) => { const next = !simClient.snapshot?.settings.fanOn; simClient.setFan(next); const btn = e.currentTarget as HTMLButtonElement | null; btn?.classList.toggle('on', next); if (btn) btn.textContent = next ? '🌀 风扇：开' : '♨️ 风扇：关'; } }, '🌀 风扇'),
            ),
            h('div', { class: 'rescue-box' },
              h('div', { class: 'rescue-head' }, h('strong', {}, '手动拣蚕'), h('button', { class: `small-toggle ${pickMode ? 'on' : ''}`, 'data-role': 'pick-mode', onclick: (e: MouseEvent) => { pickMode = !pickMode; scene?.setPickMode(pickMode); const btn = e.currentTarget as HTMLButtonElement | null; btn?.classList.toggle('on', pickMode); if (btn) btn.textContent = pickMode ? '拣蚕模式：开' : '拣蚕模式：关'; } }, '拣蚕模式：关')),
              h('div', { class: 'target-row', 'data-role': 'targets' }, ...(simClient.world?.sheets.filter((s) => s.spare) ?? []).map((s) =>
                h('button', { class: `target ${targetSheet === s.index ? 'active' : ''}`, 'data-target': s.index, onclick: () => { targetSheet = s.index; updateTargetButtons(); } }, `送到 ${s.label}`))),
              h('div', { class: 'selected-worm', 'data-role': 'selected' }, '尚未选中蚕。单击画面中的蚕查看状态。'),
              h('button', { class: 'ghost rescue-btn', onclick: () => { if (selectedWorm !== undefined) doRescue(selectedWorm); } }, '🖐 把选中蚕捡到空蔟片'),
            ),
          ),
          h('section', { class: 'panel sheet-panel' },
            h('h2', {}, '蔟片密度 / 单翻'),
            h('div', { class: 'sheet-list', 'data-role': 'sheets' }),
          ),
          h('section', { class: 'panel hint-panel' },
            h('h3', {}, '时机提示'),
            h('p', {}, level.flipHint),
            h('p', { class: 'muted' }, '键盘：Space 暂停，F 翻全部，L 灯，V 风扇，P 拣蚕模式。'),
          ),
        ),
      ),
    );
  }

  function metricRow(label: string, role: string, color: string) {
    return h('div', { class: 'metric-row' },
      h('div', { class: 'metric-label' }, h('span', {}, label), h('strong', { 'data-role': `${role}-text` }, '0%')),
      h('div', { class: 'bar' }, h('i', { 'data-role': `${role}-bar`, style: `background:${color};width:0%` })),
    );
  }

  function countBox(label: string, role: keyof Snapshot['metrics']) {
    return h('div', { class: 'count-box' }, h('strong', { 'data-role': `m-${role}` }, '0'), h('span', {}, label));
  }

  function doRescue(id: number) {
    simClient.rescue(id, targetSheet);
    appendLocalEvent(`已派出蚕农的手，拣起 #${id + 1}。`);
  }

  function appendLocalEvent(message: string) {
    const box = root.querySelector<HTMLElement>('[data-role="events"]');
    if (!box) return;
    const item = h('div', { class: 'event local' }, message);
    box.prepend(item);
    while (box.children.length > 5) box.lastElementChild?.remove();
  }

  function updateTargetButtons() {
    root.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.target) === targetSheet);
    });
  }

  function update() {
    const snap = simClient.snapshot;
    if (!snap || !scene) return;
    if (!disposed) scene.update(snap);

    const clock = root.querySelector('[data-role="clock"]');
    if (clock) clock.textContent = `${formatTime(snap.metrics.elapsed)} / 预计 ${formatTime(snap.metrics.estimatedFinish)}`;
    setText('pause', snap.settings.paused ? '▶ 继续' : '⏸ 暂停');
    root.querySelectorAll<HTMLButtonElement>('.speed').forEach((b, i) => b.classList.toggle('active', [1, 2, 4][i] === snap.settings.speed));
    const tiltText = root.querySelector('[data-role="tilt-value"]');
    if (tiltText && document.activeElement?.getAttribute('aria-label') !== '蔟架倾斜角度') {
      tiltText.textContent = `${snap.settings.tilt > 0 ? '+' : ''}${snap.settings.tilt}°`;
      const slider = root.querySelector<HTMLInputElement>('input[aria-label="蔟架倾斜角度"]');
      if (slider && document.activeElement !== slider) slider.value = String(snap.settings.tilt);
    }
    const lightBtn = root.querySelector<HTMLButtonElement>('[data-role="lights"]');
    if (lightBtn) {
      lightBtn.classList.toggle('on', snap.settings.lightsOn);
      lightBtn.textContent = snap.settings.lightsOn ? '💡 灯：开' : '🌙 灯：关';
    }
    const fanBtn = root.querySelector<HTMLButtonElement>('[data-role="fan"]');
    if (fanBtn) {
      fanBtn.classList.toggle('on', snap.settings.fanOn);
      fanBtn.textContent = snap.settings.fanOn ? '🌀 风扇：开' : '♨️ 风扇：关';
    }

    updateMetric('good', snap.metrics.goodRate);
    updateMetric('double', snap.metrics.doubleRate);
    updateMetric('flat', snap.metrics.flatRate);
    for (const key of ['active', 'inspecting', 'singleCocoons', 'doubleCocoons', 'flatSilks', 'rescued'] as const) {
      const el = root.querySelector(`[data-role="m-${key}"]`);
      if (el) el.textContent = key === 'doubleCocoons' ? snap.metrics[key].toFixed(0) : String(snap.metrics[key]);
    }

    if (selectedWorm !== undefined) updateSelected(snap);
    appendEvents(snap);
    maybeUpdateSheets(snap);
    updateCompletion();
  }

  function setText(role: string, text: string) {
    const el = root.querySelector(`[data-role="${role}"]`);
    if (el) el.textContent = text;
  }

  function updateMetric(role: string, value: number) {
    const text = root.querySelector(`[data-role="${role}-text"]`);
    const bar = root.querySelector<HTMLElement>(`[data-role="${role}-bar"]`);
    if (text) text.textContent = pct(value, 1);
    if (bar) bar.style.width = `${Math.min(100, value * 100)}%`;
  }

  function appendEvents(snap: Snapshot) {
    const box = root.querySelector<HTMLElement>('[data-role="events"]');
    if (!box || snap.recentEvents.length === 0) return;
    for (const e of snap.recentEvents.slice().reverse()) {
      const item = h('div', { class: `event ${e.type}` }, e.message);
      box.prepend(item);
    }
    while (box.children.length > 7) box.lastElementChild?.remove();
  }

  function updateSelected(snap: Snapshot | null = simClient.snapshot) {
    const box = root.querySelector<HTMLElement>('[data-role="selected"]');
    if (!box || selectedWorm === undefined || !snap) return;
    const id = selectedWorm;
    const sheet = simClient.world?.sheets[snap.sheet[id]];
    const state = snap.state[id];
    box.replaceChildren(
      h('div', { class: 'selected-head' },
        h('strong', {}, `蚕 #${id + 1}`),
        h('span', { style: `background:${STATE_COLOR[state]}` }, STATE_LABEL[state]),
      ),
      h('div', { class: 'selected-grid' },
        h('span', {}, `所在：${sheet?.label ?? '—'}`),
        h('span', {}, `大小：${snap.size[id].toFixed(2)}`),
      ),
      h('div', { class: 'bar stamina' }, h('i', { style: `width:${snap.stamina[id]}%` })),
      h('small', {}, `体力 ${snap.stamina[id].toFixed(0)}`),
    );
  }

  function maybeUpdateSheets(snap: Snapshot) {
    const now = performance.now();
    if (now - lastSheetUi < 350) return;
    lastSheetUi = now;
    const list = root.querySelector<HTMLElement>('[data-role="sheets"]');
    if (!list || !simClient.world) return;
    const counts = new Array(simClient.world.sheets.length).fill(0);
    const cocoons = new Array(simClient.world.sheets.length).fill(0);
    for (let i = 0; i < snap.total; i++) {
      const si = snap.sheet[i];
      if (snap.state[i] <= 1) counts[si]++;
      else if (snap.state[i] >= 2 && snap.state[i] <= 3) cocoons[si]++;
    }
    if (list.children.length !== simClient.world.sheets.length) {
      list.replaceChildren(...simClient.world.sheets.map((s) =>
        h('div', { class: `sheet-row ${s.spare ? 'spare' : ''}` },
          h('button', { onclick: () => simClient.flip(s.index) }, `翻 ${s.label}`),
          h('div', { class: 'sheet-info' }, h('strong', {}, s.label), h('span', { 'data-role': `sheet-count-${s.index}` }, '')),
          h('div', { class: 'mini-bar' }, h('i', { 'data-role': `sheet-bar-${s.index}` })),
        ),
      ));
    }
    const max = Math.max(1, ...counts);
    simClient.world.sheets.forEach((s) => {
      const text = list.querySelector(`[data-role="sheet-count-${s.index}"]`);
      const bar = list.querySelector<HTMLElement>(`[data-role="sheet-bar-${s.index}"]`);
      if (text) text.textContent = `乱爬/试壁 ${counts[s.index]} · 茧 ${cocoons[s.index]}`;
      if (bar) bar.style.width = `${(counts[s.index] / max) * 100}%`;
    });
  }

  function updateCompletion() {
    const overlay = root.querySelector<HTMLElement>('[data-role="complete"]');
    if (!overlay) return;
    const result = simClient.result;
    overlay.hidden = !result;
    if (result && overlay.dataset.rendered !== '1') {
      overlay.dataset.rendered = '1';
      const m = result.metrics;
      const firstReplay = result.notable.flat[0] ?? result.notable.double[0] ?? result.notable.steady[0] ?? 0;
      overlay.replaceChildren(
        h('div', { class: 'complete-card' },
          h('div', { class: 'stars-mini' }, '★'.repeat(result.stars) + '☆'.repeat(3 - result.stars)),
          h('h2', {}, '这一匾上蔟结束'),
          h('p', {}, `上茧率 ${pct(m.goodRate)} · 双宫茧 ${m.doubleCocoons} 颗 · 平板丝 ${m.flatSilks} 张`),
          h('div', { class: 'complete-actions' },
            h('button', { class: 'primary', onclick: () => { simClient.select(firstReplay); navigate('replay'); } }, '回看一条蚕'),
            h('button', { class: 'gold', onclick: () => navigate('result') }, '查看评星 →'),
          ),
        ),
      );
    }
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
    if (e.code === 'Space') { e.preventDefault(); simClient.setPaused(!simClient.snapshot?.settings.paused); }
    else if (e.key.toLowerCase() === 'f') simClient.flip();
    else if (e.key.toLowerCase() === 'l') simClient.setLights(!simClient.snapshot?.settings.lightsOn);
    else if (e.key.toLowerCase() === 'v') simClient.setFan(!simClient.snapshot?.settings.fanOn);
    else if (e.key.toLowerCase() === 'p') {
      pickMode = !pickMode;
      scene?.setPickMode(pickMode);
      const btn = root.querySelector<HTMLButtonElement>('[data-role="pick-mode"]');
      if (btn) { btn.classList.toggle('on', pickMode); btn.textContent = pickMode ? '拣蚕模式：开' : '拣蚕模式：关'; }
    }
  }
  window.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    window.removeEventListener('keydown', onKey);
    unsub();
    scene?.destroy();
    scene = null;
  };
}

// Keep clear referenced for future imperative list resets.
void clear;

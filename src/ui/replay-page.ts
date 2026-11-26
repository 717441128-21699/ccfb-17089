import { simClient } from '../game/client';
import type { TrajectoryResponse } from '../game/types';
import { ReplayScene } from '../render/ReplayScene';
import { formatTime, h } from './dom';

type Navigate = (page: 'setup' | 'live' | 'replay' | 'result') => void;

export function renderReplay(root: HTMLElement, navigate: Navigate): () => void {
  if (!simClient.world || !simClient.workerAlive?.()) {
    root.replaceChildren(
      h('main', { class: 'guard panel' },
        h('h1', {}, '还没有可回看的蚕轨迹'),
        h('p', {}, '请先从蔟架布置开始一关；上蔟结束后可以从评星页或实况结束卡进入回看。'),
        h('button', { class: 'primary', onclick: () => navigate('setup') }, '去蔟架布置'),
      ),
    );
    return () => {};
  }

  const result = simClient.result;
  const initialId = result?.notable.flat[0] ?? result?.notable.double[0] ?? result?.notable.steady[0] ?? 0;
  let wormId = initialId;
  let traj: TrajectoryResponse | null = null;
  let scene: ReplayScene | null = null;
  let playing = true;
  let playbackSpeed = 1;
  let currentTime = 0;
  let raf = 0;
  let lastTs = 0;
  let disposed = false;

  root.replaceChildren(buildLayout());
  const host = root.querySelector<HTMLElement>('[data-replay-host]')!;
  const timeline = root.querySelector<HTMLInputElement>('[data-role="scrub"]')!;
  const timeLabel = root.querySelector<HTMLElement>('[data-role="replay-time"]')!;
  const eventList = root.querySelector<HTMLElement>('[data-role="traj-events"]')!;
  const meta = root.querySelector<HTMLElement>('[data-role="worm-meta"]')!;

  void loadWorm(wormId);
  raf = requestAnimationFrame(tick);

  async function loadWorm(id: number) {
    wormId = id;
    meta.textContent = `正在读取蚕 #${id + 1} 的轨迹…`;
    try {
      traj = await simClient.requestTrajectory(id);
    } catch {
      meta.textContent = '轨迹读取失败，请返回实况后重试。';
      return;
    }
    if (disposed) return;
    currentTime = 0;
    timeline.max = String(traj.samples.length ? traj.samples[(traj.samples.length / 6 - 1) * 6] : 0);
    timeline.value = '0';
    scene?.destroy();
    scene = new ReplayScene(host, simClient.world!, traj);
    await scene.init();
    renderMeta();
    renderEvents();
    scene.setTime(0);
  }

  function renderMeta() {
    if (!traj) return;
    const label = traj.result === 'single' ? '单宫好茧' : traj.result === 'double' ? '双宫茧' : traj.result === 'flat' ? '平板丝' : '仍在活动';
    meta.replaceChildren(
      h('strong', {}, `蚕 #${traj.wormId + 1}`),
      h('span', { class: `result-badge ${traj.result}` }, label),
      h('span', {}, `体型系数 ${traj.size.toFixed(2)}`),
    );
  }

  function renderEvents() {
    if (!traj) return;
    eventList.replaceChildren(...traj.events.map((e) =>
      h('button', { class: `traj-event ${e.type}`, onclick: () => { currentTime = e.t; playing = false; updatePlayButton(); scene?.setTime(currentTime); timeline.value = String(currentTime); } },
        h('time', {}, formatTime(e.t)),
        h('span', {}, e.message),
      ),
    ));
  }

  function buildLayout() {
    const notable = result?.notable;
    const chips: Array<[string, number[] | undefined, string]> = [
      ['平板丝', notable?.flat, 'flat'],
      ['双宫茧', notable?.double, 'double'],
      ['被手拣', notable?.rescued, 'rescue'],
      ['好茧', notable?.steady, 'single'],
    ];
    return h('main', { class: 'replay-page' },
      h('header', { class: 'live-top panel' },
        h('button', { class: 'ghost', onclick: () => navigate('result') }, '← 返回评星'),
        h('div', { class: 'live-title' }, h('strong', {}, '单蚕轨迹回看'), h('span', {}, '每 0.2 秒采样；可拖动时间轴或点击事件跳转')),
        h('button', { class: 'primary', onclick: () => navigate('live') }, '返回实况'),
      ),
      h('div', { class: 'replay-layout' },
        h('section', { class: 'panel replay-canvas-panel' },
          h('div', { class: 'canvas-host replay-host', 'data-replay-host': '' }),
          h('div', { class: 'replay-controls' },
            h('button', { class: 'primary', 'data-role': 'play', onclick: () => { playing = !playing; updatePlayButton(); } }, '⏸ 暂停'),
            h('input', { type: 'range', min: '0', max: '100', step: '0.1', value: '0', 'data-role': 'scrub', oninput: (e: Event) => { currentTime = Number((e.target as HTMLInputElement).value); scene?.setTime(currentTime); } }),
            h('span', { class: 'control-value', 'data-role': 'replay-time' }, '0:00'),
            ...[0.5, 1, 2, 4].map((v) => h('button', { class: `speed ${playbackSpeed === v ? 'active' : ''}`, onclick: (e: MouseEvent) => { playbackSpeed = v; root.querySelectorAll('.replay-controls .speed').forEach((b) => b.classList.remove('active')); (e.currentTarget as HTMLButtonElement | null)?.classList.add('active'); } }, `${v}×`)),
          ),
        ),
        h('aside', { class: 'panel replay-side' },
          h('h2', {}, '选择一条蚕'),
          h('div', { class: 'worm-meta', 'data-role': 'worm-meta' }),
          h('label', { class: 'worm-id-input' }, '输入编号',
            h('input', { type: 'number', min: '1', max: String(simClient.level?.worms ?? 1), value: String(wormId + 1), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') jump(); } }),
            h('button', { class: 'ghost', onclick: jump }, '跳转')),
          h('div', { class: 'notable-groups' }, ...chips.map(([label, ids, cls]) =>
            h('div', { class: `notable-group ${cls}` },
              h('h3', {}, label),
              h('div', {}, ...(ids && ids.length ? ids.slice(0, 12).map((id) => h('button', { class: id === wormId ? 'active' : '', onclick: () => loadWorm(id) }, `#${id + 1}`)) : [h('span', { class: 'muted' }, '本关没有')])),
            ),
          )),
          h('h3', {}, '事件点'),
          h('div', { class: 'traj-events', 'data-role': 'traj-events' }),
        ),
      ),
    );
  }

  function jump() {
    const input = root.querySelector<HTMLInputElement>('.worm-id-input input');
    const id = Math.max(1, Math.min(simClient.level?.worms ?? 1, Number(input?.value ?? 1))) - 1;
    void loadWorm(id);
  }

  function updatePlayButton() {
    const btn = root.querySelector<HTMLButtonElement>('[data-role="play"]');
    if (btn) btn.textContent = playing ? '⏸ 暂停' : '▶ 播放';
  }

  function tick(ts: number) {
    if (disposed) return;
    const dt = lastTs ? Math.min(0.08, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (playing && traj) {
      currentTime += dt * playbackSpeed;
      if (currentTime >= scene!.duration) {
        currentTime = scene!.duration;
        playing = false;
        updatePlayButton();
      }
      scene?.setTime(currentTime);
      timeline.value = currentTime.toFixed(1);
      timeLabel.textContent = formatTime(currentTime);
    }
    raf = requestAnimationFrame(tick);
  }

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    scene?.destroy();
  };
}

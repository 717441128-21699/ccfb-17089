import { Application, Container, Graphics, Text } from 'pixi.js';
import type { TrajectoryResponse, WorldLayout } from '../game/types';

const STRIDE = 6;

export class ReplayScene {
  private host: HTMLElement;
  private world: WorldLayout;
  private traj: TrajectoryResponse;
  private app: Application | null = null;
  private viewport = new Container();
  private staticLayer = new Graphics();
  private pathLayer = new Graphics();
  private dotLayer = new Graphics();
  private observer: ResizeObserver | null = null;
  private scale = 1;
  duration: number;

  constructor(host: HTMLElement, world: WorldLayout, traj: TrajectoryResponse) {
    this.host = host;
    this.world = world;
    this.traj = traj;
    const n = traj.samples.length / STRIDE;
    this.duration = n ? traj.samples[(n - 1) * STRIDE] : 1;
  }

  async init() {
    const app = new Application();
    this.app = app;
    await app.init({ resizeTo: this.host, antialias: true, background: 0x21180f, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    this.host.replaceChildren(app.canvas);
    app.stage.addChild(this.viewport);
    this.viewport.addChild(this.staticLayer, this.pathLayer, this.dotLayer);
    this.drawWorld();
    this.drawFullPath();
    this.setTime(0);
    this.fit();
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.host);
  }

  private drawWorld() {
    const g = this.staticLayer;
    g.rect(0, 0, this.world.width, this.world.height).fill(0x21180f);
    for (const s of this.world.sheets) {
      g.roundRect(s.x - 10, s.y - 10, s.width + 20, s.height + 20, 8).fill(0x704927);
      g.rect(s.x, s.y, s.width, s.height).fill(s.spare ? 0xd8efd5 : 0xe2c18a);
      for (let r = 0; r < s.rows; r++) {
        for (let c = 0; c < s.cols; c++) {
          const x = s.x + c * s.cell;
          const y = s.y + r * s.cell;
          g.rect(x + 0.5, y + 0.5, s.cell - 1, s.cell - 1).stroke({ color: 0x8a6236, alpha: 0.5, width: 1 });
        }
      }
      const spareSuffix = s.spare && !s.label.includes('空') ? ' · 空蔟' : '';
      const label = new Text({
        text: `${s.label}${spareSuffix}`,
        style: { fill: s.spare ? '#bbf7d0' : '#ffe7bd', fontSize: 18, fontWeight: '700', fontFamily: 'system-ui, Microsoft YaHei, sans-serif' },
      });
      label.x = s.x;
      label.y = s.y - 34;
      this.viewport.addChild(label);
    }
  }

  private xyAt(index: number): { x: number; y: number; t: number; state: number; stamina: number } {
    const i = Math.max(0, Math.min(index, this.traj.samples.length / STRIDE - 1)) * STRIDE;
    return { t: this.traj.samples[i], x: this.traj.samples[i + 1], y: this.traj.samples[i + 2], state: this.traj.samples[i + 3], stamina: this.traj.samples[i + 4] };
  }

  private indexAtTime(time: number): number {
    const count = this.traj.samples.length / STRIDE;
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.xyAt(mid).t <= time) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private drawFullPath() {
    const g = this.pathLayer;
    const count = this.traj.samples.length / STRIDE;
    if (count < 2) return;
    g.moveTo(this.traj.samples[1], this.traj.samples[2]);
    for (let i = 1; i < count; i++) g.lineTo(this.traj.samples[i * STRIDE + 1], this.traj.samples[i * STRIDE + 2]);
    g.stroke({ color: 0x5eead4, alpha: 0.22, width: 3 });

    for (const event of this.traj.events) {
      if (event.type === 'light' || event.type === 'fan') continue;
      const idx = this.indexAtTime(event.t);
      const p = this.xyAt(idx);
      const color = event.type === 'flat' ? 0xe5e7eb : event.type === 'double' ? 0xd8b4fe : event.type === 'rescue' ? 0x86efac : 0xfbbf24;
      g.circle(p.x, p.y, 7).fill({ color, alpha: 0.25 });
      g.circle(p.x, p.y, 3.5).fill(color);
    }
  }

  setTime(time: number) {
    const g = this.dotLayer;
    g.clear();
    const count = this.traj.samples.length / STRIDE;
    if (!count) return;
    const idx = this.indexAtTime(time);
    const p = this.xyAt(idx);

    // Bright elapsed trail.
    if (idx > 1) {
      g.moveTo(this.traj.samples[1], this.traj.samples[2]);
      for (let i = 1; i <= idx; i++) g.lineTo(this.traj.samples[i * STRIDE + 1], this.traj.samples[i * STRIDE + 2]);
      g.stroke({ color: 0x2dd4bf, alpha: 0.85, width: 4 });
    }
    const color = p.state === 2 ? 0xf6d98f : p.state === 3 ? 0xd8b4fe : p.state === 4 ? 0xcbd5e1 : 0xfff6d8;
    g.circle(p.x, p.y, 12).fill({ color: 0x000000, alpha: 0.35 });
    g.circle(p.x, p.y, 7).fill(color);
    g.circle(p.x, p.y, 11).stroke({ color: 0x5eead4, width: 2 });
  }

  fit() {
    if (!this.app) return;
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 560;
    this.scale = Math.min(w / this.world.width, h / this.world.height, 1.5) * 0.96;
    this.viewport.scale.set(this.scale);
    const scaledHeight = this.world.height * this.scale;
    const y = scaledHeight < h * 0.72 ? 28 : Math.max(10, (h - scaledHeight) / 2);
    this.viewport.position.set((w - this.world.width * this.scale) / 2, y);
  }

  destroy() {
    this.observer?.disconnect();
    this.app?.destroy({ removeView: true }, { children: true });
    this.app = null;
  }
}

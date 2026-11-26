import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { CLUSTER_SPECS } from '../game/levels';
import type { LevelConfig, LightSourceConfig, SheetInfo, Snapshot, WorldLayout } from '../game/types';

const COLORS = {
  room: 0x21180f,
  roomLine: 0x3a2a1a,
  frame: 0x7a5230,
  frameDark: 0x442c17,
  cell: 0xe2c18a,
  cellLine: 0x8a6236,
  spareTint: 0xb9f0c5,
  worm: 0xfff6d8,
  inspect: 0xffb347,
  single: 0xf6d98f,
  double: 0xd78cff,
  flat: 0xa7adb5,
  selected: 0x5eead4,
  high: 0xef4444,
};

export class LiveScene {
  readonly host: HTMLElement;
  readonly world: WorldLayout;
  private app: Application | null = null;
  private viewport = new Container();
  private sheetLayer = new Graphics();
  private lightLayer = new Container();
  private wormLayer = new Graphics();
  private overlayLayer = new Graphics();
  private lightTexture: Texture | null = null;
  private observer: ResizeObserver | null = null;
  private scale = 1;
  private selectedId?: number;
  private pickMode = false;
  lightSources: LightSourceConfig[] = [];
  onPickWorm?: (wormId: number | null, sheetIndex?: number) => void;

  constructor(host: HTMLElement, world: WorldLayout) {
    this.host = host;
    this.world = world;
  }

  async init() {
    const app = new Application();
    this.app = app;
    await app.init({
      resizeTo: this.host,
      antialias: true,
      background: COLORS.room,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    app.canvas.style.display = 'block';
    this.host.replaceChildren(app.canvas);

    this.makeLightTexture();
    app.stage.addChild(this.viewport);
    this.viewport.addChild(this.sheetLayer, this.lightLayer, this.wormLayer, this.overlayLayer);
    this.drawRoomAndSheets();
    this.drawLights(true);
    this.bindPointer();
    this.fit();

    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.host);
  }

  private makeLightTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, 'rgba(255,236,170,0.95)');
    gradient.addColorStop(0.35, 'rgba(255,214,120,0.32)');
    gradient.addColorStop(1, 'rgba(255,214,120,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 256);
    this.lightTexture = Texture.from(canvas);
  }

  private drawRoomAndSheets() {
    const g = this.sheetLayer;
    g.clear();
    g.rect(0, 0, this.world.width, this.world.height).fill(COLORS.room);
    // Floor/rack guide lines.
    for (let x = 0; x < this.world.width; x += 80) {
      g.moveTo(x, 0).lineTo(x, this.world.height).stroke({ color: COLORS.roomLine, alpha: 0.22, width: 1 });
    }
    for (let y = 0; y < this.world.height; y += 80) {
      g.moveTo(0, y).lineTo(this.world.width, y).stroke({ color: COLORS.roomLine, alpha: 0.22, width: 1 });
    }

    for (const sheet of this.world.sheets) this.drawSheet(sheet);
  }

  private drawSheet(sheet: SheetInfo) {
    const g = this.sheetLayer;
    const spec = CLUSTER_SPECS[sheet.specId];
    // Tray below.
    g.roundRect(sheet.x - 18, sheet.y + sheet.height + 22, sheet.width + 36, 12, 5)
      .fill({ color: 0x4b321c, alpha: 0.9 });
    g.rect(sheet.x - 10, sheet.y + sheet.height + 10, sheet.width + 20, 8).fill(COLORS.frameDark);

    // Frame and backing.
    g.roundRect(sheet.x - 10, sheet.y - 10, sheet.width + 20, sheet.height + 20, 8).fill(COLORS.frame);
    g.rect(sheet.x, sheet.y, sheet.width, sheet.height).fill(COLORS.cell);

    for (let row = 0; row < sheet.rows; row++) {
      for (let col = 0; col < sheet.cols; col++) {
        const x = sheet.x + col * sheet.cell;
        const y = sheet.y + row * sheet.cell;
        g.rect(x + 0.5, y + 0.5, sheet.cell - 1, sheet.cell - 1)
          .stroke({ color: COLORS.cellLine, alpha: 0.62, width: 1 });
        if (spec?.id === 'mi' && (col + row) % 2 === 0) {
          g.rect(x + 3, y + 3, sheet.cell - 6, sheet.cell - 6).fill({ color: 0xc99f62, alpha: 0.18 });
        }
      }
    }

    g.roundRect(sheet.x - 10, sheet.y - 10, sheet.width + 20, sheet.height + 20, 8)
      .stroke({ color: COLORS.frameDark, width: 3 });

    const spareSuffix = sheet.spare && !sheet.label.includes('空') ? ' · 空蔟' : '';
    const label = new Text({
      text: `${sheet.label} · ${sheet.cols}×${sheet.rows}${spareSuffix}`,
      style: {
        fill: sheet.spare ? COLORS.spareTint : 0xffe7bd,
        fontSize: 18,
        fontWeight: '700',
        fontFamily: 'system-ui, "Microsoft YaHei", sans-serif',
      },
    });
    label.x = sheet.x - 6;
    label.y = sheet.y - 38;
    this.viewport.addChild(label);

    if (sheet.spare) {
      g.roundRect(sheet.x - 14, sheet.y - 14, sheet.width + 28, sheet.height + 28, 10)
        .stroke({ color: 0x86efac, width: 3, alpha: 0.75 });
    }
  }

  drawLights(lightsOn: boolean, lightSources: LightSourceConfig[] = [], ambient = 0.28) {
    this.lightLayer.removeChildren().forEach((child) => child.destroy());
    const sources = lightSources ?? [];
    for (const src of sources) {
      if (src.kind === 'lamp' && !lightsOn) continue;
      const x = src.nx * this.world.width;
      const y = src.ny * this.world.height;
      const rx = src.radius * this.world.width * 0.72;
      const ry = src.radius * this.world.height * 1.35;
      const sprite = new Sprite(this.lightTexture ?? Texture.WHITE);
      sprite.anchor.set(0.5);
      sprite.x = x;
      sprite.y = y;
      sprite.width = Math.max(80, rx * 2);
      sprite.height = Math.max(80, ry * 2);
      sprite.tint = src.kind === 'window' ? 0xbfd7ff : 0xffd37a;
      sprite.alpha = Math.min(0.5, src.intensity * (src.kind === 'lamp' && lightsOn ? 0.42 : 0.34));
      sprite.blendMode = 'add';
      this.lightLayer.addChild(sprite);
    }
    this.lightLayer.alpha = 0.9;
    void ambient;
  }

  setPickMode(on: boolean) {
    this.pickMode = on;
    if (this.app) this.app.canvas.style.cursor = on ? 'crosshair' : 'default';
  }

  setSelected(id?: number) {
    this.selectedId = id;
  }

  private bindPointer() {
    if (!this.app) return;
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointerdown', (event) => {
      const local = this.viewport.toLocal(event.global);
      const hit = this.pickWorm(local.x, local.y);
      if (hit !== null) {
        this.onPickWorm?.(hit);
        return;
      }
      const sheet = this.pickSheet(local.x, local.y);
      this.onPickWorm?.(null, sheet?.index);
    });
  }

  private pickWorm(wx: number, wy: number): number | null {
    const snap = this.lastSnapshot;
    if (!snap) return null;
    const threshold = 18 / this.scale;
    let best: number | null = null;
    let bestD = threshold * threshold;
    for (let i = 0; i < snap.total; i++) {
      if (snap.state[i] > 1 && !this.pickMode) continue;
      if (this.pickMode && snap.state[i] !== 0 && snap.state[i] !== 1) continue;
      const dx = snap.x[i] - wx;
      const dy = snap.y[i] - wy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private pickSheet(wx: number, wy: number): SheetInfo | undefined {
    return this.world.sheets.find((s) => wx >= s.x - 18 && wx <= s.x + s.width + 18 && wy >= s.y - 42 && wy <= s.y + s.height + 40);
  }

  private lastSnapshot: Snapshot | null = null;

  update(snapshot: Snapshot) {
    if (this.lastLightsOn !== null && this.lastLightsOn !== snapshot.settings.lightsOn) {
      this.drawLights(snapshot.settings.lightsOn, this.lightSources);
    }
    this.lastLightsOn = snapshot.settings.lightsOn;
    this.lastSnapshot = snapshot;
    this.drawWorms(snapshot);
    this.drawOverlay(snapshot);
  }
  private lastLightsOn: boolean | null = null;

  syncLights(level: LevelConfig) {
    this.lightSources = level.light.sources;
    this.drawLights(this.lastSnapshot?.settings.lightsOn ?? level.lightsOn, level.light.sources, level.light.ambient);
  }

  private drawWorms(s: Snapshot) {
    const g = this.wormLayer;
    g.clear();
    const r = Math.max(2.4, 4.2 / Math.sqrt(this.scale));
    for (let i = 0; i < s.total; i++) {
      const state = s.state[i];
      const x = s.x[i];
      const y = s.y[i];
      if (state === 2) {
        g.circle(x, y, r * 1.25).fill(COLORS.single);
      } else if (state === 3) {
        g.circle(x - r * 0.55, y, r * 1.05).fill(0xf0c6ff);
        g.circle(x + r * 0.55, y, r * 1.05).fill(COLORS.double);
      } else if (state === 4) {
        g.rect(x - r * 2.1, y - r * 0.45, r * 4.2, r * 0.9).fill({ color: COLORS.flat, alpha: 0.72 });
        g.moveTo(x - r * 1.8, y).lineTo(x + r * 1.8, y).stroke({ color: 0xe5e7eb, alpha: 0.5, width: 0.8 });
      } else {
        const inspect = state === 1;
        const speed = Math.hypot(s.vx[i], s.vy[i]);
        if (speed > 2) {
          const angle = Math.atan2(s.vy[i], s.vx[i]);
          g.moveTo(x - Math.cos(angle) * r * 1.2, y - Math.sin(angle) * r * 1.2)
            .lineTo(x + Math.cos(angle) * r * 1.2, y + Math.sin(angle) * r * 1.2)
            .stroke({ color: inspect ? COLORS.inspect : COLORS.worm, width: r * 1.15, cap: 'round' });
          g.circle(x + Math.cos(angle) * r * 1.25, y + Math.sin(angle) * r * 1.25, r * 0.72)
            .fill(inspect ? 0xffd28a : 0xffffff);
        } else {
          g.circle(x, y, r).fill(inspect ? COLORS.inspect : COLORS.worm);
        }
        if (inspect) g.circle(x, y, r * 2.1).stroke({ color: COLORS.inspect, alpha: 0.35, width: 1.2 });
      }
    }
  }

  private drawOverlay(s: Snapshot) {
    const g = this.overlayLayer;
    g.clear();
    const id = this.selectedId ?? s.selectedId;
    if (id !== undefined && id >= 0) {
      const x = s.x[id];
      const y = s.y[id];
      g.circle(x, y, 11 / this.scale + 5).stroke({ color: COLORS.selected, width: 2.5 / this.scale + 1.2 });
      g.circle(x, y, 16 / this.scale + 6).stroke({ color: COLORS.selected, alpha: 0.28, width: 2 / this.scale + 1 });
    }
    // High-side arrow follows current tilt.
    const tilt = s.settings.tilt;
    const ax = 70;
    const ay = 54;
    const dirX = Math.sin((tilt * Math.PI) / 180);
    const dirY = -Math.cos((tilt * Math.PI) / 180);
    g.circle(ax, ay, 24).fill({ color: 0x000000, alpha: 0.38 });
    g.moveTo(ax - dirX * 15, ay - dirY * 15).lineTo(ax + dirX * 15, ay + dirY * 15)
      .stroke({ color: COLORS.high, width: 4, cap: 'round' });
    const hx = ax + dirX * 18;
    const hy = ay + dirY * 18;
    g.circle(hx, hy, 4).fill(COLORS.high);
  }

  fit() {
    if (!this.app) return;
    const w = this.host.clientWidth || 800;
    const h = this.host.clientHeight || 560;
    this.scale = Math.min(w / this.world.width, h / this.world.height, 1.65) * 0.96;
    this.viewport.scale.set(this.scale);
    const scaledHeight = this.world.height * this.scale;
    const y = scaledHeight < h * 0.72 ? 76 : Math.max(18, (h - scaledHeight) / 2 + 8);
    this.viewport.position.set((w - this.world.width * this.scale) / 2, y);
  }

  destroy() {
    this.observer?.disconnect();
    this.app?.destroy({ removeView: true }, { children: true });
    this.app = null;
  }
}

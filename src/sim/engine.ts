import { DEFAULT_THRESHOLDS, layoutLevel, gradeStars } from '../game/levels';
import type {
  FinalResult,
  GameEvent,
  LevelConfig,
  Metrics,
  SheetInfo,
  SimSettings,
  Snapshot,
  StarThresholds,
  TrajectoryResponse,
  WorldLayout,
} from '../game/types';
import { clamp, gaussian, lerp, mulberry32 } from './rng';

export const STATE_SEARCH = 0;
export const STATE_INSPECT = 1;
export const STATE_SINGLE = 2;
export const STATE_DOUBLE = 3;
export const STATE_FLAT = 4;

const SAMPLE_INTERVAL = 0.2;
const FIXED_STEP = 1 / 30;

interface SheetRuntime {
  info: SheetInfo;
  occupant: Int32Array;
  cocoonDouble: Uint8Array;
  inspectorA: Int32Array;
  inspectorB: Int32Array;
  goalClaim: Int32Array;
  claimAt: Float64Array;
  shelter: Float32Array;
  lastFlip: number;
}

export class SimulationEngine {
  readonly level: LevelConfig;
  readonly world: WorldLayout;
  readonly thresholds: StarThresholds = DEFAULT_THRESHOLDS;
  private rng: () => number;
  private sheets: SheetRuntime[] = [];

  readonly total: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly size: Float32Array;
  private readonly speedBase: Float32Array;
  private readonly stamina: Float32Array;
  private readonly age: Float32Array;
  private readonly sampleClock: Float32Array;
  private readonly inspectT: Float32Array;
  private readonly inspectTotal: Float32Array;
  private readonly phase: Float32Array;
  private readonly rejectT: Float32Array;
  private readonly reliefUntil: Float32Array;
  private readonly frustration: Float32Array;
  private readonly state: Uint8Array;
  private readonly sheetIndex: Uint16Array;
  private readonly cellIndex: Int32Array;
  private readonly goalCell: Int32Array;
  private readonly repathT: Float32Array;
  private readonly pairWith: Int32Array;
  private readonly rescued: Uint8Array;

  private samples: number[][];
  private wormEvents: GameEvent[][];
  private eventLog: GameEvent[] = [];
  private pendingEvents: GameEvent[] = [];

  time = 0;
  completed = false;
  selectedId?: number;
  settings: SimSettings = { tilt: 0, lightsOn: true, fanOn: false, speed: 1, paused: false };
  private result: FinalResult | null = null;
  private finishClock = 0;

  constructor(level: LevelConfig) {
    this.level = level;
    this.world = layoutLevel(level);
    this.rng = mulberry32(level.seed);
    this.total = level.worms;

    const n = this.total;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.size = new Float32Array(n);
    this.speedBase = new Float32Array(n);
    this.stamina = new Float32Array(n);
    this.age = new Float32Array(n);
    this.sampleClock = new Float32Array(n);
    this.inspectT = new Float32Array(n);
    this.inspectTotal = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.rejectT = new Float32Array(n);
    this.reliefUntil = new Float32Array(n);
    this.frustration = new Float32Array(n);
    this.state = new Uint8Array(n);
    this.sheetIndex = new Uint16Array(n);
    this.cellIndex = new Int32Array(n).fill(-1);
    this.goalCell = new Int32Array(n).fill(-1);
    this.repathT = new Float32Array(n);
    this.pairWith = new Int32Array(n).fill(-1);
    this.rescued = new Uint8Array(n);
    this.samples = Array.from({ length: n }, () => []);
    this.wormEvents = Array.from({ length: n }, () => []);

    this.settings.tilt = level.initialTilt;
    this.settings.lightsOn = level.lightsOn;
    this.settings.fanOn = level.fanOn;

    this.buildSheets();
    this.spawnWorms();
  }

  private buildSheets() {
    this.sheets = this.world.sheets.map((info) => {
      const count = info.cols * info.rows;
      const shelter = new Float32Array(count);
      for (let row = 0; row < info.rows; row++) {
        for (let col = 0; col < info.cols; col++) {
          const idx = row * info.cols + col;
          const edge = col === 0 || row === 0 || col === info.cols - 1 || row === info.rows - 1;
          const corner =
            (col === 0 || col === info.cols - 1) && (row === 0 || row === info.rows - 1);
          const seedHash = Math.sin(col * 127.1 + row * 311.7 + this.level.id * 74.7) * 43758.5453;
          const variation = (seedHash - Math.floor(seedHash) - 0.5) * 0.055;
          shelter[idx] = clamp(info.shelter + (corner ? 0.055 : edge ? 0.018 : 0.0) + variation, 0.35, 0.995);
        }
      }
      return {
        info,
        occupant: new Int32Array(count).fill(-1),
        cocoonDouble: new Uint8Array(count),
        inspectorA: new Int32Array(count).fill(-1),
        inspectorB: new Int32Array(count).fill(-1),
        goalClaim: new Int32Array(count).fill(-1),
        claimAt: new Float64Array(count).fill(-100),
        shelter,
        lastFlip: -10,
      };
    });
  }

  private spawnWorms() {
    const active = this.sheets.filter((s) => !s.info.spare);
    const weights = active.map((s) => s.info.cols * s.info.rows);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const counts: number[] = [];
    let assigned = 0;
    for (let i = 0; i < active.length; i++) {
      const count = i === active.length - 1 ? this.total - assigned : Math.round((this.total * weights[i]) / totalWeight);
      counts.push(count);
      assigned += count;
    }

    let id = 0;
    for (let sheetPos = 0; sheetPos < active.length; sheetPos++) {
      const runtimeIndex = this.sheets.indexOf(active[sheetPos]);
      const sheet = this.sheets[runtimeIndex];
      const info = sheet.info;
      const count = counts[sheetPos];
      for (let j = 0; j < count && id < this.total; j++, id++) {
        this.sheetIndex[id] = runtimeIndex;
        // Low-discrepancy horizontal placement keeps one tray wave from dumping
        // every seventh worm into the same bottom-row cell.
        const columnFraction = (j + 0.35 + this.rng() * 0.3) / Math.max(1, count);
        this.x[id] = info.x + 12 + columnFraction * Math.max(10, info.width - 24);
        this.y[id] = info.y + info.height + 10 + this.rng() * 28;
        this.vx[id] = (this.rng() - 0.5) * 8;
        this.vy[id] = -18 - this.rng() * 8;
        this.size[id] = clamp(gaussian(this.rng, this.level.sizeMean, this.level.sizeSd), 0.72, 1.28);
        this.speedBase[id] = 25 + this.rng() * 8;
        this.stamina[id] = 100;
        this.phase[id] = this.rng() * Math.PI * 2;
        this.state[id] = STATE_SEARCH;
        this.appendSample(id);
      }
    }
  }

  start() {
    this.pushEvent({ t: this.time, type: 'tip', message: '熟蚕上蔟：观察高端、强光侧与成团速度。' });
  }

  setPaused(paused: boolean) {
    this.settings.paused = paused;
  }

  setSpeed(speed: number) {
    this.settings.speed = speed;
  }

  setTilt(degrees: number) {
    this.settings.tilt = clamp(degrees, -30, 30);
  }

  setLights(on: boolean) {
    if (this.settings.lightsOn === on) return;
    this.settings.lightsOn = on;
    this.pushEvent({ t: this.time, type: 'light', message: on ? '开灯：光斑变强，蚕会避开亮处。' : '关灯：蔟片暗下来，蚕更愿意进格。' });
  }

  setFan(on: boolean) {
    if (this.settings.fanOn === on) return;
    this.settings.fanOn = on;
    this.pushEvent({ t: this.time, type: 'fan', message: on ? '风扇开启：闷热消耗降低。' : '风扇关闭：室内重新闷热。' });
  }

  select(wormId?: number) {
    this.selectedId = wormId;
  }

  flip(sheetIndex?: number): boolean {
    const targets = sheetIndex === undefined ? this.sheets.map((_, i) => i) : [sheetIndex];
    let flipped = false;
    for (const si of targets) {
      const sheet = this.sheets[si];
      if (!sheet || this.time - sheet.lastFlip < 2.5) continue;
      sheet.lastFlip = this.time;
      flipped = true;
      const info = sheet.info;

      for (let id = 0; id < this.total; id++) {
        if (this.sheetIndex[id] !== si) continue;
        const mirroredY = info.y + info.height - (this.y[id] - info.y);
        this.x[id] = info.x + info.width - (this.x[id] - info.x);
        // Worms still in the tray below cannot be mirrored above the frame;
        // place them at the new lower entry edge after the end-for-end flip.
        this.y[id] = mirroredY < info.y - 4 ? info.y + info.height + 10 + this.rng() * 22 : mirroredY;
        this.vx[id] = -this.vx[id];
        this.vy[id] = Math.abs(this.vy[id]) + 6;
        this.goalCell[id] = -1;
        this.repathT[id] = 0;
        this.frustration[id] = 0;
        // The turn breaks the high-end jam and gives the worm a broad second search.
        this.reliefUntil[id] = this.time + 22;
        if (this.cellIndex[id] >= 0) {
          const old = this.cellIndex[id];
          const col = old % info.cols;
          const row = Math.floor(old / info.cols);
          this.cellIndex[id] = (info.rows - 1 - row) * info.cols + (info.cols - 1 - col);
        }
      }

      const mapIndex = (old: number) => {
        const col = old % info.cols;
        const row = Math.floor(old / info.cols);
        return (info.rows - 1 - row) * info.cols + (info.cols - 1 - col);
      };
      const remapInt32 = (oldArr: Int32Array) => {
        const next = new Int32Array(oldArr.length).fill(-1);
        for (let i = 0; i < oldArr.length; i++) if (oldArr[i] >= 0) next[mapIndex(i)] = oldArr[i];
        return next;
      };
      const remapUint8 = (oldArr: Uint8Array) => {
        const next = new Uint8Array(oldArr.length);
        for (let i = 0; i < oldArr.length; i++) next[mapIndex(i)] = oldArr[i];
        return next;
      };
      const remapFloat64 = (oldArr: Float64Array) => {
        const next = new Float64Array(oldArr.length).fill(-100);
        for (let i = 0; i < oldArr.length; i++) next[mapIndex(i)] = oldArr[i];
        return next;
      };
      sheet.occupant = remapInt32(sheet.occupant);
      sheet.inspectorA = remapInt32(sheet.inspectorA);
      sheet.inspectorB = remapInt32(sheet.inspectorB);
      // Every goal is invalidated by the turn, so claims must not be remapped.
      sheet.goalClaim = new Int32Array(sheet.goalClaim.length).fill(-1);
      sheet.claimAt = remapFloat64(sheet.claimAt);
      sheet.cocoonDouble = remapUint8(sheet.cocoonDouble);

      this.pushEvent({
        t: this.time,
        type: 'flip',
        sheetId: info.id,
        message: `翻转 ${info.label} ${info.specName}：原高端蚕群转向新的高处。`,
      });
    }
    return flipped;
  }

  rescue(wormId: number, targetSheetIndex?: number): boolean {
    if (wormId < 0 || wormId >= this.total || this.completed) return false;
    if (this.state[wormId] !== STATE_SEARCH && this.state[wormId] !== STATE_INSPECT) return false;

    let target = targetSheetIndex;    if (target === undefined) {
      const spare = this.sheets.find((s) => s.info.spare);
      target = spare?.info.index;
    }
    const sheet = target === undefined ? undefined : this.sheets[target];
    if (!sheet) return false;

    this.clearGoalClaim(wormId);
    this.clearInspector(wormId);
    const info = sheet.info;
    this.sheetIndex[wormId] = info.index;
    this.x[wormId] = info.x + info.width * (0.35 + this.rng() * 0.3);
    this.y[wormId] = info.y + info.height + 14 + this.rng() * 18;
    this.vx[wormId] = (this.rng() - 0.5) * 10;
    this.vy[wormId] = -20;
    this.state[wormId] = STATE_SEARCH;
    this.cellIndex[wormId] = -1;
    this.pairWith[wormId] = -1;
    this.rejectT[wormId] = 0;
    this.frustration[wormId] = 0;
    this.reliefUntil[wormId] = this.time + 20;
    this.stamina[wormId] = Math.min(100, this.stamina[wormId] + 30);
    this.rescued[wormId] = 1;
    this.wormEvents[wormId].push({ t: this.time, type: 'rescue', wormId, message: `蚕 #${wormId + 1} 被捡到 ${info.label} 空蔟片。` });
    this.pushEvent({ t: this.time, type: 'rescue', wormId, sheetId: info.id, message: `已把 #${wormId + 1} 送到 ${info.label}。` });
    this.appendSample(wormId);
    return true;
  }

  /** Real elapsed frame time. Speed and fixed substeps are handled here. */
  advance(frameDt: number) {
    if (this.settings.paused || this.completed) return;
    const scaled = clamp(frameDt, 0, 0.1) * this.settings.speed;
    let remaining = scaled;
    while (remaining > 0.0001 && !this.completed) {
      const dt = Math.min(FIXED_STEP, remaining);
      this.update(dt);
      remaining -= dt;
    }
  }

  update(dt: number) {
    if (this.completed) return;
    this.time += dt;

    for (let id = 0; id < this.total; id++) {
      if (this.state[id] >= STATE_SINGLE) {
        this.sampleClock[id] += dt;
        if (this.sampleClock[id] >= SAMPLE_INTERVAL) {
          this.sampleClock[id] = 0;
          this.appendSample(id);
        }
        continue;
      }
      this.updateWorm(id, dt);
      this.sampleClock[id] += dt;
      if (this.sampleClock[id] >= SAMPLE_INTERVAL) {
        this.sampleClock[id] = 0;
        this.appendSample(id);
      }
    }

    const metrics = this.computeMetrics();
    if (metrics.active === 0) {
      this.finishClock += dt;
      if (!this.result) this.finish();
    }
  }

  private updateWorm(id: number, dt: number) {
    this.age[id] += dt;
    if (this.rejectT[id] > 0) this.rejectT[id] -= dt;

    const si = this.sheetIndex[id];
    const sheet = this.sheets[si];
    const info = sheet.info;
    const brightness = this.lightAt(this.x[id], this.y[id]);
    const reliefActive = this.time < this.reliefUntil[id];
    if (this.state[id] === STATE_SEARCH) this.frustration[id] = Math.min(1, this.frustration[id] + dt / 95);
    else this.frustration[id] = Math.max(0, this.frustration[id] - dt * 1.8);

    let drain = 0.9 * (1 + this.frustration[id] * 0.45) * (this.level.drainScale ?? 1);
    if (reliefActive) drain *= 0.12;
    drain += Math.max(0, this.speedBase[id] - 27) * 0.025;
    if (brightness > 0.43) drain += (brightness - 0.43) * 1.45;
    let heat = this.level.heat * (this.settings.lightsOn ? 1.25 : 0.62);
    if (this.settings.fanOn) heat *= 0.25;
    else drain += 0.08;
    drain += heat;
    if (this.settings.fanOn) drain *= 0.9;
    this.stamina[id] = Math.max(0, this.stamina[id] - drain * dt);

    if (this.stamina[id] <= 0) {
      this.flatten(id);
      return;
    }

    if (this.state[id] === STATE_INSPECT) {
      this.updateInspection(id, dt, sheet, info);
      return;
    }

    this.evaluateCell(id, sheet, info, brightness);
    this.moveSearching(id, dt, info, brightness);
  }

  private chooseCellGoal(id: number, sheet: SheetRuntime, info: SheetInfo) {
    this.clearGoalClaim(id);
    const current = this.cellAt(id, info);
    const centerCol = current >= 0 ? current % info.cols : clamp(Math.floor((this.x[id] - info.x) / info.cell), 0, info.cols - 1);
    const centerRow = current >= 0 ? Math.floor(current / info.cols) : clamp(Math.floor((this.y[id] - info.y) / info.cell), 0, info.rows - 1);
    const rawDesperation = 1 - this.stamina[id] / 100;
    const reliefActive = this.time < this.reliefUntil[id];
    const relief = reliefActive ? 0.48 : 0;
    const desperation = clamp(rawDesperation + relief, 0, 1);
    const radius = reliefActive ? Math.max(info.cols, info.rows) + 4 : 3 + Math.round(rawDesperation * 4);
    const sizeTolerance = 0.2 + desperation * 0.22;
    const tiltSign = Math.sign(this.settings.tilt);
    let best = -1;
    let bestScore = -Infinity;

    for (let row = Math.max(0, centerRow - radius); row <= Math.min(info.rows - 1, centerRow + radius); row++) {
      for (let col = Math.max(0, centerCol - radius); col <= Math.min(info.cols - 1, centerCol + radius); col++) {
        const cell = row * info.cols + col;
        if (sheet.occupant[cell] >= 0 || sheet.inspectorA[cell] >= 0 || sheet.inspectorB[cell] >= 0) continue;
        if (sheet.goalClaim[cell] >= 0 && sheet.goalClaim[cell] !== id) continue;
        if (Math.abs(this.size[id] - info.aperture) > sizeTolerance + 0.08) continue;

        const dxCell = col - centerCol;
        const dyCell = row - centerRow;
        const distance = Math.hypot(dxCell, dyCell);
        const cx = info.x + (col + 0.5) * info.cell;
        const cy = info.y + (row + 0.5) * info.cell;
        const dark = 1 - clamp(this.lightAt(cx, cy), 0, 1);
        let score = sheet.shelter[cell] * 0.58 + dark * 0.28;
        score += -dyCell * 0.28; // strongly prefer cells above the worm
        score += dxCell * tiltSign * 0.12; // prefer the current high end
        score -= Math.max(0, dyCell) * 0.12; // do not voluntarily work downward early
        score -= distance * 0.045;
        score += (Math.sin(id * 19.19 + cell * 7.31) * 0.5 + 0.5) * 0.08;
        if (score > bestScore) {
          bestScore = score;
          best = cell;
        }
      }
    }
    this.goalCell[id] = best;
    // Only the post-flip reorientation strongly reserves a cell. Before a flip,
    // competing intentions are deliberately loose and recreate high-end jams.
    if (best >= 0 && reliefActive) sheet.goalClaim[best] = id;
    this.repathT[id] = 0.35 + this.rng() * 0.55;
  }

  private moveSearching(id: number, dt: number, info: SheetInfo, brightness: number) {
    const sheet = this.sheets[this.sheetIndex[id]];
    this.repathT[id] -= dt;
    let goalX = 0;
    let goalY = 0;
    let goalWeight = 0;
    if (this.repathT[id] <= 0) this.chooseCellGoal(id, sheet, info);
    if (this.goalCell[id] >= 0) {
      const goal = this.goalCell[id];
      if (sheet.occupant[goal] >= 0 || sheet.inspectorA[goal] >= 0 || sheet.inspectorB[goal] >= 0) {
        this.clearGoalClaim(id);
        this.repathT[id] = 0;
      } else {
        const gCol = goal % info.cols;
        const gRow = Math.floor(goal / info.cols);
        const gx = info.x + (gCol + 0.5) * info.cell - this.x[id];
        const gy = info.y + (gRow + 0.5) * info.cell - this.y[id];
        const gl = Math.hypot(gx, gy) || 1;
        goalX = gx / gl;
        goalY = gy / gl;
        goalWeight = this.time < this.reliefUntil[id] ? 3.4 : 1.45;
      }
    }

    const tilt = (this.settings.tilt * Math.PI) / 180;
    let dx = Math.sin(tilt) * 1.05 + goalX * goalWeight;
    let dy = -Math.cos(tilt) * 1.02 + goalY * goalWeight;

    const p = this.phase[id];
    const a = this.age[id];
    dx += Math.sin(a * 1.55 + p) * 0.34 + Math.sin(a * 0.57 + p * 2.1) * 0.18;
    dy += Math.cos(a * 1.05 + p) * 0.08;

    // Light sensors in normalized room coordinates, wide enough to read gradients.
    const nx = this.x[id] / this.world.width;
    const ny = this.y[id] / this.world.height;
    const sx = 0.026;
    const sy = 0.04;
    const bL = this.lightAtNorm(nx - sx, ny);
    const bR = this.lightAtNorm(nx + sx, ny);
    const bUp = this.lightAtNorm(nx, ny - sy);
    const bDown = this.lightAtNorm(nx, ny + sy);
    const gx = (bR - bL) * 5.2;
    const gy = (bUp - bDown) * 4.4;
    dx -= gx;
    dy -= gy;

    const aheadB = this.lightAtNorm(nx + dx * 0.035, ny + dy * 0.035);
    if (aheadB > 0.62 || brightness > 0.78) {
      // Strong patch ahead: U-turn toward the darker side.
      dx += -this.vx[id] * 0.055 + (this.rng() - 0.5) * 1.4;
      dy += 1.25;
    }

    const left = info.x + 7;
    const right = info.x + info.width - 7;
    const top = info.y + 8;
    const bottom = info.y + info.height - 4;
    if (this.x[id] < left + 26) dx += 1.25;
    if (this.x[id] > right - 26) dx -= 1.25;
    if (this.y[id] < top + 30) dy += 1.15 + Math.sin(p) * 0.25;
    if (this.y[id] > bottom - 24) dy -= 1.35;

    // A rejected/occupied cell gets a small sideways dodge.
    if (this.rejectT[id] > 0 && this.cellIndex[id] >= 0) {
      dx += Math.sin(this.phase[id] * 3.1) > 0 ? 1.15 : -1.15;
      dy += 0.25;
    }

    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const speed = this.speedBase[id] * (0.86 + (1 - this.stamina[id] / 100) * 0.28);
    const follow = 1 - Math.exp(-5.2 * dt);
    this.vx[id] = lerp(this.vx[id], dx * speed, follow);
    this.vy[id] = lerp(this.vy[id], dy * speed, follow);

    this.x[id] = clamp(this.x[id] + this.vx[id] * dt, info.x + 3, info.x + info.width - 3);
    this.y[id] = clamp(this.y[id] + this.vy[id] * dt, info.y + 3, info.y + info.height + 38);
  }

  private cellAt(id: number, info: SheetInfo): number {
    const col = Math.floor((this.x[id] - info.x) / info.cell);
    const row = Math.floor((this.y[id] - info.y) / info.cell);
    if (col < 0 || col >= info.cols || row < 0 || row >= info.rows) return -1;
    return row * info.cols + col;
  }

  private evaluateCell(id: number, sheet: SheetRuntime, info: SheetInfo, brightness: number) {
    const cell = this.cellAt(id, info);
    this.cellIndex[id] = cell;
    if (cell < 0) return;
    if (sheet.occupant[cell] >= 0) {
      this.rejectT[id] = Math.max(this.rejectT[id], 0.35);
      return;
    }
    if (this.rejectT[id] > 0) return;
    const a = sheet.inspectorA[cell];
    const b = sheet.inspectorB[cell];
    if ((a >= 0 && a !== id) || (b >= 0 && b !== id)) {
      // A cell is reserved after a short simultaneous-entry window. Only worms
      // that arrived in that narrow race can become a double-cocoon pair.
      const canRace = b === -1 && this.time - sheet.claimAt[cell] <= 0.045;
      if (!canRace) {
        this.rejectT[id] = 0.45 + this.rng() * 0.35;
        return;
      }
    }

    const aperture = info.aperture;
    const sizeDiff = Math.abs(this.size[id] - aperture);
    const rawDesperation = 1 - this.stamina[id] / 100;
    const relief = this.time < this.reliefUntil[id] ? 0.35 : 0;
    const desperation = clamp(rawDesperation + relief, 0, 1);
    const sizeTolerance = 0.15 + desperation * 0.19;
    if (sizeDiff > sizeTolerance) {
      this.rejectCell(id, cell, sizeDiff > 0.24 ? '太大' : '太小');
      return;
    }

    const fit = clamp(1 - sizeDiff / 0.25, 0, 1);
    const dark = 1 - clamp(brightness, 0, 1);
    const row = Math.floor(cell / info.cols);
    const climbAmbition = relief > 0 ? 0 : (this.stamina[id] / 100) * 0.29 * (row / Math.max(1, info.rows - 1));
    const score = 0.43 * sheet.shelter[cell] + 0.25 * fit + 0.2 * dark + 0.12 * (0.45 + desperation * 0.55) - climbAmbition;
    const threshold = 0.765 - desperation * 0.235;
    if (score < threshold) {
      this.rejectT[id] = 0.75 + this.rng() * 0.5;
      return;
    }

    this.beginInspection(id, sheet, cell);
  }

  private rejectCell(id: number, cell: number, reason: string) {
    this.rejectT[id] = 0.9 + this.rng() * 0.7;
    if (this.rng() < 0.08) {
      this.wormEvents[id].push({ t: this.time, type: 'tip', wormId: id, message: `#${id + 1} 试格后退出：${reason}不合身。` });
    }
    void cell;
  }

  private beginInspection(id: number, sheet: SheetRuntime, cell: number) {
    if (this.goalCell[id] === cell) this.clearGoalClaim(id);
    let slot: 'A' | 'B';
    if (sheet.inspectorA[cell] === -1) {
      sheet.inspectorA[cell] = id;
      sheet.claimAt[cell] = this.time;
      slot = 'A';
    } else if (sheet.inspectorA[cell] === id) {
      slot = 'A';
    } else if (sheet.inspectorB[cell] === -1) {
      sheet.inspectorB[cell] = id;
      slot = 'B';
      const other = sheet.inspectorA[cell];
      if (other >= 0 && this.state[other] === STATE_INSPECT && this.cellIndex[other] === cell) {
        this.pairWith[id] = other;
        this.pairWith[other] = id;
        const shared = 0.85 + this.rng() * 0.35;
        this.inspectT[id] = shared;
        this.inspectT[other] = shared + 0.02;
        this.inspectTotal[id] = shared;
        this.inspectTotal[other] = shared + 0.02;
      }
    } else if (sheet.inspectorB[cell] === id) {
      slot = 'B';
    } else {
      this.rejectT[id] = 0.5;
      return;
    }

    if (slot === 'A' && this.state[id] !== STATE_INSPECT) {
      const duration = 1.15 + this.rng() * 0.85;
      this.inspectT[id] = duration;
      this.inspectTotal[id] = duration;
    }
    this.state[id] = STATE_INSPECT;
    this.cellIndex[id] = cell;
  }

  private updateInspection(id: number, dt: number, sheet: SheetRuntime, info: SheetInfo) {
    const cell = this.cellIndex[id];
    if (cell < 0 || sheet.occupant[cell] >= 0) {
      this.clearInspector(id);
      this.state[id] = STATE_SEARCH;
      this.rejectT[id] = 0.5;
      return;
    }

    const col = cell % info.cols;
    const row = Math.floor(cell / info.cols);
    const cx = info.x + (col + 0.5) * info.cell;
    const cy = info.y + (row + 0.5) * info.cell;
    const progress = clamp(1 - this.inspectT[id] / Math.max(0.001, this.inspectTotal[id]), 0, 1);
    const angle = this.phase[id] + progress * Math.PI * 2.15;
    const radius = info.cell * 0.27;
    this.x[id] = cx + Math.cos(angle) * radius;
    this.y[id] = cy + Math.sin(angle) * radius * 0.78;
    this.vx[id] = -Math.sin(angle) * 18;
    this.vy[id] = Math.cos(angle) * 14;
    this.inspectT[id] -= dt;

    if (this.inspectT[id] <= 0) this.finishInspection(id, sheet, cell);
  }

  private finishInspection(id: number, sheet: SheetRuntime, cell: number) {
    if (this.state[id] !== STATE_INSPECT || this.cellIndex[id] !== cell) return;
    const partner = this.pairWith[id];

    if (partner >= 0 && partner > id && this.state[partner] === STATE_INSPECT && this.cellIndex[partner] === cell) {
      // Higher id lets the lower id resolve the pair on the same simulation step.
      return;
    }

    if (partner >= 0 && this.state[partner] === STATE_INSPECT && this.cellIndex[partner] === cell) {
      const makeDouble = this.rng() < this.level.doubleChance;
      this.clearInspector(id);
      this.clearInspector(partner);
      this.pairWith[id] = -1;
      this.pairWith[partner] = -1;
      if (makeDouble) {
        this.settleDouble(sheet, cell, id, partner);
      } else {
        this.settleSingle(sheet, cell, id);
        this.evictWorm(partner, sheet, cell, 9);
      }
      return;
    }

    this.pairWith[id] = -1;
    const brightness = this.lightAt(this.x[id], this.y[id]);
    const desperation = 1 - this.stamina[id] / 100;
    const wallPass = this.rng() < sheet.shelter[cell] * (0.82 + desperation * 0.22) + desperation * 0.08;
    const brightFail = brightness > 0.72 && this.rng() < 0.55;
    if (!wallPass || brightFail) {
      this.clearInspector(id);
      this.state[id] = STATE_SEARCH;
      this.rejectT[id] = 1.0 + this.rng() * 0.8;
      this.wormEvents[id].push({ t: this.time, type: 'tip', wormId: id, message: brightFail ? '#%d 嫌格内光太强，掉头继续找。'.replace('%d', String(id + 1)) : `#${id + 1} 试壁后觉得遮挡不足，继续找角格。` });
      return;
    }

    this.clearInspector(id);
    this.settleSingle(sheet, cell, id);
  }

  private settleSingle(sheet: SheetRuntime, cell: number, id: number) {
    this.clearGoalClaim(id);
    sheet.occupant[cell] = id;
    sheet.cocoonDouble[cell] = 0;
    this.state[id] = STATE_SINGLE;
    this.cellIndex[id] = cell;
    this.pairWith[id] = -1;
    const info = sheet.info;
    const col = cell % info.cols;
    const row = Math.floor(cell / info.cols);
    this.x[id] = info.x + (col + 0.5) * info.cell;
    this.y[id] = info.y + (row + 0.52) * info.cell;
    this.vx[id] = 0;
    this.vy[id] = 0;
    this.appendSample(id);
  }

  private settleDouble(sheet: SheetRuntime, cell: number, a: number, b: number) {
    this.clearGoalClaim(a);
    this.clearGoalClaim(b);
    sheet.occupant[cell] = a;
    sheet.cocoonDouble[cell] = 1;
    for (const id of [a, b]) {
      this.state[id] = STATE_DOUBLE;
      this.cellIndex[id] = cell;
      this.pairWith[id] = -1;
      this.vx[id] = 0;
      this.vy[id] = 0;
      this.wormEvents[id].push({ t: this.time, type: 'double', wormId: id, message: `#${id + 1} 与另一条蚕同结双宫茧。` });
      this.appendSample(id);
    }
    const info = sheet.info;
    const col = cell % info.cols;
    const row = Math.floor(cell / info.cols);
    const cx = info.x + (col + 0.5) * info.cell;
    const cy = info.y + (row + 0.52) * info.cell;
    this.x[a] = cx - info.cell * 0.13;
    this.y[a] = cy;
    this.x[b] = cx + info.cell * 0.13;
    this.y[b] = cy;
    this.pushEvent({ t: this.time, type: 'double', wormId: a, sheetId: info.id, message: `${info.label} 格内两条蚕结成双宫茧。` });
  }

  private evictWorm(id: number, sheet: SheetRuntime, cell: number, staminaCost: number) {
    const info = sheet.info;
    const col = cell % info.cols;
    const row = Math.floor(cell / info.cols);
    this.state[id] = STATE_SEARCH;
    this.cellIndex[id] = -1;
    this.pairWith[id] = -1;
    this.stamina[id] = Math.max(1, this.stamina[id] - staminaCost);
    this.rejectT[id] = 1.1;
    this.x[id] = info.x + (col + 0.5) * info.cell + (this.rng() < 0.5 ? -info.cell * 0.7 : info.cell * 0.7);
    this.y[id] = info.y + (row + 0.5) * info.cell;
    this.vx[id] = (this.rng() - 0.5) * 30;
    this.vy[id] = -12;
    this.wormEvents[id].push({ t: this.time, type: 'tip', wormId: id, message: `#${id + 1} 在双蚕竞争中被挤出格子。` });
  }

  private flatten(id: number) {
    this.clearGoalClaim(id);
    this.clearInspector(id);
    this.state[id] = STATE_FLAT;
    this.stamina[id] = 0;
    this.vx[id] = 0;
    this.vy[id] = 0;
    this.cellIndex[id] = -1;
    this.pairWith[id] = -1;
    this.wormEvents[id].push({ t: this.time, type: 'flat', wormId: id, message: `#${id + 1} 体力耗尽，在原地吐成平板丝。` });
    this.pushEvent({ t: this.time, type: 'flat', wormId: id, message: `#${id + 1} 留下一张平板丝。` });
    this.appendSample(id);
  }

  private clearGoalClaim(id: number) {
    const si = this.sheetIndex[id];
    const sheet = this.sheets[si];
    const goal = this.goalCell[id];
    if (sheet && goal >= 0 && sheet.goalClaim[goal] === id) sheet.goalClaim[goal] = -1;
    this.goalCell[id] = -1;
  }

  private clearInspector(id: number) {
    const si = this.sheetIndex[id];
    const sheet = this.sheets[si];
    const cell = this.cellIndex[id];
    if (!sheet || cell < 0) return;
    if (sheet.inspectorA[cell] === id) sheet.inspectorA[cell] = -1;
    if (sheet.inspectorB[cell] === id) sheet.inspectorB[cell] = -1;
  }

  lightAtNorm(nx: number, ny: number): number {
    let b = this.level.light.ambient;
    for (const src of this.level.light.sources) {
      if (src.kind === 'lamp' && !this.settings.lightsOn) continue;
      const dx = nx - src.nx;
      const dy = ny - src.ny;
      if (src.direction) {
        const dl = Math.hypot(src.direction.x, src.direction.y) || 1;
        const ux = src.direction.x / dl;
        const uy = src.direction.y / dl;
        const along = dx * ux + dy * uy;
        const perp = Math.abs(dx * -uy + dy * ux);
        if (along > -0.12) {
          const reach = src.radius * 1.9;
          const forward = clamp(1 - Math.max(0, along) / reach, 0, 1);
          const side = Math.exp(-(perp * perp) / Math.max(0.04, (src.spread ?? 0.5) ** 2));
          b += src.intensity * forward * side;
        }
      } else {
        const d = Math.hypot(dx, dy) / src.radius;
        if (d < 1) b += src.intensity * Math.pow(1 - d, 1.7);
      }
    }
    return clamp(b, 0, 1.15);
  }

  lightAt(x: number, y: number): number {
    return this.lightAtNorm(x / this.world.width, y / this.world.height);
  }

  private appendSample(id: number) {
    const arr = this.samples[id];
    arr.push(this.time, this.x[id], this.y[id], this.state[id], this.stamina[id], this.sheetIndex[id]);
  }

  private pushEvent(event: GameEvent) {
    this.eventLog.push(event);
    if (this.eventLog.length > 240) this.eventLog.splice(0, this.eventLog.length - 240);
    this.pendingEvents.push(event);
    if (this.pendingEvents.length > 30) this.pendingEvents.shift();
  }

  drainEvents(): GameEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  computeMetrics(): Metrics {
    let searching = 0;
    let inspecting = 0;
    let single = 0;
    let doubleWorms = 0;
    let flat = 0;
    let active = 0;
    let staminaSum = 0;
    let activeForEstimate = 0;
    for (let i = 0; i < this.total; i++) {
      switch (this.state[i]) {
        case STATE_SEARCH:
          searching++;
          active++;
          staminaSum += this.stamina[i];
          activeForEstimate++;
          break;
        case STATE_INSPECT:
          inspecting++;
          active++;
          staminaSum += this.stamina[i];
          activeForEstimate++;
          break;
        case STATE_SINGLE:
          single++;
          break;
        case STATE_DOUBLE:
          doubleWorms++;
          break;
        case STATE_FLAT:
          flat++;
          break;
      }
    }
    const doubleCocoons = doubleWorms / 2;
    const cocoonGroups = single + doubleCocoons;
    return {
      total: this.total,
      active,
      searching,
      inspecting,
      singleCocoons: single,
      doubleCocoons,
      doubleWorms,
      flatSilks: flat,
      rescued: this.rescued.reduce((a, v) => a + v, 0),
      goodRate: single / this.total,
      doubleRate: cocoonGroups > 0 ? doubleCocoons / cocoonGroups : 0,
      flatRate: flat / this.total,
      elapsed: this.time,
      estimatedFinish: activeForEstimate > 0 ? this.time + staminaSum / activeForEstimate / 0.9 : this.time,
    };
  }

  private finish() {
    const metrics = this.computeMetrics();
    const stars = gradeStars(metrics, this.thresholds);
    const pickIds = (predicate: (id: number) => boolean, limit = 14) => {
      const out: number[] = [];
      for (let id = 0; id < this.total && out.length < limit; id++) if (predicate(id)) out.push(id);
      return out;
    };
    this.result = {
      levelId: this.level.id,
      metrics,
      stars,
      thresholds: this.thresholds,
      notable: {
        flat: pickIds((id) => this.state[id] === STATE_FLAT),
        double: pickIds((id) => this.state[id] === STATE_DOUBLE, 16),
        rescued: pickIds((id) => this.rescued[id] === 1, 16),
        steady: pickIds((id) => this.state[id] === STATE_SINGLE, 10),
      },
      completedAt: this.time,
    };
    this.completed = true;
    this.pushEvent({ t: this.time, type: 'finish', message: `上蔟结束：上茧率 ${(metrics.goodRate * 100).toFixed(1)}%，${stars} 星。` });
  }

  getResult(): FinalResult {
    if (!this.result) {
      this.finish();
    }
    return this.result!;
  }

  isComplete(): boolean {
    return this.completed || this.computeMetrics().active === 0;
  }

  createSnapshot(): Snapshot {
    const events = this.drainEvents();
    return {
      t: this.time,
      total: this.total,
      x: this.x.slice(),
      y: this.y.slice(),
      vx: this.vx.slice(),
      vy: this.vy.slice(),
      size: this.size.slice(),
      stamina: this.stamina.slice(),
      state: this.state.slice() as Uint8Array<ArrayBuffer>,
      sheet: this.sheetIndex.slice() as Uint16Array<ArrayBuffer>,
      selectedId: this.selectedId,
      metrics: this.computeMetrics(),
      settings: { ...this.settings },
      recentEvents: events,
    };
  }

  getTrajectory(wormId: number, requestId: number): { requestId: number; trajectory: TrajectoryResponse } | null {
    if (wormId < 0 || wormId >= this.total) return null;
    const flat = Float32Array.from(this.samples[wormId]);
    const result: TrajectoryResponse['result'] =
      this.state[wormId] === STATE_SINGLE
        ? 'single'
        : this.state[wormId] === STATE_DOUBLE
          ? 'double'
          : this.state[wormId] === STATE_FLAT
            ? 'flat'
            : 'active';
    const globalForWorm = this.eventLog.filter((e) => e.type === 'flip' || e.type === 'light' || e.type === 'fan' || e.type === 'finish');
    return {
      requestId,
      trajectory: {
        wormId,
        samples: flat,
        events: [...globalForWorm, ...this.wormEvents[wormId]].sort((a, b) => a.t - b.t),
        result,
        size: this.size[wormId],
      },
    };
  }

  getNotable() {
    return this.getResult().notable;
  }
}

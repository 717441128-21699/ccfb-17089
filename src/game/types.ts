export type PageName = 'setup' | 'live' | 'replay' | 'result';

export type WormStateCode = 0 | 1 | 2 | 3 | 4;
// 0 searching, 1 inspecting a cell, 2 single cocoon, 3 double cocoon, 4 flat silk

export interface ClusterSpec {
  id: string;
  name: string;
  cols: number;
  rows: number;
  /** Render/logical pixel size of one grid cell. */
  cell: number;
  /** Preferred worm size. Worm sizes are normally distributed around 1. */
  aperture: number;
  /** 0..1, how reliably the cell gives four-sided cover. */
  shelter: number;
  blurb: string;
}

export interface LightSourceConfig {
  id: string;
  kind: 'window' | 'lamp';
  /** Normalized room coordinates, 0..1. */
  nx: number;
  ny: number;
  radius: number;
  intensity: number;
  /** Directional wash for windows. Radial when omitted. */
  direction?: { x: number; y: number };
  spread?: number;
}

export interface LightLayout {
  id: string;
  name: string;
  ambient: number;
  sources: LightSourceConfig[];
  description: string;
}

export interface SheetPlacement {
  specId: string;
  spare?: boolean;
  label?: string;
}

export interface LevelConfig {
  id: number;
  name: string;
  solarTerm: string;
  description: string;
  worms: number;
  seed: number;
  columns: number;
  placements: SheetPlacement[];
  initialTilt: number;
  lightsOn: boolean;
  fanOn: boolean;
  /** Extra stamina drain per second in a humid/hot room. Fan removes most of it. */
  heat: number;
  drainScale?: number;
  doubleChance: number;
  sizeMean: number;
  sizeSd: number;
  light: LightLayout;
  flipHint: string;
}

export interface SheetInfo {
  index: number;
  id: string;
  label: string;
  specId: string;
  specName: string;
  spare: boolean;
  cols: number;
  rows: number;
  cell: number;
  x: number;
  y: number;
  width: number;
  height: number;
  aperture: number;
  shelter: number;
}

export interface WorldLayout {
  width: number;
  height: number;
  sheets: SheetInfo[];
}

export interface Metrics {
  total: number;
  active: number;
  searching: number;
  inspecting: number;
  singleCocoons: number;
  doubleCocoons: number;
  doubleWorms: number;
  flatSilks: number;
  rescued: number;
  /** Single-cocoon worms / total worms. */
  goodRate: number;
  /** Double cocoon groups / all cocoon groups. */
  doubleRate: number;
  flatRate: number;
  elapsed: number;
  estimatedFinish: number;
}

export interface GameEvent {
  t: number;
  type: 'flip' | 'light' | 'fan' | 'rescue' | 'double' | 'flat' | 'finish' | 'tip';
  message: string;
  sheetId?: string;
  wormId?: number;
}

export interface Snapshot {
  t: number;
  total: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  size: Float32Array;
  stamina: Float32Array;
  state: Uint8Array;
  sheet: Uint16Array;
  selectedId?: number;
  metrics: Metrics;
  settings: SimSettings;
  recentEvents: GameEvent[];
}

export interface SimSettings {
  tilt: number;
  lightsOn: boolean;
  fanOn: boolean;
  speed: number;
  paused: boolean;
}

export interface FinalResult {
  levelId: number;
  metrics: Metrics;
  stars: 0 | 1 | 2 | 3;
  thresholds: StarThresholds;
  notable: {
    flat: number[];
    double: number[];
    rescued: number[];
    steady: number[];
  };
  completedAt: number;
}

export interface StarThresholds {
  three: { goodRate: number; doubleRate: number; flatRate: number };
  two: { goodRate: number; doubleRate: number; flatRate: number };
  one: { goodRate: number };
}

export interface TrajectoryResponse {
  wormId: number;
  /** Flat sequence: t, x, y, state, stamina, sheetIndex. */
  samples: Float32Array;
  events: GameEvent[];
  result: 'single' | 'double' | 'flat' | 'active';
  size: number;
}

export type WorkerRequest =
  | { type: 'init'; level: LevelConfig }
  | { type: 'start' }
  | { type: 'pause'; paused: boolean }
  | { type: 'speed'; speed: number }
  | { type: 'tilt'; tilt: number }
  | { type: 'flip'; sheetIndex?: number }
  | { type: 'lights'; on: boolean }
  | { type: 'fan'; on: boolean }
  | { type: 'select'; wormId?: number }
  | { type: 'rescue'; wormId: number; targetSheetIndex?: number }
  | { type: 'trajectory'; wormId: number; requestId: number }
  | { type: 'notable' }
  | { type: 'destroy' };

export type WorkerResponse =
  | { type: 'ready'; world: WorldLayout; level: LevelConfig; thresholds: StarThresholds }
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'complete'; result: FinalResult }
  | { type: 'trajectory'; requestId: number; trajectory: TrajectoryResponse }
  | { type: 'notable'; requestId?: number; notable: FinalResult['notable'] }
  | { type: 'toast'; event: GameEvent };

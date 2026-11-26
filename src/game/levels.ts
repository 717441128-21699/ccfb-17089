import type { ClusterSpec, LevelConfig, SheetInfo, StarThresholds, WorldLayout } from './types';

export const CLUSTER_SPECS: Record<string, ClusterSpec> = {
  fang: {
    id: 'fang',
    name: '标准方格蔟',
    cols: 16,
    rows: 10,
    cell: 28,
    aperture: 1.0,
    shelter: 0.92,
    blurb: '160 格，格壁端正，大多数熟蚕都合身。',
  },
  mi: {
    id: 'mi',
    name: '密眼小格蔟',
    cols: 20,
    rows: 12,
    cell: 24,
    aperture: 0.82,
    shelter: 0.97,
    blurb: '240 个小格，遮挡最好；偏大的蚕会在格口转圈后离开。',
  },
  da: {
    id: 'da',
    name: '大孔疏格蔟',
    cols: 12,
    rows: 8,
    cell: 34,
    aperture: 1.2,
    shelter: 0.66,
    blurb: '96 个大格，大个子喜欢，但四壁空阔，试壁失败率高。',
  },
  chang: {
    id: 'chang',
    name: '长条排蔟',
    cols: 24,
    rows: 8,
    cell: 26,
    aperture: 1.03,
    shelter: 0.84,
    blurb: '192 格横向排开，适合斜放，高处一端容易拥挤。',
  },
  huang: {
    id: 'huang',
    name: '篾黄旧蔟片',
    cols: 14,
    rows: 10,
    cell: 28,
    aperture: 0.94,
    shelter: 0.76,
    blurb: '140 格，篾缝漏光，蚕会更挑剔，需要及时关灯。',
  },
};

export const DEFAULT_THRESHOLDS: StarThresholds = {
  three: { goodRate: 0.9, doubleRate: 0.06, flatRate: 0.05 },
  two: { goodRate: 0.76, doubleRate: 0.12, flatRate: 0.09 },
  one: { goodRate: 0.58 },
};

export function layoutLevel(level: LevelConfig): WorldLayout {
  const gapX = 42;
  const gapY = 54;
  const margin = 54;
  const expanded = level.placements.map((p, i) => {
    const spec = CLUSTER_SPECS[p.specId];
    return { p, spec, i };
  });
  const slotW = Math.max(...expanded.map(({ spec }) => spec.cols * spec.cell)) + gapX;
  const slotH = Math.max(...expanded.map(({ spec }) => spec.rows * spec.cell)) + gapY;
  const columns = Math.max(1, level.columns);
  const rows = Math.ceil(expanded.length / columns);
  const width = margin * 2 + columns * slotW - gapX;
  const height = margin * 2 + rows * slotH - gapY;

  const sheets: SheetInfo[] = expanded.map(({ p, spec, i }) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const w = spec.cols * spec.cell;
    const h = spec.rows * spec.cell;
    const slotX = margin + col * slotW;
    const slotY = margin + row * slotH;
    return {
      index: i,
      id: `${level.id}-${i}-${spec.id}`,
      label: p.label ?? `${String.fromCharCode(65 + col)}${row + 1}`,
      specId: spec.id,
      specName: spec.name,
      spare: Boolean(p.spare),
      cols: spec.cols,
      rows: spec.rows,
      cell: spec.cell,
      x: Math.round(slotX + (slotW - gapX - w) / 2),
      y: Math.round(slotY + (slotH - gapY - h) / 2),
      width: w,
      height: h,
      aperture: spec.aperture,
      shelter: spec.shelter,
    };
  });

  return { width, height, sheets };
}

export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: '春雨初蔟',
    solarTerm: '谷雨前 · 一匾试蔟',
    description: '120 条熟蚕和一张标准方格蔟。先学会看高端、翻蔟和拣乱蚕。',
    worms: 120,
    seed: 24042,
    columns: 2,
    placements: [{ specId: 'fang' }, { specId: 'huang', spare: true, label: '空蔟' }],
    initialTilt: -20,
    lightsOn: false,
    fanOn: true,
    heat: 0.05,
    doubleChance: 0.28,
    sizeMean: 1.0,
    sizeSd: 0.07,
    light: {
      id: 'soft-window',
      name: '北窗漫射光',
      ambient: 0.34,
      description: '北窗光线柔和均匀，只有窗边略亮。',
      sources: [{ id: 'win', kind: 'window', nx: 0.02, ny: 0.42, radius: 0.9, intensity: 0.34, direction: { x: 1, y: 0.08 }, spread: 0.55 }],
    },
    flipHint: '约 22–28 秒高端成团时翻第一次，50–58 秒再补翻一次；一次不翻约只有六成上茧。',
  },
  {
    id: 2,
    name: '西窗斜照',
    solarTerm: '立夏 · 强光入蚕室',
    description: '300 条熟蚕，长条排蔟加标准蔟。西窗强光会把蚕逼向暗的一头。',
    worms: 300,
    seed: 25052,
    columns: 4,
    placements: [{ specId: 'chang' }, { specId: 'fang' }, { specId: 'fang' }, { specId: 'fang', spare: true, label: '空蔟' }],
    initialTilt: 10,
    lightsOn: true,
    fanOn: false,
    heat: 0.12,
    doubleChance: 0.22,
    sizeMean: 1.0,
    sizeSd: 0.09,
    light: {
      id: 'west-sun',
      name: '西窗斜阳 + 一盏顶灯',
      ambient: 0.24,
      description: '右侧斜照很强，顶灯只照亮中间走道。关灯可减弱顶灯，窗户挡不住。',
      sources: [
        { id: 'west', kind: 'window', nx: 1.02, ny: 0.34, radius: 1.05, intensity: 0.82, direction: { x: -1, y: 0.12 }, spread: 0.34 },
        { id: 'lamp1', kind: 'lamp', nx: 0.48, ny: 0.04, radius: 0.42, intensity: 0.58 },
      ],
    },
    flipHint: '先关灯，约 28–38 秒把亮端蚕群翻到背光的新高端。',
  },
  {
    id: 3,
    name: '密阁分房',
    solarTerm: '小满 · 大小熟蚕混匾',
    description: '420 条大小不一的熟蚕。密眼蔟壁多但格小，大个子要去标准格。',
    worms: 420,
    seed: 26063,
    columns: 3,
    placements: [{ specId: 'mi' }, { specId: 'fang' }, { specId: 'mi' }, { specId: 'fang' }, { specId: 'chang', spare: true, label: '空蔟' }],
    initialTilt: -8,
    lightsOn: true,
    fanOn: true,
    heat: 0.1,
    drainScale: 0.86,
    doubleChance: 0.2,
    sizeMean: 0.99,
    sizeSd: 0.13,
    light: {
      id: 'two-lamps',
      name: '两盏顶灯',
      ambient: 0.27,
      description: '两团顶灯落在蔟架上，蚕会绕开光斑找暗格。',
      sources: [
        { id: 'l1', kind: 'lamp', nx: 0.28, ny: 0.02, radius: 0.34, intensity: 0.62 },
        { id: 'l2', kind: 'lamp', nx: 0.72, ny: 0.02, radius: 0.34, intensity: 0.62 },
      ],
    },
    flipHint: '30 秒左右翻蔟；把反复从密格退出的大蚕捡到空长排蔟。',
  },
  {
    id: 4,
    name: '千蚕上山',
    solarTerm: '芒种 · 七张标准蔟',
    description: '1000 条熟蚕、十张标准蔟和两张备用空蔟，倾斜方向决定蚕群分布。',
    worms: 1000,
    seed: 27074,
    columns: 4,
    placements: [
      ...Array.from({ length: 10 }, () => ({ specId: 'fang' })),
      { specId: 'fang', spare: true, label: '空蔟一' },
      { specId: 'fang', spare: true, label: '空蔟二' },
    ],
    initialTilt: -16,
    lightsOn: false,
    fanOn: true,
    heat: 0.14,
    doubleChance: 0.26,
    sizeMean: 1.0,
    sizeSd: 0.08,
    light: {
      id: 'diffuse-top',
      name: '荫棚漫射光',
      ambient: 0.3,
      description: '整体不亮，只有上方一条较亮的气窗。',
      sources: [{ id: 'roof', kind: 'window', nx: 0.5, ny: -0.05, radius: 0.72, intensity: 0.42, direction: { x: 0, y: 1 }, spread: 0.9 }],
    },
    flipHint: '25–35 秒是黄金窗口；晚于 55 秒，边缘蚕开始体力不支。',
  },
  {
    id: 5,
    name: '梅雨闷室',
    solarTerm: '夏至 · 高温高湿',
    description: '1800 条蚕，长排蔟与密眼蔟混排。闷热加速体力消耗，风扇不能忘。',
    worms: 1800,
    seed: 28085,
    columns: 4,
    placements: [
      { specId: 'chang' },
      { specId: 'mi' },
      { specId: 'chang' },
      { specId: 'mi' },
      { specId: 'mi' },
      { specId: 'chang' },
      { specId: 'mi' },
      { specId: 'chang' },
      { specId: 'fang' },
      { specId: 'fang' },
      { specId: 'fang' },
      { specId: 'fang' },
      { specId: 'fang', spare: true, label: '空蔟一' },
      { specId: 'fang', spare: true, label: '空蔟二' },
    ],
    initialTilt: 14,
    lightsOn: true,
    fanOn: false,
    heat: 0.42,
    doubleChance: 0.28,
    sizeMean: 0.99,
    sizeSd: 0.1,
    light: {
      id: 'lamp-array',
      name: '三盏烘蔟灯',
      ambient: 0.22,
      description: '三盏灯既亮又烤，开灯会提高蚕的紧迫程度。',
      sources: [
        { id: 'a', kind: 'lamp', nx: 0.18, ny: 0.03, radius: 0.3, intensity: 0.66 },
        { id: 'b', kind: 'lamp', nx: 0.5, ny: 0.03, radius: 0.3, intensity: 0.72 },
        { id: 'c', kind: 'lamp', nx: 0.82, ny: 0.03, radius: 0.3, intensity: 0.66 },
      ],
    },
    flipHint: '先开风扇、关灯；24–32 秒翻第一次，必要时 55 秒补翻拥挤片。',
  },
  {
    id: 6,
    name: '万蚕银山',
    solarTerm: '大暑 · 年终大匾',
    description: '3200 条熟蚕、二十八张标准蔟和两张空蔟。PixiJS 批量绘制，Worker 推演每条轨迹。',
    worms: 3200,
    seed: 29096,
    columns: 6,
    placements: Array.from({ length: 30 }, (_, i) => ({
      specId: 'fang',
      spare: i >= 28,
      label: i >= 28 ? `空蔟${i - 27}` : undefined,
    })),
    initialTilt: -10,
    lightsOn: true,
    fanOn: true,
    heat: 0.24,
    doubleChance: 0.24,
    sizeMean: 1.0,
    sizeSd: 0.08,
    light: {
      id: 'grand-room',
      name: '两侧窗 + 四盏灯',
      ambient: 0.25,
      description: '左右窗光对冲，顶部四盏灯形成亮斑；调角和翻蔟要顺着暗端。',
      sources: [
        { id: 'lw', kind: 'window', nx: -0.02, ny: 0.4, radius: 0.8, intensity: 0.5, direction: { x: 1, y: 0.05 }, spread: 0.5 },
        { id: 'rw', kind: 'window', nx: 1.02, ny: 0.42, radius: 0.8, intensity: 0.5, direction: { x: -1, y: 0.05 }, spread: 0.5 },
        { id: 'l1', kind: 'lamp', nx: 0.25, ny: 0.03, radius: 0.25, intensity: 0.5 },
        { id: 'l2', kind: 'lamp', nx: 0.5, ny: 0.03, radius: 0.25, intensity: 0.55 },
        { id: 'l3', kind: 'lamp', nx: 0.75, ny: 0.03, radius: 0.25, intensity: 0.5 },
      ],
    },
    flipHint: '26–36 秒按片翻高端成团区；全局翻蔟也可，但会牺牲少量节奏。',
  },
];

export function gradeStars(metrics: { goodRate: number; doubleRate: number; flatRate: number }, thresholds = DEFAULT_THRESHOLDS): 0 | 1 | 2 | 3 {
  const t3 = thresholds.three;
  if (metrics.goodRate >= t3.goodRate && metrics.doubleRate <= t3.doubleRate && metrics.flatRate <= t3.flatRate) return 3;
  const t2 = thresholds.two;
  if (metrics.goodRate >= t2.goodRate && metrics.doubleRate <= t2.doubleRate && metrics.flatRate <= t2.flatRate) return 2;
  if (metrics.goodRate >= thresholds.one.goodRate) return 1;
  return 0;
}

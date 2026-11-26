import type {
  FinalResult,
  LevelConfig,
  Snapshot,
  TrajectoryResponse,
  WorkerRequest,
  WorkerResponse,
  WorldLayout,
  StarThresholds,
} from '../game/types';

type Listener = () => void;

export class SimulationClient {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  world: WorldLayout | null = null;
  level: LevelConfig | null = null;
  thresholds: StarThresholds | null = null;
  snapshot: Snapshot | null = null;
  result: FinalResult | null = null;
  ready = false;
  private trajectorySeq = 0;
  private trajectoryWaiters = new Map<number, (t: TrajectoryResponse) => void>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  workerAlive(): boolean {
    return this.worker !== null;
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  start(level: LevelConfig) {
    this.worker?.terminate();
    this.resetState();
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        this.world = msg.world;
        this.level = msg.level;
        this.thresholds = msg.thresholds;
        this.ready = true;
        this.emit();
      } else if (msg.type === 'snapshot') {
        this.snapshot = msg.snapshot;
        this.emit();
      } else if (msg.type === 'complete') {
        this.result = msg.result;
        this.emit();
      } else if (msg.type === 'trajectory') {
        const waiter = this.trajectoryWaiters.get(msg.requestId);
        if (waiter) {
          this.trajectoryWaiters.delete(msg.requestId);
          waiter(msg.trajectory);
        }
      }
    };
    this.worker.postMessage({ type: 'init', level } satisfies WorkerRequest);
  }

  private resetState() {
    this.ready = false;
    this.world = null;
    this.snapshot = null;
    this.result = null;
    this.thresholds = null;
    this.trajectoryWaiters.clear();
  }

  send(message: WorkerRequest) {
    this.worker?.postMessage(message);
  }

  setPaused(paused: boolean) {
    this.send({ type: 'pause', paused });
  }

  setSpeed(speed: number) {
    this.send({ type: 'speed', speed });
  }

  setTilt(tilt: number) {
    this.send({ type: 'tilt', tilt });
  }

  flip(sheetIndex?: number) {
    this.send({ type: 'flip', sheetIndex });
  }

  setLights(on: boolean) {
    this.send({ type: 'lights', on });
  }

  setFan(on: boolean) {
    this.send({ type: 'fan', on });
  }

  select(wormId?: number) {
    this.send({ type: 'select', wormId });
  }

  rescue(wormId: number, targetSheetIndex?: number) {
    this.send({ type: 'rescue', wormId, targetSheetIndex });
  }

  requestTrajectory(wormId: number): Promise<TrajectoryResponse> {
    if (!this.worker) return Promise.reject(new Error('simulation not started'));
    const requestId = ++this.trajectorySeq;
    return new Promise((resolve) => {
      this.trajectoryWaiters.set(requestId, resolve);
      this.send({ type: 'trajectory', wormId, requestId });
    });
  }

  terminate() {
    this.send({ type: 'destroy' });
    this.worker?.terminate();
    this.worker = null;
    this.resetState();
  }
}

export const simClient = new SimulationClient();

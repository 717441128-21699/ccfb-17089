/// <reference lib="webworker" />
import { LEVELS } from '../game/levels';
import type { FinalResult, WorkerRequest, WorkerResponse } from '../game/types';
import { SimulationEngine } from './engine';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let engine: SimulationEngine | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let lastFrame = 0;

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  ctx.postMessage(message, transfer);
}

function startLoop() {
  if (timer !== null) clearInterval(timer);
  lastFrame = performance.now();
  timer = setInterval(() => {
    if (!engine) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    engine.advance(dt);

    const snapshot = engine.createSnapshot();
    const transfer: Transferable[] = [
      snapshot.x.buffer,
      snapshot.y.buffer,
      snapshot.vx.buffer,
      snapshot.vy.buffer,
      snapshot.size.buffer,
      snapshot.stamina.buffer,
      snapshot.state.buffer,
      snapshot.sheet.buffer,
    ];
    post({ type: 'snapshot', snapshot }, transfer);

    if (engine.completed) {
      if (timer !== null) clearInterval(timer);
      timer = null;
      const result: FinalResult = { ...engine.getResult(), completedAt: Date.now() };
      post({ type: 'complete', result });
    }
  }, 1000 / 30);
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    const level = LEVELS.find((l) => l.id === msg.level.id) ?? msg.level;
    engine = new SimulationEngine(level);
    engine.start();
    post({ type: 'ready', world: engine.world, level, thresholds: engine.thresholds });
    startLoop();
    return;
  }
  if (!engine) return;

  switch (msg.type) {
    case 'start':
      engine.setPaused(false);
      startLoop();
      break;
    case 'pause':
      engine.setPaused(msg.paused);
      if (!msg.paused) {
        lastFrame = performance.now();
        if (timer === null) startLoop();
      }
      break;
    case 'speed':
      engine.setSpeed(msg.speed);
      break;
    case 'tilt':
      engine.setTilt(msg.tilt);
      break;
    case 'flip':
      engine.flip(msg.sheetIndex);
      break;
    case 'lights':
      engine.setLights(msg.on);
      break;
    case 'fan':
      engine.setFan(msg.on);
      break;
    case 'select':
      engine.select(msg.wormId);
      break;
    case 'rescue':
      engine.rescue(msg.wormId, msg.targetSheetIndex);
      break;
    case 'trajectory': {
      const response = engine.getTrajectory(msg.wormId, msg.requestId);
      if (response) {
        post(
          { type: 'trajectory', requestId: msg.requestId, trajectory: response.trajectory },
          [response.trajectory.samples.buffer],
        );
      }
      break;
    }
    case 'notable':
      post({ type: 'notable', notable: engine.getNotable() });
      break;
    case 'destroy':
      if (timer !== null) clearInterval(timer);
      timer = null;
      ctx.close();
      break;
  }
};

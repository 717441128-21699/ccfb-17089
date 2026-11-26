import './style.css';
import type { PageName } from './game/types';
import { renderSetup } from './ui/setup-page';
import { renderLive } from './ui/live-page';
import { renderReplay } from './ui/replay-page';
import { renderResult } from './ui/result-page';

const root = document.querySelector<HTMLDivElement>('#app')!;
let cleanup: (() => void) | undefined;

function navigate(page: PageName) {
  const hash = `#/${page}`;
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
}

function route() {
  cleanup?.();
  cleanup = undefined;
  const page = (window.location.hash.replace('#/', '') || 'setup') as PageName;
  root.scrollTop = 0;
  window.scrollTo(0, 0);
  if (page === 'live') cleanup = renderLive(root, navigate);
  else if (page === 'replay') cleanup = renderReplay(root, navigate);
  else if (page === 'result') cleanup = renderResult(root, navigate);
  else cleanup = renderSetup(root, navigate);
}

window.addEventListener('hashchange', route);
route();

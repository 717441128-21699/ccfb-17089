export type ElChild = Node | string | number | false | null | undefined | ElChild[];
export type ElProps = {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

function appendDeep(el: HTMLElement, child: ElChild) {
  if (Array.isArray(child)) {
    for (const nested of child) appendDeep(el, nested);
    return;
  }
  if (child === false || child === null || child === undefined) return;
  el.append(child instanceof Node ? child : document.createTextNode(String(child)));
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElProps = {},
  ...children: ElChild[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'style' && typeof value === 'string') el.style.cssText = value;
    else if (key === 'style' && value && typeof value === 'object') Object.assign(el.style, value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      el.innerHTML = String(value);
    } else if (key.includes('-') || key === 'for') {
      el.setAttribute(key === 'for' ? 'for' : key, String(value));
    } else {
      (el as unknown as Record<string, unknown>)[key] = value;
    }
  }
  for (const child of children) appendDeep(el, child);
  return el;
}

export function clear(el: HTMLElement) {
  el.replaceChildren();
}

export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

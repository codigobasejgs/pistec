export function tourIndex(value: string | null, count: number) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, Math.max(0, count - 1)) : 0;
}
export function isTourVisible(el: HTMLElement | null) {
  if (!el || el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth;
}

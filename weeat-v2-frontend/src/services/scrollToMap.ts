export async function scrollToMap(mapElement: HTMLElement): Promise<void> {
  await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const map = mapElement.getBoundingClientRect();
  const headerBottom = document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0;
  const navTop = document.querySelector('.bottom-nav')?.getBoundingClientRect().top || window.innerHeight;
  const visible = Math.max(0, Math.min(map.bottom, navTop) - Math.max(map.top, headerBottom));
  if (visible >= map.height * 0.6) return;
  const top = Math.max(0, window.scrollY + map.top - headerBottom - 8);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top, behavior: reduced ? 'instant' : 'smooth' });
  if (reduced) return;
  await new Promise<void>(resolve => {
    const timer = window.setTimeout(resolve, 700);
    window.addEventListener('scrollend', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

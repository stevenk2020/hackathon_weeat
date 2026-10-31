const URL_IN_TEXT = /(?:https?:\/\/)?(?:[a-z\d-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s,;<>]+/gi;

function videoKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  if (host === 'youtu.be') return `youtube:${path.slice(1)}`;
  if (host === 'youtube.com') {
    const short = path.match(/^\/shorts\/([\w-]+)$/);
    if (short) return `youtube:${short[1]}`;
    if (path === '/watch' && url.searchParams.get('v')) return `youtube:${url.searchParams.get('v')}`;
  }
  if (host === 'tiktok.com') {
    const video = path.match(/^\/@[^/]+\/(?:video|photo)\/(\d+)$/);
    if (video) return `tiktok:${video[1]}`;
  }
  return `${host}:${path}`;
}

/** Extract links in order. The Discover screen applies the 10-link submission limit. */
export function extractLinks(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const raw = match[0].replace(/[.!?)\]\}…]+$/u, '');
    const link = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try { url = new URL(link); } catch { continue; }
    if (!url.pathname || url.pathname === '/') continue;
    const key = videoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

// GitHub contribution data — no auth, CORS-enabled public proxy of the
// contributions calendar. Returns one entry per day of the current year.

export async function fetchContributions(user) {
  const year = new Date().getFullYear();
  const url = `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(user)}?y=${year}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);   // a hung fetch must not hang the launch
  let res;
  try { res = await fetch(url, { signal: ctrl.signal }); }
  catch (e) { throw new Error(e.name === 'AbortError' ? 'github timed out' : 'network error'); }
  finally { clearTimeout(timer); }
  if (!res.ok) throw new Error(res.status === 404 ? 'user not found' : 'github data unavailable');
  const json = await res.json();
  if (!json.contributions?.length) throw new Error('no contribution data');
  const total = json.total?.[year] ?? json.contributions.reduce((s, d) => s + d.count, 0);
  return { days: json.contributions, total, year, demo: false };
}

// Fallback so the app is never broken — a plausible fake year.
export function demoData() {
  const days = [], start = new Date(new Date().getFullYear(), 0, 1);
  for (let i = 0; i < 364; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const base = Math.sin(i / 9) + Math.sin(i / 2.3) * 0.4;
    const count = Math.max(0, Math.round((base + Math.random() * 1.3 - 0.35) * 9));
    days.push({ date: d.toISOString().slice(0, 10), count });
  }
  return { days, total: days.reduce((s, d) => s + d.count, 0), year: new Date().getFullYear(), demo: true };
}

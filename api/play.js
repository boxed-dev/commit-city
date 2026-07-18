// Appends one JSON line per event (visit or play) to plays.log in the
// private repo boxed-dev/commit-city-logs. GH_TOKEN env var: repo access.
const LOG = 'https://api.github.com/repos/boxed-dev/commit-city-logs/contents/plays.log';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch {}
  const h = req.headers;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    type: body.user ? 'play' : 'visit',
    user: String(body.user || '').slice(0, 60),
    ip: (h['x-forwarded-for'] || '?').split(',')[0].trim(),
    country: h['x-vercel-ip-country'] || '',
    region: h['x-vercel-ip-country-region'] || '',
    city: decodeURIComponent(h['x-vercel-ip-city'] || ''),
    tz: h['x-vercel-ip-timezone'] || '',
    lang: (h['accept-language'] || '').split(',')[0],
    ref: h['referer'] || '',
    ua: (h['user-agent'] || '').slice(0, 160),
  }) + '\n';

  const gh = { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'commit-city', Accept: 'application/vnd.github+json' };
  // ponytail: read-modify-write, a concurrent event can lose a line; fine at this scale
  const cur = await fetch(LOG, { headers: gh }).then(r => (r.ok ? r.json() : null));
  const prev = cur ? Buffer.from(cur.content, 'base64').toString() : '';
  await fetch(LOG, {
    method: 'PUT',
    headers: gh,
    body: JSON.stringify({ message: body.user ? `play: ${body.user}` : 'visit', content: Buffer.from(prev + line).toString('base64'), ...(cur && { sha: cur.sha }) }),
  });
  res.status(204).end();
}

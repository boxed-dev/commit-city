// Appends one JSON line per play to plays.log in the private repo
// boxed-dev/commit-city-logs. GH_TOKEN env var must have repo access.
const LOG = 'https://api.github.com/repos/boxed-dev/commit-city-logs/contents/plays.log';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  let user = '';
  try { user = String((typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}')).user || '').slice(0, 60); } catch {}
  const line = JSON.stringify({
    t: new Date().toISOString(),
    user,
    ip: (req.headers['x-forwarded-for'] || '?').split(',')[0].trim(),
    ua: (req.headers['user-agent'] || '').slice(0, 120),
  }) + '\n';

  const gh = { Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'commit-city', Accept: 'application/vnd.github+json' };
  // ponytail: read-modify-write, a concurrent play can lose a line; fine at this scale
  const cur = await fetch(LOG, { headers: gh }).then(r => (r.ok ? r.json() : null));
  const prev = cur ? Buffer.from(cur.content, 'base64').toString() : '';
  await fetch(LOG, {
    method: 'PUT',
    headers: gh,
    body: JSON.stringify({ message: `play: ${user || '?'}`, content: Buffer.from(prev + line).toString('base64'), ...(cur && { sha: cur.sha }) }),
  });
  res.status(204).end();
}

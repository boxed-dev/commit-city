#!/usr/bin/env python3
"""COMMIT CITY server: static files + visit/play analytics.

Logs (JSON lines, in ./logs/):
  visits.log — every page load: ts, ip, ua
  plays.log  — every INITIALIZE GRID: ts, ip, user

  GET /api/stats → {"visits": n, "unique_ips": n, "plays": n, "players": [...]}
"""
import json, os, time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
LOGS = os.path.join(ROOT, 'logs')
os.makedirs(LOGS, exist_ok=True)

def append(name, obj):
    with open(os.path.join(LOGS, name), 'a') as f:
        f.write(json.dumps(obj) + '\n')

def read(name):
    path = os.path.join(LOGS, name)
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]

class Handler(SimpleHTTPRequestHandler):
    def client_ip(self):
        # respect reverse proxies when published behind one
        return self.headers.get('X-Forwarded-For', self.client_address[0]).split(',')[0].strip()

    def do_GET(self):
        if self.path == '/api/stats':
            visits, plays = read('visits.log'), read('plays.log')
            body = json.dumps({
                'visits': len(visits),
                'unique_ips': len({v['ip'] for v in visits}),
                'plays': len(plays),
                'players': sorted({p.get('user', '?') for p in plays}),
            }).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path in ('/', '/index.html'):
            append('visits.log', {'ts': time.time(), 'ip': self.client_ip(),
                                  'ua': self.headers.get('User-Agent', '')[:200]})
        super().do_GET()

    def do_POST(self):
        if self.path == '/api/play':
            n = int(self.headers.get('Content-Length', 0) or 0)
            try:
                data = json.loads(self.rfile.read(n) or b'{}')
            except json.JSONDecodeError:
                data = {}
            append('plays.log', {'ts': time.time(), 'ip': self.client_ip(),
                                 'user': str(data.get('user', '?'))[:60]})
            self.send_response(204)
            self.end_headers()
            return
        self.send_response(404); self.end_headers()

    def log_message(self, *a):  # quiet console
        pass

if __name__ == '__main__':
    os.chdir(ROOT)
    port = int(os.environ.get('PORT', 8777))
    print(f'COMMIT CITY on http://localhost:{port}  ·  stats: /api/stats  ·  logs/ dir')
    ThreadingHTTPServer(('', port), Handler).serve_forever()

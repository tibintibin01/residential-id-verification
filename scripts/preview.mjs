import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) { response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end('{"error":"Local preview: no live registry"}'); return; }
  const file = path.resolve(root, '.' + (['/', '/verify'].includes(url.pathname) ? '/index.html' : url.pathname));
  if (!file.startsWith(root + path.sep)) { response.writeHead(404); response.end(); return; }
  try { response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(await readFile(file)); }
  catch { response.writeHead(404); response.end(); }
});
server.listen(4173, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:4173/?demo=1'));

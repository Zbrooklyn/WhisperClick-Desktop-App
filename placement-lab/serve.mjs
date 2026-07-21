import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.LAB_PORT || 8792);

http.createServer(async (req, res) => {
  try {
    let p = (req.url || '/').split('?')[0].replace(/^\/+/, '');
    if (p === '' ) p = 'index.html';
    if (!p.endsWith('.html')) p += '.html';
    if (p.includes('..')) { res.writeHead(400); return res.end('bad'); }
    const html = await readFile(join(DIR, p));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(html);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '0.0.0.0', () => console.log('placement-lab on ' + PORT));

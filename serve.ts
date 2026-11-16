// serve.ts — a tiny static server for local play-testing (Node stdlib
// only). Serves this directory on http://localhost:8080 so the game loads
// as ES modules. Not part of the graded output (main.ts copies only
// game/ and screenshots/ to /output).
//
//   node serve.ts
//   open http://localhost:8080/game/index.html

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const file = join(here, path === '/' ? 'game/index.html' : path);
  if (!file.startsWith(here) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

server.listen(8080, () => {
  console.log('FOUNDRY at http://localhost:8080/game/index.html');
});

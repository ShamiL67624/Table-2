import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { menuItems } from './data.mjs';
import { createOrderStore, problem } from './order-store.mjs';
import { createTableStore } from './table-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const adminFiles = new Set(['index.html', 'styles.css', 'app.mjs', 'admin-orders.mjs', 'data.mjs', 'README.md']);
const customerFiles = new Set(['menu.html', 'menu.css', 'menu.mjs']);
const types = { '.html': 'text/html', '.css': 'text/css', '.mjs': 'text/javascript', '.md': 'text/plain' };
export const isLocal = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

export function menuBaseUrl(port, configured = process.env.MENU_BASE_URL) {
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MENU_BASE_URL must be an http(s) origin, such as http://192.168.1.10:3000.');
    return url.origin;
  }
  const addresses = Object.values(networkInterfaces()).flat().filter(item => item && !item.internal && item.family === 'IPv4');
  const address = addresses.find(item => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(item.address)) || addresses[0];
  return `http://${address?.address || '127.0.0.1'}:${port}`;
}

async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw problem('Use application/json.', 415);
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (Buffer.byteLength(text) > 16384) throw problem('Order request is too large.', 413);
  }
  try { return JSON.parse(text); } catch { throw problem('Invalid JSON.'); }
}

export async function createRestaurantServer({ storeFile = path.join(root, 'data', 'orders.json'), tableFile = path.join(path.dirname(storeFile), 'tables.json'), baseUrl } = {}) {
  const seating = await createTableStore(tableFile);
  const store = await createOrderStore(storeFile, { getTable: seating.get });
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const local = isLocal(request.socket.remoteAddress);
      if (pathname.startsWith('/api/admin/') && !local) throw problem('Open admin on the restaurant computer using 127.0.0.1.', 403);
      if (request.method === 'POST') {
        const origin = request.headers.origin;
        if (origin && new URL(origin).host !== request.headers.host) throw problem('Cross-site requests are not allowed.', 403);
        if (pathname === '/api/orders') {
          const result = await store.create(await body(request));
          return send(result.created ? 201 : 200, result);
        }
        if (pathname === '/api/admin/tables') return send(201, { table: await seating.add(await body(request)) });
        if (pathname === '/api/admin/tables/join') return send(200, { table: await seating.join((await body(request))?.tables) });
        const capacity = pathname.match(/^\/api\/admin\/tables\/(T[1-9]\d{0,3})\/capacity$/);
        if (capacity) return send(200, { table: await seating.updateCapacity(capacity[1], (await body(request))?.capacity) });
        const separate = pathname.match(/^\/api\/admin\/tables\/(T[1-9]\d{0,3})\/separate$/);
        if (separate) { await body(request); return send(200, { tables: await seating.separate(separate[1]) }); }
        const confirm = pathname.match(/^\/api\/admin\/orders\/(QR-[A-F0-9]{8})\/confirm$/);
        if (confirm) { await body(request); return send(200, { order: await store.confirm(confirm[1]) }); }
        throw problem('Not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw problem('Method not allowed.', 405);
      if (pathname === '/api/menu') return send(200, { items: menuItems, tables: seating.list().map(item => item.table), seating: seating.list() });
      if (pathname === '/api/admin/orders') return send(200, { orders: store.list() });
      const effectiveBase = () => menuBaseUrl(server.address().port, baseUrl);
      if (pathname === '/api/admin/tables') return send(200, {
        baseUrl: effectiveBase(),
        tables: seating.list().map(table => ({ ...table, url: `${effectiveBase()}/menu?table=${table.table}`, qrUrl: `/api/admin/qr/${table.table}.svg` }))
      });
      const qr = pathname.match(/^\/api\/admin\/qr\/(T[1-9]\d{0,3})\.svg$/);
      if (qr) {
        seating.get(qr[1]);
        const svg = await QRCode.toString(`${effectiveBase()}/menu?table=${qr[1]}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 400, color: { dark: '#163d32', light: '#ffffff' } });
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store', 'Content-Disposition': `inline; filename="${qr[1]}-menu-qr.svg"` });
        response.end(request.method === 'HEAD' ? undefined : svg); return;
      }
      const receipt = pathname.match(/^\/api\/orders\/(QR-[A-F0-9]{8})$/);
      if (receipt) return send(200, { order: store.get(receipt[1], request.headers['x-order-token']) });
      const name = pathname === '/menu' ? 'menu.html' : pathname.slice(1) || 'index.html';
      if (!customerFiles.has(name) && !adminFiles.has(name)) throw problem('Not found.', 404);
      if (adminFiles.has(name) && !local) throw problem('Admin is available on the restaurant computer only.', 403);
      const data = await readFile(path.join(root, name));
      response.writeHead(200, { 'Content-Type': `${types[path.extname(name)]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!response.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Unable to complete the request. Please try again.' });
      else response.end();
      if (!error.status) console.error('Request failed:', error.message);
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const customerOrigin = menuBaseUrl(port);
  const server = await createRestaurantServer();
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Stop the old server with Ctrl+C or choose another PORT.` : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Restaurant admin: http://127.0.0.1:${port}`);
    console.log(`Customer menu (same Wi-Fi): ${customerOrigin}/menu?table=T1`);
  });
}

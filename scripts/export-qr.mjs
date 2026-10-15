import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import QRCode from 'qrcode';
import { menuBaseUrl } from '../server.mjs';
import { createTableStore } from '../table-store.mjs';

const directory = fileURLToPath(new URL('../qr-codes/', import.meta.url));
const origin = menuBaseUrl(Number(process.env.PORT || 3000));
const seating = await createTableStore(fileURLToPath(new URL('../data/tables.json', import.meta.url)));
const tables = seating.list();
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
await mkdir(directory, { recursive: true });
const cards = [];
for (const { table, capacity } of tables) {
  const url = `${origin}/menu?table=${table}`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 400, color: { dark: '#163d32', light: '#ffffff' } });
  await writeFile(path.join(directory, `${table}.svg`), svg, 'utf8');
  await QRCode.toFile(path.join(directory, `${table}.png`), url, { width: 800, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#163d32', light: '#ffffff' } });
  cards.push(`<article><header><strong>table & thyme</strong><span>${escape(table)} / ${tables.length} TABLES</span></header><small>YOUR TABLE · ${capacity} SEATS</small><h1>${table}</h1><h2>Good food.<br><em>Just a scan away.</em></h2><div class="code">${svg}</div><h3>SCAN TO BROWSE & ORDER</h3><p>Choose your favourites.<br>We’ll bring them to your table.</p><a href="${escape(url)}">Open ${table} menu ↗</a></article>`);
}
await writeFile(path.join(directory, 'tables.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Table & Thyme QR cards</title><style>*{box-sizing:border-box}body{margin:0;background:#f5f4ed;color:#284b36;font-family:Arial,sans-serif}.instructions{max-width:900px;margin:25px auto;padding:0 20px;font-size:13px;line-height:1.8}.cards{max-width:900px;margin:25px auto;display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:0 20px}article{text-align:center;background:#f7f4e9;border:1px solid #d7dfc9;border-radius:16px;padding:28px;break-inside:avoid}article:nth-child(2),article:nth-child(3){background:#eaf0e3}header{display:flex;justify-content:space-between;font-size:12px}header span{font-size:8px;letter-spacing:2px;color:#849373}small{display:block;margin-top:26px;letter-spacing:3px;font-size:8px;color:#849373}h1{font:64px Georgia,serif;margin:8px 0}h2{font:26px Georgia,serif;line-height:1.2;margin:18px 0}em{color:#b76e45}.code{max-width:220px;margin:auto;border-radius:12px;background:#fff;padding:7px}.code svg{width:100%;height:auto;display:block}h3{font-size:8px;letter-spacing:2px;margin-top:20px}p{font-size:11px;line-height:1.8;color:#7c8c6e}a{font-size:11px;color:#46613a}button{background:#173f35;color:white;border:0;border-radius:7px;padding:12px 18px;cursor:pointer}@media(max-width:550px){.cards{grid-template-columns:1fr}}@media print{@page{size:A4;margin:12mm}body{background:white}.instructions,a{display:none}.cards{padding:0;margin:0;max-width:none;gap:8mm;grid-template-columns:1fr 1fr}article{padding:7mm;print-color-adjust:exact;-webkit-print-color-adjust:exact}h1{font-size:42px}h2{font-size:20px;margin:10px 0}small{margin-top:13px}.code{max-width:155px}h3{margin-top:12px}}</style></head><body><div class="instructions"><strong>Your tables. One shared menu.</strong><br>These codes point to ${escape(origin)}. Keep the restaurant server running and connect customer phones to the same Wi-Fi. Test a scan before printing. Regenerate with <code>npm run qr</code> if your computer’s IP address or port changes.<br><button onclick="window.print()">Print all table cards</button></div><main class="cards">${cards.join('')}</main></body></html>`, 'utf8');
console.log(`Created ${tables.length} table codes as SVG and PNG, plus tables.html in ${directory}`);
console.log(`Encoded menu address: ${origin}`);

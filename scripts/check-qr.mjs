import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { menuBaseUrl } from '../server.mjs';
import { createTableStore } from '../table-store.mjs';
import { fileURLToPath } from 'node:url';

const base = menuBaseUrl(Number(process.env.PORT || 3000));
const seating = await createTableStore(fileURLToPath(new URL('../data/tables.json', import.meta.url)));
for (const { table } of seating.list()) {
  const png = PNG.sync.read(await readFile(new URL(`../qr-codes/${table}.png`, import.meta.url)));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  assert.equal(result?.data, `${base}/menu?table=${table}`, `Regenerate or repair ${table}'s QR image.`);
  console.log(`${table}: decoded successfully → ${result.data}`);
}

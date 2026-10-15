import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { menuItems } from './data.mjs';

export const tables = ['T1', 'T2', 'T3', 'T4'];
export const publicOrder = ({ token, requestId, ...order }) => order;
export function problem(message, status = 400) { return Object.assign(new Error(message), { status }); }

export function validateOrder(input, availableTables = tables) {
  if (!input || !availableTables.includes(input.table)) throw problem('Choose a valid table by scanning its QR code.');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId)) throw problem('A valid order request ID is required.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > menuItems.length) throw problem('Add at least one menu item to your order.');
  const seen = new Set();
  const items = input.items.map(line => {
    const item = menuItems.find(item => item.id === line?.id);
    if (!item || !item.available) throw problem('One of your items is unavailable. Please update your order.');
    if (seen.has(item.id) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 20) throw problem('Each item must have a quantity between 1 and 20.');
    seen.add(item.id);
    return { id: item.id, name: item.name, price: item.price, quantity: line.quantity };
  });
  if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 300)) throw problem('Keep your kitchen note under 300 characters.');
  return { table: input.table, requestId: input.requestId, items, note: (input.note || '').trim(), total: items.reduce((sum, item) => sum + item.price * item.quantity, 0) };
}

export async function createOrderStore(file, { getTable } = {}) {
  let orders;
  try {
    orders = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(orders)) throw new Error('Saved orders must be an array.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    orders = [];
  }
  let queue = Promise.resolve();
  const transaction = action => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  };
  async function save(next) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
    await rename(`${file}.tmp`, file);
    orders = next;
  }
  return {
    list: () => [...orders].reverse().map(publicOrder),
    get: (id, token) => {
      const order = orders.find(order => order.id === id && order.token === token);
      if (!order) throw problem('Order not found.', 404);
      return publicOrder(order);
    },
    create: input => transaction(async () => {
      const existing = orders.find(order => order.requestId === input?.requestId);
      if (existing) {
        if (input.table !== existing.table) throw problem('This request was already used. Please start a new order.', 409);
        const validated = validateOrder(input, [existing.table]);
        const sameItems = JSON.stringify(existing.items) === JSON.stringify(validated.items);
        if (existing.table !== validated.table || existing.note !== validated.note || !sameItems) throw problem('This request was already used. Please start a new order.', 409);
        return { order: publicOrder(existing), token: existing.token, created: false };
      }
      let seating;
      if (getTable) {
        try { seating = getTable(input?.table); } catch { throw problem('Choose a valid table by scanning its QR code.'); }
      }
      const validated = validateOrder(input, seating ? [seating.table] : tables);
      const order = { ...validated, ...(seating ? { tableLabel: seating.label, tableGroup: seating.groupTables, seatCapacity: seating.combinedCapacity } : {}), id: `QR-${randomUUID().slice(0, 8).toUpperCase()}`, token: randomBytes(24).toString('hex'), status: 'Ordered', date: new Date().toISOString() };
      await save([...orders, order]);
      return { order: publicOrder(order), token: order.token, created: true };
    }),
    confirm: id => transaction(async () => {
      const order = orders.find(order => order.id === id);
      if (!order) throw problem('Order not found.', 404);
      if (order.status === 'Confirmed') return publicOrder(order);
      const updated = { ...order, status: 'Confirmed', confirmedAt: new Date().toISOString() };
      await save(orders.map(item => item.id === id ? updated : item));
      return publicOrder(updated);
    })
  };
}

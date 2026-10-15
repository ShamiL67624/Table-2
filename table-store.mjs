import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { problem } from './order-store.mjs';

export const tableIdPattern = /^T[1-9]\d{0,3}$/;
const capacityValue = value => {
  if (!Number.isInteger(value) || value < 1 || value > 30) throw problem('Seat capacity must be a whole number from 1 to 30.');
  return value;
};

export async function createTableStore(file) {
  let tables;
  try {
    tables = JSON.parse(await readFile(file, 'utf8'));
    if (!Array.isArray(tables) || tables.some(table => !tableIdPattern.test(table.table) || !Number.isInteger(table.capacity) || table.capacity < 1 || table.capacity > 30) || new Set(tables.map(table => table.table)).size !== tables.length) throw new Error('The saved table configuration is invalid.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    tables = [1, 2, 3, 4].map(number => ({ table: `T${number}`, capacity: 4, groupId: null }));
  }
  let queue = Promise.resolve();
  const transaction = action => {
    const result = queue.then(action);
    queue = result.catch(() => {});
    return result;
  };
  const summarize = table => {
    const members = table.groupId ? tables.filter(item => item.groupId === table.groupId) : [table];
    return { ...table, groupTables: members.map(item => item.table), label: members.map(item => item.table).join(' + '), combinedCapacity: members.reduce((sum, item) => sum + item.capacity, 0) };
  };
  const list = () => tables.map(summarize);
  const get = id => {
    const table = tables.find(item => item.table === id);
    if (!table) throw problem('Table not found. Please scan the QR code on your table.', 404);
    return summarize(table);
  };
  const save = async next => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), 'utf8');
    await rename(`${file}.tmp`, file);
    tables = next;
  };
  return {
    list, get,
    add: input => transaction(async () => {
      const nextNumber = Math.max(0, ...tables.map(item => Number(item.table.slice(1)))) + 1;
      const name = typeof input?.table === 'string' ? input.table.trim().toUpperCase() : '';
      const table = name || `T${nextNumber}`;
      if (!tableIdPattern.test(table)) throw problem('Use a table name such as T5, between T1 and T9999.');
      if (tables.some(item => item.table === table)) throw problem(`${table} already exists. Choose another name.`, 409);
      const capacity = capacityValue(input?.capacity);
      await save([...tables, { table, capacity, groupId: null }].sort((a, b) => Number(a.table.slice(1)) - Number(b.table.slice(1))));
      return get(table);
    }),
    updateCapacity: (id, capacity) => transaction(async () => {
      get(id); capacityValue(capacity);
      await save(tables.map(item => item.table === id ? { ...item, capacity } : item));
      return get(id);
    }),
    join: ids => transaction(async () => {
      if (!Array.isArray(ids) || ids.length < 2 || new Set(ids).size !== ids.length) throw problem('Select at least two different tables to join.');
      const selected = ids.map(get);
      if (selected.some(item => item.groupId)) throw problem('Separate already joined tables before creating a new group.', 409);
      const groupId = randomUUID();
      await save(tables.map(item => ids.includes(item.table) ? { ...item, groupId } : item));
      return get(ids[0]);
    }),
    separate: id => transaction(async () => {
      const selected = get(id);
      if (!selected.groupId) throw problem('This table is already separate.', 409);
      await save(tables.map(item => item.groupId === selected.groupId ? { ...item, groupId: null } : item));
      return list();
    })
  };
}

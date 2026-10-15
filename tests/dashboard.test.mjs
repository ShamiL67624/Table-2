import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, dateKey, createOrders, filterOrders, summarize, sortOrders, toCSV } from '../data.mjs';

const now = new Date(2026, 9, 15, 20, 0);
const order = (id, day, extra = {}) => ({ id, customer: 'Ananya Rao', date: new Date(2026, 9, day, 12).toISOString(), location: 'Indiranagar', type: 'Dine-in', status: 'Completed', payment: 'UPI', amount: 500, ...extra });
const orders = [order('TT-1', 15), order('TT-2', 9, { amount: 1000 }), order('TT-3', 8), order('TT-4', 15, { status: 'Cancelled', amount: 2000 }), order('TT-5', 15, { location: 'Whitefield', payment: 'Card' })];

test('last seven days includes today and the boundary day, excluding older orders', () => {
  assert.deepEqual(filterOrders(orders, defaults, now).map(item => item.id), ['TT-1', 'TT-2', 'TT-4', 'TT-5']);
});
test('every filter combines with case-insensitive search', () => {
  const filters = { ...defaults, period: 'today', location: 'Indiranagar', type: 'Dine-in', status: 'Completed', payment: 'UPI', search: 'anANYa' };
  assert.deepEqual(filterOrders(orders, filters, now).map(item => item.id), ['TT-1']);
  assert.equal(filterOrders(orders, { ...filters, type: 'Delivery' }, now).length, 0);
  assert.equal(filterOrders(orders, { ...filters, payment: 'Cash' }, now).length, 0);
  assert.equal(filterOrders(orders, { ...filters, search: 'TT-5' }, now).length, 0);
});
test('custom range includes endpoints and rejects incomplete or reversed ranges', () => {
  const filters = { ...defaults, period: 'custom', from: '2026-10-08', to: '2026-10-09' };
  assert.deepEqual(filterOrders(orders, filters, now).map(item => item.id), ['TT-2', 'TT-3']);
  assert.equal(filterOrders(orders, { ...filters, from: '' }, now).length, 0);
  assert.equal(filterOrders(orders, { ...filters, from: '2026-10-10' }, now).length, 0);
});
test('revenue excludes cancellations and empty metrics remain finite', () => {
  assert.deepEqual(summarize([orders[0], orders[1], orders[3]]), { revenue: 1500, total: 3, completed: 2, average: 750, completion: 2 / 3 * 100 });
  assert.deepEqual(summarize([]), { revenue: 0, total: 0, completed: 0, average: 0, completion: 0 });
});
test('sorting leaves original data intact', () => {
  assert.equal(sortOrders(orders, 'highest')[0].id, 'TT-4');
  assert.equal(sortOrders(orders, 'oldest')[0].id, 'TT-3');
  assert.equal(orders[0].id, 'TT-1');
});
test('CSV quotes fields, neutralizes spreadsheet formulas and includes every matching row', () => {
  const csv = toCSV([order('TT-1', 15, { customer: '=SUM(1,2)' }), order('TT-2', 15, { customer: 'A "B", C' })]);
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"A ""B"", C"'));
  assert.equal(csv.split('\r\n').length, 3);
});
test('sample data covers thirty local dates with stable unique IDs', () => {
  const data = createOrders(now);
  assert.equal(new Set(data.map(item => item.id)).size, data.length);
  assert.equal(new Set(data.map(item => dateKey(new Date(item.date)))).size, 30);
  assert.ok(data.every(item => new Date(item.date) <= now));
});

test('today sample orders stay on today even immediately after midnight', () => {
  for (const minutes of [0, 1, 5]) {
    const earlyMorning = new Date(2026, 9, 15, 0, minutes);
    const data = createOrders(earlyMorning);
    const today = filterOrders(data, { ...defaults, period: 'today' }, earlyMorning);
    assert.equal(today.length, 14);
    assert.ok(today.every(item => new Date(item.date) <= earlyMorning));
    assert.equal(new Set(data.map(item => dateKey(new Date(item.date)))).size, 30);
  }
});

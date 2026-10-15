import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import { createOrders, dateKey, defaults, filterOrders, summarize, menuItems } from '../data.mjs';

// Exercise the actual HTML and application module without launching a browser.
// DOM tests do not validate CSS layout or replace visual browser verification.
const window = new Window({
  url: 'http://localhost:3000/#dashboard',
  settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, enableJavaScriptEvaluation: false }
});
const document = window.document;
document.write(await readFile(new URL('../index.html', import.meta.url), 'utf8'));
for (const [key, value] of Object.entries({ window, document, location: window.location, history: window.history, FormData: window.FormData })) {
  globalThis[key] = value;
}
await import('../app.mjs');
const element = id => document.getElementById(id);
const form = element('filters');
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

function input(name, value) {
  form.elements.namedItem(name).value = value;
  form.elements.namedItem(name).dispatchEvent(new window.Event('input', { bubbles: true }));
}

function navigate(page) {
  window.history.replaceState(null, '', `#${page}`);
  window.dispatchEvent(new window.HashChangeEvent('hashchange'));
}

beforeEach(() => {
  element('reset-button').click();
  element('reset-items').click();
  element('sort').value = 'newest';
  element('sort').dispatchEvent(new window.Event('change'));
  navigate('dashboard');
});

after(async () => {
  await window.happyDOM.abort();
  window.close();
});

test('dashboard initializes with four cards, seven order rows and active sidebar state', () => {
  assert.equal(document.querySelectorAll('.stat').length, 4);
  assert.equal(document.querySelectorAll('#orders-body tr').length, 7);
  assert.equal(document.querySelector('[aria-current="page"]').dataset.page, 'dashboard');
  assert.equal(element('charts').hidden, false);
  assert.equal(element('guide').hidden, true);
  assert.equal(element('previous').disabled, true);
  assert.equal(element('next').disabled, false);
  assert.ok(document.querySelectorAll('.bar').length > 0);
});

test('combined controls synchronize the order table, cards and chart totals', () => {
  input('period', 'all');
  input('location', 'Indiranagar');
  input('type', 'Dine-in');
  input('status', 'Completed');
  input('payment', 'UPI');
  input('search', 'aarav');
  const filters = Object.fromEntries(new window.FormData(form));
  const expected = filterOrders(createOrders(), filters);
  const summary = summarize(expected);
  assert.ok(expected.length > 0);
  const cards = [...document.querySelectorAll('.stat-value')].map(item => item.textContent);
  assert.equal(cards[0], money(summary.revenue));
  assert.equal(cards[1], String(summary.total));
  assert.equal(document.querySelector('.donut-center strong').textContent, String(summary.total));
  for (const row of document.querySelectorAll('#orders-body tr')) {
    const cells = row.querySelectorAll('td');
    assert.match(cells[1].textContent, /Aarav Sharma/);
    assert.equal(cells[2].textContent, 'Indiranagar');
    assert.equal(cells[3].textContent, 'Dine-in');
    assert.equal(cells[4].textContent, 'Completed');
    assert.equal(cells[5].textContent, 'UPI');
  }
});

test('empty search shows empty states and disables export and pagination', () => {
  input('search', 'no customer has this name');
  assert.match(element('orders-body').textContent, /No orders match/);
  assert.match(element('revenue-chart').textContent, /No revenue data/);
  assert.equal(element('export-button').disabled, true);
  assert.equal(element('previous').disabled, true);
  assert.equal(element('next').disabled, true);
  assert.equal(document.querySelector('.donut-center strong').textContent, '0');
  element('reset-button').click();
  assert.equal(element('export-button').disabled, false);
  assert.equal(document.querySelectorAll('#orders-body tr').length, 7);
});

test('custom date errors clear after choosing a valid inclusive range', () => {
  input('period', 'custom');
  assert.equal(element('custom-dates').hidden, false);
  assert.equal(element('filter-error').hidden, false);
  input('from', '2026-10-15');
  input('to', '2026-10-14');
  assert.match(element('filter-error').textContent, /on or after/);
  const today = dateKey(new Date());
  input('from', today);
  input('to', today);
  assert.equal(element('filter-error').hidden, true);
  assert.match(element('results-line').textContent, /^14 matching orders/);
  element('reset-button').click();
  assert.equal(element('custom-dates').hidden, true);
  assert.equal(form.elements.namedItem('from').value, '');
});

test('pagination changes rows; sorting and filtering return to the first page', () => {
  const firstRow = element('orders-body').querySelector('td').textContent;
  element('next').click();
  assert.match(element('page-info').textContent, /Page 2 of/);
  assert.notEqual(element('orders-body').querySelector('td').textContent, firstRow);
  element('previous').click();
  assert.equal(element('orders-body').querySelector('td').textContent, firstRow);
  element('next').click();
  element('sort').value = 'highest';
  element('sort').dispatchEvent(new window.Event('change'));
  assert.match(element('page-info').textContent, /Page 1 of/);
  const amounts = [...document.querySelectorAll('td.amount')].map(cell => Number(cell.textContent.replace(/[^0-9]/g, '')));
  assert.deepEqual(amounts, [...amounts].sort((a, b) => b - a));
  element('next').click();
  input('location', 'Whitefield');
  assert.match(element('page-info').textContent, /Page 1 of/);
});

test('sidebar destinations preserve filters and display the correct sections', () => {
  input('location', 'Whitefield');
  navigate('orders');
  assert.equal(element('page-title').textContent, 'Orders');
  assert.equal(element('charts').hidden, true);
  assert.equal(element('orders-panel').hidden, false);
  navigate('reports');
  assert.equal(element('charts').hidden, false);
  assert.equal(element('orders-panel').hidden, true);
  navigate('guide');
  assert.equal(element('guide').hidden, false);
  assert.equal(element('filter-panel').hidden, true);
  assert.equal(element('export-button').hidden, true);
  navigate('dashboard');
  assert.equal(form.elements.namedItem('location').value, 'Whitefield');
  assert.equal(element('filter-panel').hidden, false);
  assert.equal(element('orders-panel').hidden, false);
  navigate('unknown');
  assert.equal(window.location.hash, '#dashboard');
});

test('CSV button exports all matching rows, including rows beyond the current page', async () => {
  input('period', 'all');
  input('location', 'Whitefield');
  const expected = filterOrders(createOrders(), { ...defaults, period: 'all', location: 'Whitefield' });
  const originalCreate = URL.createObjectURL;
  const originalClick = window.HTMLAnchorElement.prototype.click;
  let blob, download;
  URL.createObjectURL = value => { blob = value; return 'blob:dashboard-test'; };
  window.HTMLAnchorElement.prototype.click = function () { download = this.download; };
  try {
    element('export-button').click();
    assert.match(download, /^table-and-thyme-orders-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await blob.text();
    assert.equal(csv.split('\r\n').length, expected.length + 1);
    assert.ok(expected.length > 7);
    assert.ok(csv.split('\r\n').slice(1).every(row => row.includes('"Whitefield"')));
  } finally {
    URL.createObjectURL = originalCreate;
    window.HTMLAnchorElement.prototype.click = originalClick;
  }
});

test('Item Board appears below orders and has its own sidebar destination', () => {
  assert.equal(element('orders-panel').nextElementSibling.id, 'items-panel');
  assert.equal(document.querySelector('[data-page="orders"]').nextElementSibling.dataset.page, 'items');
  assert.equal(element('items-panel').hidden, false);
  assert.equal(document.querySelectorAll('#items-body tr').length, menuItems.length);
  assert.match(element('items-body').textContent, /Paneer Tikka/);
  navigate('orders');
  assert.equal(element('items-panel').hidden, false);
  navigate('items');
  assert.equal(element('page-title').textContent, 'Item Board');
  assert.equal(document.querySelector('[aria-current="page"]').dataset.page, 'items');
  assert.equal(element('orders-panel').hidden, true);
  assert.equal(element('filter-panel').hidden, true);
  assert.equal(element('export-button').hidden, true);
  assert.equal(element('items-panel').hidden, false);
  navigate('reports');
  assert.equal(element('items-panel').hidden, true);
  navigate('guide');
  assert.equal(element('items-panel').hidden, true);
});

test('item search, category, availability and reset work independently of order filters', () => {
  input('location', 'Whitefield');
  const orderRows = element('orders-body').innerHTML;
  const itemInput = (name, value) => {
    const control = element('item-filters').elements.namedItem(name);
    control.value = value;
    control.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  itemInput('category', 'Main course');
  itemInput('availability', 'unavailable');
  itemInput('search', 'CHICKEN');
  assert.equal(document.querySelectorAll('#items-body tr').length, 1);
  assert.match(element('items-body').textContent, /Chicken Biryani/);
  assert.match(element('items-body').textContent, /Unavailable/);
  assert.equal(document.querySelector('#items-body .item-price').textContent, money(360));
  assert.equal(element('item-count').textContent, 'Showing 1 of 12 menu items');
  navigate('items');
  assert.equal(element('item-count').textContent, 'Showing 1 of 12 menu items');
  itemInput('search', 'no matching item');
  assert.match(element('items-body').textContent, /No items match/);
  element('reset-items').click();
  assert.equal(document.querySelectorAll('#items-body tr').length, menuItems.length);
  itemInput('search', 'item-001');
  assert.match(element('items-body').textContent, /Paneer Tikka/);
  assert.equal(document.querySelectorAll('#items-body tr').length, 1);
  assert.equal(form.elements.namedItem('location').value, 'Whitefield');
  assert.equal(element('orders-body').innerHTML, orderRows);
});

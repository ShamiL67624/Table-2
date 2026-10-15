import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Window } from 'happy-dom';
import { createRestaurantServer, isLocal, menuBaseUrl } from '../server.mjs';
import { createOrderStore } from '../order-store.mjs';
import { createTableStore } from '../table-store.mjs';
import { initMenu } from '../menu.mjs';
import { initAdminOrders } from '../admin-orders.mjs';

test('four-table QR ordering workflow', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'table-thyme-test-'));
  const file = path.join(folder, 'orders.json');
  const server = await createRestaurantServer({ storeFile: file, baseUrl: 'http://192.168.1.42:3000' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options) => fetch(`${origin}${url}`, options);
  const post = (url, data) => request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const payload = () => ({ table: 'T1', requestId: randomUUID(), items: [{ id: 'ITEM-001', quantity: 2 }], note: 'Less spicy' });
  const controllers = [], windows = [];
  const makeWindow = async (file, url) => {
    const window = new Window({ url: `${origin}${url}`, settings: { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, enableJavaScriptEvaluation: false } });
    window.HTMLImageElement.prototype.decode = async () => {};
    // The test transport is Node fetch, which requires Node's AbortSignal.
    window.AbortController = globalThis.AbortController;
    window.document.write(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
    windows.push(window); return window;
  };
  const until = async condition => {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('Expected UI update did not arrive.');
  };
  try {
    await t.test('four unique SVG QR codes use a shared menu and their own table IDs', async () => {
      const config = await (await request('/api/admin/tables')).json();
      assert.deepEqual(config.tables.map(item => item.table), ['T1', 'T2', 'T3', 'T4']);
      const codes = [];
      for (const item of config.tables) {
        assert.equal(item.url, `http://192.168.1.42:3000/menu?table=${item.table}`);
        const response = await request(item.qrUrl);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
        const svg = await response.text(); assert.match(svg, /<svg/); codes.push(svg);
        const menu = await request(`/menu?table=${item.table}`);
        assert.equal(menu.status, 200);
        assert.match(await menu.text(), /Your table’s order/);
      }
      assert.equal(new Set(codes).size, 4);
      const menu = await (await request('/api/menu')).json();
      assert.equal(menu.items.length, 12);
      assert.deepEqual(menu.tables, ['T1', 'T2', 'T3', 'T4']);
    });

    await t.test('order totals use server prices and concurrent retries create one saved order', async () => {
      const data = payload(); data.total = 1; data.items[0].price = 1;
      const responses = await Promise.all([post('/api/orders', data), post('/api/orders', data)]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
      const results = await Promise.all(responses.map(response => response.json()));
      assert.equal(results[0].order.id, results[1].order.id);
      assert.equal(results[0].order.total, 560);
      assert.equal(results[0].order.table, 'T1');
      assert.equal(results[0].order.status, 'Ordered');
      const denied = await request(`/api/orders/${results[0].order.id}`);
      assert.equal(denied.status, 404);
      const receipt = await request(`/api/orders/${results[0].order.id}`, { headers: { 'X-Order-Token': results[0].token } });
      assert.equal(receipt.status, 200);
      const changed = await post('/api/orders', { ...data, table: 'T2' });
      assert.equal(changed.status, 409);
      const saved = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(saved.length, 1);
    });

    await t.test('invalid tables, quantities, unavailable items and empty carts are rejected', async () => {
      const invalid = [
        { ...payload(), table: 'T5' }, { ...payload(), items: [] },
        { ...payload(), items: [{ id: 'ITEM-001', quantity: 0 }] },
        { ...payload(), items: [{ id: 'ITEM-001', quantity: 21 }] },
        { ...payload(), items: [{ id: 'ITEM-001', quantity: 1.5 }] },
        { ...payload(), items: [{ id: 'ITEM-007', quantity: 1 }] },
        { ...payload(), items: [{ id: 'missing', quantity: 1 }] },
        { ...payload(), note: 'x'.repeat(301) }
      ];
      for (const data of invalid) assert.equal((await post('/api/orders', data)).status, 400);
      assert.equal((await request('/data/orders.json')).status, 404);
      const crossSite = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://unrelated.example' }, body: JSON.stringify(payload()) });
      assert.equal(crossSite.status, 403);
      assert.equal(isLocal('192.168.1.42'), false);
      assert.equal(isLocal('127.0.0.1'), true);
      assert.throws(() => menuBaseUrl(3000, 'javascript:alert(1)'));
    });

    await t.test('customer cart sends T2 to admin, staff confirms, and customer sees confirmation', async () => {
      const adminWindow = await makeWindow('index.html', '/#tables');
      const admin = initAdminOrders({ document: adminWindow.document, window: adminWindow, fetch: request });
      controllers.push(admin); await admin.ready;
      assert.equal(adminWindow.document.querySelectorAll('.qr-card').length, 4, adminWindow.document.getElementById('qr-network').textContent);
      const window = await makeWindow('menu.html', '/menu?table=T2');
      const document = window.document;
      const menu = await initMenu({ document, window, fetch: request }); controllers.push(menu);
      assert.equal(document.getElementById('table-tag').textContent, 'TABLE T2');
      assert.equal(document.querySelectorAll('.menu-card').length, 12);
      assert.equal(document.querySelector('[data-item="ITEM-007"]'), null);
      document.querySelector('[data-category="Starters"]').click();
      assert.equal(document.querySelectorAll('.menu-card').length, 3);
      document.querySelector('[data-item="ITEM-001"][data-delta="1"]').click();
      document.querySelector('[data-item="ITEM-001"][data-delta="1"]').click();
      assert.match(document.getElementById('cart-total').textContent, /560/);
      document.getElementById('kitchen-note').value = 'No onions <please>';
      await menu.placeOrder();
      assert.match(document.getElementById('receipt').textContent, /Order placed/);
      await admin.refreshOrders();
      assert.match(adminWindow.document.getElementById('order-notification').textContent, /New order.*T2/);
      const ticket = [...adminWindow.document.querySelectorAll('.live-ticket')].find(ticket => ticket.querySelector('.ticket-table').textContent === 'T2');
      assert.ok(ticket);
      assert.match(ticket.textContent, /No onions <please>/);
      assert.equal(ticket.querySelector('please'), null);
      ticket.querySelector('[data-confirm]').click();
      await until(() => adminWindow.document.getElementById('order-notification').textContent.includes('Order confirmed'));
      await menu.refreshReceipt();
      assert.match(document.getElementById('receipt').textContent, /Order confirmed/);
      const store = await createOrderStore(file);
      assert.equal(store.list().find(order => order.table === 'T2').status, 'Confirmed');
      assert.ok(store.list().every(order => !order.token && !order.requestId));
      document.getElementById('new-order').click();
      assert.equal(document.getElementById('menu-content').hidden, false);
      menu.stop(); admin.stop();
    });

    await t.test('lost response can be retried without creating a second table order', async () => {
      const window = await makeWindow('menu.html', '/menu?table=T3');
      let loseResponse = true;
      const unreliable = async (url, options) => {
        const response = await request(url, options);
        if (url === '/api/orders' && loseResponse) { loseResponse = false; throw new Error('Lost response'); }
        return response;
      };
      const menu = await initMenu({ document: window.document, window, fetch: unreliable }); controllers.push(menu);
      window.document.querySelector('[data-item="ITEM-001"]').click();
      await menu.placeOrder();
      assert.match(window.document.getElementById('place-order').textContent, /Retry/);
      assert.equal(window.document.querySelector('[data-item="ITEM-001"]').disabled, true);
      await menu.placeOrder();
      assert.match(window.document.getElementById('receipt').textContent, /Order placed/);
      const orders = (await (await request('/api/admin/orders')).json()).orders;
      assert.equal(orders.filter(order => order.table === 'T3').length, 1);
      menu.stop();
    });

    await t.test('invalid table links cannot order and carts stay separate between tables', async () => {
      const invalid = await makeWindow('menu.html', '/menu?table=T8');
      const invalidMenu = await initMenu({ document: invalid.document, window: invalid, fetch: request }); controllers.push(invalidMenu);
      assert.equal(invalid.document.getElementById('menu-content').hidden, true);
      assert.match(invalid.document.getElementById('menu-error').textContent, /scan the QR code/);
      const window = await makeWindow('menu.html', '/menu?table=T4');
      window.localStorage.setItem('table-and-thyme:T1:cart', JSON.stringify({ 'ITEM-001': 3 }));
      const menu = await initMenu({ document: window.document, window, fetch: request }); controllers.push(menu);
      assert.equal(window.document.getElementById('place-order').disabled, true);
      assert.match(window.document.getElementById('cart-total').textContent, /0/);
      menu.stop();
    });

    await t.test('admin can add a table, edit seats, join tables and separate them', async () => {
      const window = await makeWindow('index.html', '/#tables');
      const document = window.document;
      const admin = initAdminOrders({ document, window, fetch: request }); controllers.push(admin); await admin.ready;
      const add = document.getElementById('add-table-form');
      add.elements.namedItem('table').value = 'T5';
      add.elements.namedItem('capacity').value = '6';
      add.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await until(() => document.querySelectorAll('.qr-card').length === 5 && !document.getElementById('print-qrs').disabled);
      assert.match(document.getElementById('seating-summary').textContent, /5 tables · 22 total seats/);
      for (const id of ['T1', 'T5']) {
        const checkbox = document.querySelector(`[data-select-table="${id}"]`);
        checkbox.checked = true; checkbox.dispatchEvent(new window.Event('change', { bubbles: true }));
      }
      assert.match(document.getElementById('join-summary').textContent, /10 seats selected/);
      document.getElementById('join-tables').click();
      await until(() => document.querySelectorAll('.seating-card.joined').length === 2 && !document.getElementById('print-qrs').disabled);
      assert.match(document.querySelector('.seating-card.joined').textContent, /T1 \+ T5 · 10 seats together/);
      const edit = document.querySelector('[data-seat-table="T1"]');
      edit.elements.namedItem('capacity').value = '2';
      edit.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      await until(() => document.querySelector('.seating-card.joined')?.textContent.includes('8 seats together') && !document.getElementById('print-qrs').disabled);
      const persisted = await createTableStore(path.join(folder, 'tables.json'));
      assert.equal(persisted.get('T5').combinedCapacity, 8);
      assert.equal(persisted.get('T1').capacity, 2);
      assert.equal(persisted.get('T5').label, 'T1 + T5');
      const customer = await makeWindow('menu.html', '/menu?table=T5');
      const menu = await initMenu({ document: customer.document, window: customer, fetch: request }); controllers.push(menu);
      assert.equal(customer.document.getElementById('table-tag').textContent, 'TABLE T1 + T5');
      assert.match(customer.document.getElementById('cart-table').textContent, /8 seats/);
      customer.document.querySelector('[data-item="ITEM-001"]').click();
      await menu.placeOrder();
      assert.match(customer.document.getElementById('receipt').textContent, /T1 \+ T5 · 8 seats/);
      await admin.refreshOrders();
      assert.match(document.getElementById('live-orders').textContent, /Joined: T1 \+ T5 · 8 seats · Scanned at T5/);
      assert.equal((await request('/api/admin/qr/T5.svg')).status, 200);
      const overlap = await post('/api/admin/tables/join', { tables: ['T1', 'T2'] });
      assert.equal(overlap.status, 409);
      document.querySelector('[data-separate="T5"]').click();
      await until(() => document.querySelectorAll('.seating-card.joined').length === 0 && !document.getElementById('print-qrs').disabled);
      const state = await (await request('/api/menu')).json();
      assert.equal(state.seating.find(item => item.table === 'T5').combinedCapacity, 6);
      assert.equal(state.seating.find(item => item.table === 'T1').capacity, 2);
      await menu.refreshReceipt();
      assert.match(customer.document.getElementById('receipt').textContent, /T1 \+ T5 · 8 seats/);
      const newOrder = await (await post('/api/orders', { ...payload(), table: 'T5' })).json();
      assert.equal(newOrder.order.tableLabel, 'T5');
      assert.equal(newOrder.order.seatCapacity, 6);
      const tables = await (await request('/api/admin/tables')).json();
      assert.equal(tables.tables.find(item => item.table === 'T1').url, 'http://192.168.1.42:3000/menu?table=T1');
      menu.stop(); admin.stop();
    });

    await t.test('seating validation rejects duplicate tables, invalid seats and invalid joins', async () => {
      assert.equal((await post('/api/admin/tables', { table: 'T5', capacity: 4 })).status, 409);
      assert.equal((await post('/api/admin/tables', { table: 'T0', capacity: 4 })).status, 400);
      for (const capacity of [0, 31, 2.5, '4', null]) {
        assert.equal((await post('/api/admin/tables/T1/capacity', { capacity })).status, 400);
      }
      for (const tables of [[], ['T1'], ['T1', 'T1']]) {
        assert.equal((await post('/api/admin/tables/join', { tables })).status, 400);
      }
      assert.equal((await post('/api/admin/tables/join', { tables: ['T1', 'T99'] })).status, 404);
      assert.equal((await request('/api/admin/qr/T99.svg')).status, 404);
      const added = await (await post('/api/admin/tables', { capacity: 3 })).json();
      assert.equal(added.table.table, 'T6');
      assert.equal(added.table.capacity, 3);
    });

    await t.test('an old API produces a restart message, and refresh recovers tables and orders', async () => {
      const window = await makeWindow('index.html', '/#tables');
      let outdated = true;
      const transport = (url, options) => outdated ? Promise.resolve(new Response('Not found', { status: 404 })) : request(url, options);
      const admin = initAdminOrders({ document: window.document, window, fetch: transport }); controllers.push(admin); await admin.ready;
      assert.match(window.document.getElementById('live-status').textContent, /server is out of date/);
      assert.match(window.document.getElementById('table-message').textContent, /Ctrl\+C/);
      assert.equal(window.document.getElementById('print-qrs').disabled, true);
      outdated = false;
      await admin.loadTables(); await admin.refreshOrders();
      assert.equal(window.document.querySelectorAll('.qr-card').length, 6);
      assert.match(window.document.getElementById('live-status').textContent, /awaiting confirmation/);
      assert.equal(window.document.getElementById('print-qrs').disabled, false);
      admin.stop();
    });
  } finally {
    controllers.forEach(controller => controller.stop());
    for (const window of windows) { await window.happyDOM.abort(); window.close(); }
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    // Only remove this test's freshly created temporary directory.
    if (path.dirname(folder) === path.resolve(tmpdir()) && path.basename(folder).startsWith('table-thyme-test-')) await rm(folder, { recursive: true, force: true });
  }
});

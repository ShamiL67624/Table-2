const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = { Starters: '✦', 'Main course': '♨', Sides: '◒', Desserts: '♡', Beverages: '◡' };

export async function initMenu({ document, window, fetch: request = window.fetch.bind(window) }) {
  const byId = id => document.getElementById(id);
  const table = new URL(window.location.href).searchParams.get('table');
  let items = [], category = 'All', cart = {}, sending = false, receipt = null, pending = null, timer, stopped = false;
  const storageKey = `table-and-thyme:${table}`;
  const read = key => { try { return JSON.parse(window.localStorage.getItem(`${storageKey}:${key}`)); } catch { return null; } };
  const write = (key, value) => { try { window.localStorage.setItem(`${storageKey}:${key}`, JSON.stringify(value)); } catch { /* Ordering still works when storage is disabled. */ } };
  const newId = () => [...window.crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('');
  const showError = message => { byId('menu-error').textContent = message; byId('menu-error').hidden = !message; };
  const lines = () => items.filter(item => cart[item.id]).map(item => ({ ...item, quantity: cart[item.id] }));
  const total = () => lines().reduce((sum, item) => sum + item.price * item.quantity, 0);
  const locked = () => sending || Boolean(pending);
  const stepper = item => `<div class="stepper"><button type="button" data-item="${item.id}" data-delta="-1" aria-label="Remove one ${escape(item.name)}" ${locked() ? 'disabled' : ''}>−</button><span>${cart[item.id] || 0}</span><button type="button" data-item="${item.id}" data-delta="1" aria-label="Add one ${escape(item.name)}" ${locked() || cart[item.id] >= 20 ? 'disabled' : ''}>+</button></div>`;

  function render() {
    const query = byId('menu-search').value.trim().toLowerCase();
    const visible = items.filter(item => (category === 'All' || item.category === category) && `${item.name} ${item.description}`.toLowerCase().includes(query));
    byId('menu-count').textContent = `${visible.length} dishes & drinks`;
    byId('categories').innerHTML = ['All', ...new Set(items.map(item => item.category))].map(name => `<button class="category-tab" data-category="${escape(name)}" aria-pressed="${category === name}">${escape(name)}</button>`).join('');
    byId('menu-grid').innerHTML = visible.map(item => `<article class="menu-card ${item.available ? '' : 'unavailable'}"><div class="menu-card-top"><span class="food-icon" aria-hidden="true">${icons[item.category] || '✦'}</span><span class="menu-category">${escape(item.category)}</span></div><h3>${escape(item.name)}</h3><p>${escape(item.description)}</p><div class="menu-card-bottom"><strong class="item-cost">${money(item.price)}</strong>${!item.available ? '<span class="sold-out">Sold out today</span>' : cart[item.id] ? stepper(item) : `<button class="add-item" data-item="${item.id}" data-delta="1" ${locked() ? 'disabled' : ''} aria-label="Add ${escape(item.name)}">Add +</button>`}</div></article>`).join('') || '<p class="no-items">No dishes found. Try another category or search.</p>';
    byId('cart-lines').innerHTML = lines().length ? lines().map(item => `<div class="cart-row"><div><strong>${escape(item.name)}</strong><small>${money(item.price * item.quantity)}</small></div>${stepper(item)}</div>`).join('') : '<p class="cart-empty">A little hungry?<br>Add something lovely from the menu.</p>';
    byId('cart-total').textContent = money(total());
    byId('place-order').disabled = sending || !lines().length;
    byId('place-order').innerHTML = sending ? 'Sending your order…' : pending ? 'Retry this order <span>↗</span>' : 'Place order <span>↗</span>';
    byId('kitchen-note').disabled = locked();
    byId('mobile-cart').hidden = !lines().length || Boolean(receipt);
    byId('mobile-cart-count').textContent = `${lines().reduce((sum, item) => sum + item.quantity, 0)} items · ${money(total())}`;
  }

  function showReceipt(order) {
    byId('menu-content').hidden = true;
    byId('mobile-cart').hidden = true;
    byId('receipt').hidden = false;
    const confirmed = order.status === 'Confirmed';
    byId('receipt').innerHTML = `<span class="receipt-icon" aria-hidden="true">${confirmed ? '✓' : '↗'}</span><span class="overline">${escape(table)} · ${escape(order.id)}</span><h2>${confirmed ? 'Order confirmed.' : 'Order placed.'}</h2><p>${confirmed ? 'The team has confirmed your order. Sit back — something good is on its way.' : 'Your order is with the restaurant. We’ll update this page when the team confirms it.'}</p><ul>${order.items.map(item => `<li><span>${item.quantity} × ${escape(item.name)}</span><strong>${money(item.price * item.quantity)}</strong></li>`).join('')}</ul>${order.note ? `<p class="receipt-note">Kitchen note: ${escape(order.note)}</p>` : ''}<p class="receipt-total">Total ${money(order.total)} · Pay at the restaurant</p><div class="receipt-actions"><button id="new-order">Order something else</button><span class="overline">${confirmed ? 'CONFIRMED BY THE TEAM' : 'AWAITING CONFIRMATION'}</span></div><p id="receipt-feedback" role="status"></p>`;
    byId('receipt').querySelector('.overline').textContent = `${order.tableLabel || table}${order.seatCapacity ? ` · ${order.seatCapacity} seats` : ''} · ${order.id}`;
    byId('new-order').addEventListener('click', () => {
      window.clearTimeout(timer); receipt = null; write('receipt', null);
      byId('receipt').hidden = true; byId('menu-content').hidden = false; showError(''); render();
    });
    if (confirmed) window.clearTimeout(timer);
  }

  async function refreshReceipt() {
    window.clearTimeout(timer);
    if (!receipt || stopped) return;
    try {
      const response = await request(`/api/orders/${encodeURIComponent(receipt.id)}`, { headers: { 'X-Order-Token': receipt.token } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to check order status.');
      if (!receipt || stopped || receipt.id !== result.order.id) return;
      showReceipt(result.order);
      if (result.order.status === 'Confirmed') return;
    } catch {
      const target = byId('receipt-feedback');
      if (target) target.textContent = 'Reconnecting to the restaurant. Your saved order has not been sent again.';
    }
    if (receipt && !stopped) timer = window.setTimeout(refreshReceipt, 3000);
  }

  async function placeOrder() {
    if (sending || !lines().length) return;
    sending = true; byId('order-feedback').textContent = '';
    pending ||= { table, items: lines().map(({ id, quantity }) => ({ id, quantity })), note: byId('kitchen-note').value.trim(), requestId: newId() };
    write('pending', pending); render();
    try {
      const response = await request('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) { pending = null; write('pending', null); }
        throw new Error(result.error || 'Unable to send your order. Please retry.');
      }
      receipt = { id: result.order.id, token: result.token, order: result.order };
      write('receipt', receipt); pending = null; write('pending', null); cart = {}; write('cart', {}); write('note', '');
      byId('kitchen-note').value = ''; showReceipt(result.order);
      timer = window.setTimeout(refreshReceipt, 3000);
    } catch (error) {
      byId('order-feedback').textContent = pending ? 'We couldn’t verify delivery. Retry this same order to check it safely; you won’t be charged or sent a duplicate.' : error.message;
    } finally { sending = false; render(); }
  }

  if (!/^T[1-9]\d{0,3}$/.test(table || '')) {
    byId('menu-content').hidden = true;
    showError('Please scan the QR code on your table to open its menu.');
    return { stop() {} };
  }
  byId('table-tag').textContent = `TABLE ${table}`;
  byId('cart-table').textContent = `${table} · Dine-in · Made with care`;
  document.title = `${table} menu · Table & Thyme`;
  try {
    const response = await request('/api/menu');
    if (!response.ok) throw new Error('The menu is temporarily unavailable. Refresh to try again.');
    const data = await response.json();
    if (!data.tables.includes(table)) throw new Error('Table not found. Please scan the QR code on your table.');
    items = data.items;
    const seating = data.seating?.find(item => item.table === table);
    if (seating) {
      byId('table-tag').textContent = `TABLE ${seating.label}`;
      byId('cart-table').textContent = `${seating.label} · ${seating.combinedCapacity} seats${seating.groupId ? ` · Joined tables · Scanned at ${table}` : ' · Dine-in'}`;
    }
  } catch (error) {
    byId('menu-content').hidden = true;
    showError(error.message || 'Unable to load the menu. Refresh to try again.');
    return { stop() {} };
  }
  const saved = read('cart') || {};
  cart = Object.fromEntries(items.filter(item => item.available && Number.isInteger(saved[item.id]) && saved[item.id] > 0 && saved[item.id] <= 20).map(item => [item.id, saved[item.id]]));
  byId('kitchen-note').value = String(read('note') || '').slice(0, 300);
  const savedPending = read('pending');
  if (savedPending?.table === table && Array.isArray(savedPending.items) && typeof savedPending.requestId === 'string') {
    pending = savedPending; cart = Object.fromEntries(pending.items.map(item => [item.id, item.quantity]));
    byId('kitchen-note').value = pending.note || '';
    byId('order-feedback').textContent = 'An order is awaiting delivery verification. Retry it to recover the result without creating a duplicate.';
  }
  const savedReceipt = read('receipt');
  if (savedReceipt?.order?.table === table && savedReceipt.id && savedReceipt.token) {
    receipt = savedReceipt; showReceipt(receipt.order); timer = window.setTimeout(refreshReceipt, 0);
  }
  byId('menu-search').addEventListener('input', render);
  byId('categories').addEventListener('click', event => {
    const button = event.target.closest('[data-category]');
    if (button) { category = button.dataset.category; render(); }
  });
  byId('menu-content').addEventListener('click', event => {
    const button = event.target.closest('[data-item]');
    if (!button || locked()) return;
    const item = items.find(item => item.id === button.dataset.item);
    if (!item?.available) return;
    const value = Math.max(0, Math.min(20, (cart[item.id] || 0) + Number(button.dataset.delta)));
    if (value) cart[item.id] = value; else delete cart[item.id];
    write('cart', cart); render();
  });
  byId('kitchen-note').addEventListener('input', () => write('note', byId('kitchen-note').value));
  byId('place-order').addEventListener('click', placeOrder);
  render();
  const stop = () => { stopped = true; window.clearTimeout(timer); };
  window.addEventListener('pagehide', stop);
  return { stop, refreshReceipt, placeOrder };
}


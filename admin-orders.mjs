const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function initAdminOrders({ document, window, fetch: request = window.fetch.bind(window) }) {
  const byId = id => document.getElementById(id);
  let timer, refreshing = false, stopped = false, seen = new Set(), loaded = false, previousJSON = '', confirming = false;
  let tableData = [], changingTables = false, loadingTables = false;
  const selected = new Set();
  const notify = message => { byId('order-notification').hidden = false; byId('order-notification').textContent = message; };

  async function withTimeout(action) {
    const controller = new window.AbortController();
    let timeout;
    try {
      return await Promise.race([action(controller.signal), new Promise((_, reject) => {
        timeout = window.setTimeout(() => { controller.abort(); reject(new Error('The restaurant server took too long to respond. Check it is running, then retry.')); }, 8000);
      })]);
    } finally { window.clearTimeout(timeout); }
  }

  async function api(url, options = {}) {
    return withTimeout(async signal => {
      const response = await request(url, { ...options, signal });
      if (response.status === 404 && !response.headers.get('content-type')?.includes('application/json')) throw new Error('The running server is out of date. Stop it with Ctrl+C, run npm run dev again, then refresh.');
      let data;
      try { data = await response.json(); } catch { throw new Error('This page needs the restaurant server. Run npm run dev and open the printed admin URL.'); }
      if (!response.ok) throw new Error(data.error || 'Unable to complete the request.');
      return data;
    });
  }

  function updateSelection() {
    const selection = tableData.filter(item => selected.has(item.table));
    byId('join-summary').textContent = selection.length ? `${selection.map(item => item.table).join(' + ')} · ${selection.reduce((sum, item) => sum + item.capacity, 0)} seats selected` : 'Select two or more tables to join';
    byId('join-tables').disabled = selection.length < 2 || changingTables;
  }

  function renderSeating() {
    const groups = new Set(tableData.filter(item => item.groupId).map(item => item.groupId));
    byId('seating-summary').textContent = `${tableData.length} tables · ${tableData.reduce((sum, item) => sum + item.capacity, 0)} total seats · ${groups.size} joined groups`;
    for (const id of selected) if (!tableData.some(item => item.table === id && !item.groupId)) selected.delete(id);
    byId('seating-grid').innerHTML = tableData.map(item => `<article class="seating-card ${item.groupId ? 'joined' : ''}"><div class="seating-card-top"><strong>${escape(item.table)}</strong><label class="join-select"><input type="checkbox" data-select-table="${escape(item.table)}" ${selected.has(item.table) ? 'checked' : ''} ${item.groupId ? 'disabled' : ''} aria-label="Select ${escape(item.table)} to join"> ${item.groupId ? 'Joined' : 'Select to join'}</label></div><div class="seat-count"><strong>${item.capacity}</strong><span>seats</span></div><p class="seating-group">${item.groupId ? `${escape(item.label)} · ${item.combinedCapacity} seats together` : 'Separate table · Ready for a party'}</p><form class="seat-form" data-seat-table="${escape(item.table)}"><label>Seat capacity<input type="number" name="capacity" min="1" max="30" value="${item.capacity}" required aria-label="${escape(item.table)} seat capacity"></label><button class="button small" type="submit">Save seats</button></form>${item.groupId ? `<button class="text-button separate-tables" data-separate="${escape(item.table)}">Separate ${escape(item.label)}</button>` : ''}</article>`).join('');
    updateSelection();
  }

  async function loadTables() {
    if (loadingTables || stopped) return false;
    loadingTables = true;
    byId('print-qrs').disabled = true;
    try {
      const data = await api('/api/admin/tables');
      if (!Array.isArray(data.tables) || data.tables.some(table => !Number.isInteger(table.capacity))) throw new Error('Restart npm run dev to load the updated table management API.');
      tableData = data.tables;
      renderSeating();
      byId('qr-cards').innerHTML = data.tables.map(({ table, capacity, url, qrUrl }, index) => `<article class="qr-card"><div class="qr-card-top"><span>table & thyme</span><span>${String(index + 1).padStart(2, '0')} / ${String(data.tables.length).padStart(2, '0')}</span></div><div class="qr-table-label"><span>YOUR TABLE · ${capacity} SEATS</span><h3>${escape(table)}</h3></div><p class="qr-invitation">Good food.<br><em>Just a scan away.</em></p><div class="qr-image"><img src="${escape(qrUrl)}" alt="Scan to open the menu for table ${escape(table)}" width="240" height="240"></div><p class="qr-caption">SCAN TO BROWSE & ORDER</p><p class="qr-card-note">Choose your favourites.<br>We’ll bring them to your table.</p><div class="qr-actions"><a class="button small" href="/menu?table=${encodeURIComponent(table)}" target="_blank" rel="noopener">Open menu ↗</a><a class="button small" href="${escape(qrUrl)}" download="${escape(table)}-menu-qr.svg">Download QR ↓</a></div><small class="qr-url">${escape(url)}</small></article>`).join('');
      byId('print-qrs').textContent = `Print all ${data.tables.length} QR cards`;
      byId('qr-network').textContent = `Customer menu: ${data.baseUrl} · Phones must use the same Wi-Fi as this computer. Keep the server running. Open a link on a phone before printing.`;
      const images = [...byId('qr-cards').querySelectorAll('img')];
      await withTimeout(() => Promise.all(images.map(img => img.decode ? img.decode() : Promise.resolve())));
      byId('print-qrs').disabled = false;
      return true;
    } catch (error) {
      byId('qr-network').textContent = `${error.message || 'QR codes could not load.'} Refresh the page to retry.`;
      byId('table-message').textContent = error.message || 'Tables could not load. Use Refresh tables to retry.';
      byId('print-qrs').disabled = true;
      return false;
    } finally { loadingTables = false; }
  }

  async function changeTables(url, payload, message) {
    if (changingTables || loadingTables) return;
    changingTables = true;
    byId('table-message').textContent = 'Saving table changes…';
    const controls = [...byId('qr-panel').querySelectorAll('input, button')];
    const previousDisabled = controls.map(control => control.disabled);
    let refreshed = false;
    controls.forEach(control => control.disabled = true);
    try {
      const result = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      selected.clear();
      byId('table-message').textContent = typeof message === 'function' ? message(result) : message;
      if (url === '/api/admin/tables') byId('add-table-form').reset();
      refreshed = true; await loadTables();
    } catch (error) { byId('table-message').textContent = error.message || 'Changes were not saved. Please retry.'; }
    finally {
      changingTables = false;
      controls.forEach((control, index) => { if (control.isConnected && control.id !== 'join-tables' && (control.id !== 'print-qrs' || !refreshed)) control.disabled = previousDisabled[index]; });
      updateSelection();
    }
  }

  function renderOrders(orders) {
    const pending = orders.filter(order => order.status === 'Ordered');
    byId('pending-count').hidden = !pending.length;
    byId('pending-count').textContent = pending.length;
    const newOrders = orders.filter(order => !seen.has(order.id));
    if (loaded && newOrders.length) notify(`New order${newOrders.length > 1 ? 's' : ''} · ${newOrders.map(order => `${order.tableLabel || order.table} — ${order.id}`).join(', ')} · Ordered. Ready for confirmation.`);
    else if (!loaded && pending.length) notify(`${pending.length} table order${pending.length === 1 ? '' : 's'} waiting for confirmation.`);
    seen = new Set(orders.map(order => order.id)); loaded = true;
    const snapshot = JSON.stringify(orders);
    if (snapshot !== previousJSON) {
      previousJSON = snapshot;
      byId('live-orders').innerHTML = orders.length ? orders.map(order => `<article class="live-ticket"><div class="ticket-top"><span class="ticket-table">${escape(order.table)}</span><div><strong>${escape(order.id)}</strong><small>${new Date(order.date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></div><span class="status ${order.status === 'Ordered' ? 'preparing' : ''}">${escape(order.status)}</span></div>${order.tableGroup?.length > 1 ? `<p class="ticket-group">Joined: ${escape(order.tableLabel)} · ${order.seatCapacity} seats · Scanned at ${escape(order.table)}</p>` : ''}<ul>${order.items.map(item => `<li><span>${item.quantity} × ${escape(item.name)}</span><strong>${money(item.quantity * item.price)}</strong></li>`).join('')}</ul>${order.note ? `<p class="ticket-note">Kitchen note: ${escape(order.note)}</p>` : ''}<div class="ticket-bottom"><div><small>PAY AT RESTAURANT</small><strong>${money(order.total)}</strong></div>${order.status === 'Ordered' ? `<button class="button primary" data-confirm="${escape(order.id)}">Confirm order ✓</button>` : '<span class="confirmed-label">Confirmed ✓</span>'}</div></article>`).join('') : '<div class="live-empty"><span aria-hidden="true">♧</span><strong>Your tables are ready.</strong><p>Customer table orders will appear here.</p><a href="#tables">View your table QR codes →</a></div>';
    }
    byId('live-status').textContent = `${pending.length} awaiting confirmation · ${orders.length} total table orders · Updates every 3 seconds while this page is open`;
  }

  async function refreshOrders() {
    if (refreshing || confirming || stopped) return;
    refreshing = true;
    try {
      const data = await api('/api/admin/orders');
      if (!stopped) renderOrders(data.orders);
    } catch (error) {
      byId('live-status').textContent = `${error.message || 'Connection lost — retrying.'} Existing tickets may be out of date.`;
    } finally { refreshing = false; }
  }

  async function tick() {
    await refreshOrders();
    if (!stopped) timer = window.setTimeout(tick, 3000);
  }

  byId('live-orders').addEventListener('click', async event => {
    const button = event.target.closest('[data-confirm]');
    if (!button || confirming) return;
    confirming = true; button.disabled = true; button.textContent = 'Confirming…';
    try {
      const data = await api(`/api/admin/orders/${encodeURIComponent(button.dataset.confirm)}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      notify(`${data.order.tableLabel || data.order.table} · ${data.order.id} · Order confirmed. The customer’s page will update.`);
    } catch (error) {
      notify(error.message || 'Connection lost. Please retry confirmation.');
      button.disabled = false; button.textContent = 'Confirm order ✓';
    } finally { confirming = false; await refreshOrders(); }
  });
  byId('refresh-live').addEventListener('click', refreshOrders);
  byId('refresh-tables').addEventListener('click', () => {
    if (!changingTables) { byId('table-message').textContent = ''; loadTables(); }
  });
  byId('add-table-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    changeTables('/api/admin/tables', { table: form.elements.namedItem('table').value, capacity: Number(form.elements.namedItem('capacity').value) }, result => `${result.table.table} added with ${result.table.capacity} seats. Its QR code is ready below.`);
  });
  byId('seating-grid').addEventListener('change', event => {
    const id = event.target.dataset.selectTable;
    if (!id) return;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    updateSelection();
  });
  byId('seating-grid').addEventListener('submit', event => {
    const form = event.target.closest('[data-seat-table]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    changeTables(`/api/admin/tables/${form.dataset.seatTable}/capacity`, { capacity: Number(form.elements.namedItem('capacity').value) }, result => `${result.table.table} updated to ${result.table.capacity} seats.`);
  });
  byId('join-tables').addEventListener('click', () => {
    if (selected.size < 2) return;
    changeTables('/api/admin/tables/join', { tables: [...selected] }, result => `${result.table.label} joined · ${result.table.combinedCapacity} seats. All original QR codes still work.`);
  });
  byId('seating-grid').addEventListener('click', event => {
    const button = event.target.closest('[data-separate]');
    if (button) changeTables(`/api/admin/tables/${button.dataset.separate}/separate`, {}, 'Tables separated. Each table keeps its own seats and QR code.');
  });
  byId('print-qrs').addEventListener('click', () => window.print());
  const ready = Promise.all([loadTables(), tick()]);
  const stop = () => { stopped = true; window.clearTimeout(timer); };
  window.addEventListener('pagehide', stop);
  return { ready, refreshOrders, loadTables, stop };
}


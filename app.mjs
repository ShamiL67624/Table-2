import { createOrders, defaults, filterOrders, summarize, sortOrders, toCSV, dateKey, menuItems } from './data.mjs';

const orders = createOrders();
const form = document.querySelector('#filters');
const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const number = value => new Intl.NumberFormat('en-IN').format(value);
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let page = 1;
const pageSize = 7;
let matching = [];
const byId = id => document.getElementById(id);

function render() {
  const filters = Object.fromEntries(new FormData(form));
  const custom = filters.period === 'custom';
  byId('custom-dates').hidden = !custom;
  const error = custom && (!filters.from || !filters.to) ? 'Choose both a start date and an end date.' : custom && filters.from > filters.to ? 'The end date must be on or after the start date.' : '';
  byId('filter-error').textContent = error;
  byId('filter-error').hidden = !error;
  matching = sortOrders(filterOrders(orders, filters), byId('sort').value);
  byId('export-button').disabled = matching.length === 0;
  const range = custom ? `${filters.from || '…'} – ${filters.to || '…'}` : form.elements.period.selectedOptions[0].text;
  byId('results-line').textContent = `${number(matching.length)} matching orders · ${range} · ${filters.location === 'all' ? 'All locations' : filters.location}`;
  const summary = summarize(matching);
  const cards = [
    ['Total revenue', money(summary.revenue), '₹', `${number(summary.completed)} completed orders`],
    ['Total orders', number(summary.total), '▤', 'All matching order statuses'],
    ['Average order value', money(summary.average), '↗', 'Across completed orders'],
    ['Completion rate', `${summary.completion.toFixed(1)}%`, '✓', `${number(summary.completed)} of ${number(summary.total)} orders completed`]
  ];
  byId('stats').innerHTML = cards.map(([title, value, icon, description]) => `<article class="stat"><div class="stat-top">${title}<span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-sub"><span aria-hidden="true">↳</span> ${description}</div></article>`).join('');
  renderRevenue();
  renderMix();
  renderTable();
}

function renderRevenue() {
  const days = new Map();
  matching.forEach(order => {
    const key = dateKey(new Date(order.date));
    if (!days.has(key)) days.set(key, 0);
    if (order.status === 'Completed') days.set(key, days.get(key) + order.amount);
  });
  const entries = [...days].sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    byId('revenue-chart').innerHTML = '<div class="chart-empty">No revenue data matches these filters.</div>';
    return;
  }
  const first = new Date(`${entries[0][0]}T12:00:00`);
  const last = entries.at(-1)[0];
  const series = [];
  for (let date = new Date(first); dateKey(date) <= last; date.setDate(date.getDate() + 1)) {
    const key = dateKey(date);
    series.push([key, days.get(key) || 0]);
  }
  const max = Math.max(1000, Math.ceil(Math.max(...series.map(([, value]) => value)) / 1000) * 1000);
  const shortDate = key => new Date(`${key}T12:00:00`).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  const chart = byId('revenue-chart');
  chart.innerHTML = `<div class="chart-layout"><div class="chart-axis">${[1, .75, .5, .25, 0].map(part => `<span>${money(max * part)}</span>`).join('')}</div><div class="chart-plot"><div class="bars">${series.map(([key, value]) => `<div class="bar-column"><div class="bar" tabindex="0" role="img" aria-label="${shortDate(key)}: ${money(value)}" title="${shortDate(key)}: ${money(value)}" style="height:${value / max * 100}%"></div></div>`).join('')}</div><div class="chart-labels">${series.filter((_, index) => index % Math.max(1, Math.ceil(series.length / 7)) === 0 || index === series.length - 1).map(([key]) => `<span>${shortDate(key)}</span>`).join('')}</div></div></div>`;
}

function renderMix() {
  const colors = ['#55784c', '#a9bd83', '#e1e8d3'];
  const types = ['Dine-in', 'Delivery', 'Takeaway'];
  const counts = types.map(type => matching.filter(order => order.type === type).length);
  let position = 0;
  const gradient = counts.map((count, index) => {
    const start = position;
    position += matching.length ? count / matching.length * 100 : 0;
    return `${colors[index]} ${start}% ${position}%`;
  }).join(',');
  byId('order-mix').innerHTML = `<div class="donut-wrap"><div class="donut" style="background:${matching.length ? `conic-gradient(${gradient})` : '#edf0e7'}"><div class="donut-center"><strong>${number(matching.length)}</strong><small>Total orders</small></div></div></div><div class="mix-legend">${types.map((type, index) => `<div class="mix-row"><i style="background:${colors[index]}" aria-hidden="true"></i><span>${type}</span><strong>${counts[index]}</strong><span>${matching.length ? Math.round(counts[index] / matching.length * 100) : 0}%</span></div>`).join('')}</div>`;
}

function renderTable() {
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  page = Math.min(page, pages);
  const start = (page - 1) * pageSize;
  const visible = matching.slice(start, start + pageSize);
  byId('orders-body').innerHTML = visible.length ? visible.map(order => `<tr><td>${escape(order.id)}<small>${new Date(order.date).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></td><td><span class="customer"><span class="customer-initial" aria-hidden="true">${escape(order.customer.split(' ').map(word => word[0]).join(''))}</span>${escape(order.customer)}</span></td><td>${escape(order.location)}</td><td>${escape(order.type)}</td><td><span class="status ${order.status.toLowerCase()}">${escape(order.status)}</span></td><td>${escape(order.payment)}</td><td class="amount">${money(order.amount)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">No orders match your filters. Try a wider date range or reset filters.</td></tr>';
  byId('page-info').textContent = matching.length ? `Showing ${start + 1}–${Math.min(start + pageSize, matching.length)} of ${number(matching.length)} orders · Page ${page} of ${pages}` : 'Showing 0 orders';
  byId('previous').disabled = page === 1;
  byId('next').disabled = page === pages;
}

function renderItems() {
  const filters = Object.fromEntries(new FormData(byId('item-filters')));
  const query = filters.search.trim().toLowerCase();
  const items = menuItems.filter(item =>
    (!query || `${item.id} ${item.name} ${item.description}`.toLowerCase().includes(query))
    && (filters.category === 'all' || item.category === filters.category)
    && (filters.availability === 'all' || item.available === (filters.availability === 'available'))
  );
  byId('items-body').innerHTML = items.length ? items.map(item => `<tr><td>${escape(item.id)}</td><td><strong class="item-name">${escape(item.name)}</strong><small class="item-description">${escape(item.description)}</small></td><td>${escape(item.category)}</td><td><span class="status ${item.available ? '' : 'cancelled'}">${item.available ? 'Available' : 'Unavailable'}</span></td><td class="item-price">${money(item.price)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-cell">No items match your filters. Try another search or reset item filters.</td></tr>';
  byId('item-count').textContent = `Showing ${items.length} of ${menuItems.length} menu items`;
}

function navigate() {
  const pages = {
    dashboard: ['Dashboard', 'Good food. Great service. Here’s how business is looking.'],
    orders: ['Orders', 'Every order, from the first ticket to the final bill.'],
    items: ['Item Board', 'Your menu at a glance, from starters to something sweet.'],
    tables: ['Table QR', 'A shared menu. A personal welcome at every table.'],
    reports: ['Sales reports', 'See the numbers behind your restaurant’s performance.'],
    guide: ['User guide', 'Everything you need to get the most out of your workspace.']
  };
  const requested = location.hash.slice(1);
  const active = Object.hasOwn(pages, requested) ? requested : 'dashboard';
  if (requested !== active) history.replaceState(null, '', `#${active}`);
  document.querySelectorAll('[data-page]').forEach(link => {
    link.classList.toggle('active', link.dataset.page === active);
    if (link.dataset.page === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  byId('page-title').textContent = byId('breadcrumb').textContent = pages[active][0];
  byId('page-description').textContent = pages[active][1];
  document.title = `${pages[active][0]} · Table & Thyme`;
  ['filter-panel', 'results-line', 'export-button', 'stats'].forEach(id => byId(id).hidden = !['dashboard', 'orders', 'reports'].includes(active));
  byId('charts').hidden = !['dashboard', 'reports'].includes(active);
  byId('orders-panel').hidden = !['dashboard', 'orders'].includes(active);
  byId('items-panel').hidden = !['dashboard', 'orders', 'items'].includes(active);
  byId('live-panel').hidden = !['dashboard', 'orders', 'tables'].includes(active);
  byId('qr-panel').hidden = active !== 'tables';
  byId('guide').hidden = active !== 'guide';
  byId('table-title').textContent = active === 'orders' ? 'All orders' : 'Recent orders';
}

form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', () => { page = 1; render(); });
byId('reset-button').addEventListener('click', () => {
  Object.entries(defaults).forEach(([key, value]) => form.elements[key].value = value);
  page = 1; render();
});
byId('sort').addEventListener('change', () => { page = 1; render(); });
byId('previous').addEventListener('click', () => { page--; renderTable(); });
byId('next').addEventListener('click', () => { page++; renderTable(); });
byId('export-button').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([toCSV(matching)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url; link.download = `table-and-thyme-orders-${dateKey(new Date())}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('hashchange', navigate);
byId('item-filters').addEventListener('submit', event => event.preventDefault());
byId('item-filters').addEventListener('input', renderItems);
byId('reset-items').addEventListener('click', () => {
  byId('item-filters').reset();
  renderItems();
});
navigate();
render();
renderItems();

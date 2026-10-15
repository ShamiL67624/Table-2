export const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const defaults = { period: '7', location: 'all', type: 'all', status: 'all', payment: 'all', search: '', from: '', to: '' };

export const menuItems = [
  { id: 'ITEM-001', name: 'Paneer Tikka', description: 'Tandoor-grilled paneer with mint chutney', category: 'Starters', price: 280, available: true },
  { id: 'ITEM-002', name: 'Crispy Corn', description: 'Golden corn tossed with chilli and lime', category: 'Starters', price: 220, available: true },
  { id: 'ITEM-003', name: 'Chicken Tikka', description: 'Spiced chicken with onion salad', category: 'Starters', price: 340, available: true },
  { id: 'ITEM-004', name: 'Paneer Butter Masala', description: 'Paneer in a creamy tomato gravy', category: 'Main course', price: 320, available: true },
  { id: 'ITEM-005', name: 'Butter Chicken', description: 'Tandoori chicken in a rich tomato sauce', category: 'Main course', price: 380, available: true },
  { id: 'ITEM-006', name: 'Vegetable Biryani', description: 'Aromatic basmati rice with seasonal vegetables', category: 'Main course', price: 290, available: true },
  { id: 'ITEM-007', name: 'Chicken Biryani', description: 'Slow-cooked chicken and fragrant basmati rice', category: 'Main course', price: 360, available: false },
  { id: 'ITEM-008', name: 'Garlic Naan', description: 'Tandoor-baked bread with garlic butter', category: 'Sides', price: 80, available: true },
  { id: 'ITEM-009', name: 'Gulab Jamun', description: 'Warm milk dumplings in cardamom syrup', category: 'Desserts', price: 140, available: true },
  { id: 'ITEM-010', name: 'Chocolate Brownie', description: 'Chocolate brownie served with vanilla ice cream', category: 'Desserts', price: 190, available: false },
  { id: 'ITEM-011', name: 'Fresh Lime Soda', description: 'Fresh lime with sparkling water', category: 'Beverages', price: 110, available: true },
  { id: 'ITEM-012', name: 'Mango Lassi', description: 'Chilled mango and yoghurt drink', category: 'Beverages', price: 150, available: true }
];

export function createOrders(now = new Date()) {
  const names = ['Aarav Sharma', 'Diya Patel', 'Rohan Mehta', 'Ananya Rao', 'Kabir Singh', 'Meera Nair', 'Ishaan Gupta', 'Priya Shah', 'Arjun Reddy', 'Zoya Khan', 'Dev Joshi', 'Tara Iyer'];
  const orders = [];
  for (let day = 0; day < 30; day++) {
    const count = 9 + ((day * 7 + 5) % 13);
    for (let index = 0; index < count; index++) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day, 10 + (index % 12), (index * 17) % 60);
      if (date > now) {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        date.setTime(Math.max(todayStart, now.getTime() - index * 60000));
      }
      const seed = day * 31 + index * 7;
      orders.push({ id: `TT-${10480 - orders.length}`, customer: names[seed % names.length], date: date.toISOString(), location: ['Indiranagar', 'Koramangala', 'Whitefield'][(day + index) % 3], type: ['Dine-in', 'Dine-in', 'Delivery', 'Takeaway', 'Dine-in', 'Delivery'][seed % 6], status: seed % 13 === 0 ? 'Cancelled' : day === 0 && seed % 5 === 0 ? 'Pending' : day === 0 && seed % 3 === 0 ? 'Preparing' : 'Completed', payment: ['UPI', 'Card', 'Cash'][(day * 2 + index) % 3], amount: 280 + (seed * 19 % 1800) });
    }
  }
  return orders;
}

export function filterOrders(orders, filters, now = new Date()) {
  let from = '', to = '';
  if (filters.period === 'custom') {
    from = filters.from; to = filters.to;
    if (!from || !to || from > to) return [];
  } else if (filters.period !== 'all') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - (filters.period === 'today' ? 0 : Number(filters.period) - 1));
    from = dateKey(start); to = dateKey(now);
  }
  const search = filters.search.trim().toLowerCase();
  return orders.filter(order => {
    const date = dateKey(new Date(order.date));
    return (!from || date >= from) && (!to || date <= to)
      && ['location', 'type', 'status', 'payment'].every(key => filters[key] === 'all' || order[key] === filters[key])
      && (!search || `${order.id} ${order.customer}`.toLowerCase().includes(search));
  });
}

export function summarize(orders) {
  const completed = orders.filter(order => order.status === 'Completed');
  const revenue = completed.reduce((sum, order) => sum + order.amount, 0);
  return { revenue, total: orders.length, completed: completed.length, average: completed.length ? revenue / completed.length : 0, completion: orders.length ? completed.length / orders.length * 100 : 0 };
}

export function sortOrders(orders, sort = 'newest') {
  return [...orders].sort((a, b) => sort === 'highest' ? b.amount - a.amount : sort === 'lowest' ? a.amount - b.amount : sort === 'oldest' ? new Date(a.date) - new Date(b.date) : new Date(b.date) - new Date(a.date));
}

export function toCSV(orders) {
  const escape = value => {
    let text = String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['Order ID', 'Customer', 'Date (UTC)', 'Location', 'Order type', 'Status', 'Payment', 'Amount (INR)'], ...orders.map(order => [order.id, order.customer, order.date, order.location, order.type, order.status, order.payment, order.amount])];
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
}

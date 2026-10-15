# Table & Thyme — Restaurant admin

A restaurant admin and QR ordering app in `F1`, built with HTML, CSS, and JavaScript, with a local Node server. It starts with four tables and supports adding tables, changing seat capacities, and joining tables for groups. QR orders and table configurations are saved on the restaurant computer; existing sales charts use generated sample history for the latest 30 days. The customer menu shares the Item Board's 12-item sample catalogue. No payment processing or external POS integration is included. Order-report filters do not persist across reloads.

## Run locally

Use Node.js 20 or newer. In PowerShell:

```powershell
cd 'C:\AI WEB including icloud gpt\RESTURENT\F1'
npm ci
npm run dev
```

You can also run `npm run dev` from the parent `C:\AI WEB including icloud gpt\RESTURENT` folder. Its root `package.json` starts this same app in `F1`.

Open http://127.0.0.1:3000. Dependencies are already installed here; `npm ci` is needed on fresh checkouts or after dependencies change. Keep the terminal running; press Ctrl+C to stop. If port 3000 is occupied, set `$env:PORT = '3001'` before running the command. Use the HTTP server rather than opening `index.html` directly because the app uses JavaScript modules. The server binds to `0.0.0.0` for customer access on the local network; admin pages and admin APIs accept loopback connections only. Open admin using `127.0.0.1` or `localhost` on this computer.

## Admin sidebar pages

| Page | Address | Purpose |
| --- | --- | --- |
| Dashboard | `/#dashboard` | Performance cards, daily revenue, order mix, recent orders, and the Item Board |
| Orders | `/#orders` | Search, filter, sort, paginate, and export orders, with the Item Board below |
| Item Board | `/#items` | Menu item list with search, category, and availability filters |
| Table QR | `/#tables` | Add tables, edit capacities, join/separate tables, QR cards, and live orders |
| Sales reports | `/#reports` | Performance cards and charts for the filtered selection |
| User guide | `/#guide` | In-app instructions and metric definitions |

The sidebar supports direct links and browser back/forward navigation. Selected filters are shared between pages during the current session.

## Filters and actions

All filters combine, and update the cards, both charts, table, and CSV export together:

| Control | Choices / behavior |
| --- | --- |
| Date range | Today, last 7 days (default), last 30 days, all dates, or a custom inclusive start/end range |
| Location | All locations, Indiranagar, Koramangala, Whitefield |
| Order type | All types, Dine-in, Takeaway, Delivery |
| Order status | All statuses, Completed, Preparing, Pending, Cancelled |
| Payment | All payment methods, UPI, Card, Cash |
| Search | Case-insensitive substring match on order ID or customer name |
| Reset filters | Restores the last 7 days, all categories, and empty search/custom dates; keeps the sort selection |
| Sort | Newest first (default), oldest first, highest amount, lowest amount |
| Pagination | Seven orders per page; changing a filter or sort returns to page one |
| Export CSV | Downloads every matching order in the chosen sort order, including rows outside the current page |

Incomplete or reversed custom dates display an error and no results. Empty results show zero metrics, an empty chart/table message, and disabled export and pagination buttons. Date filtering uses the browser’s local calendar; exported timestamps are explicitly labeled UTC.

## Item Board

The Item Board appears immediately below the order table on Dashboard and Orders. Its sidebar link is directly below Orders and opens a dedicated item-list page. The sample menu lists 12 items with item ID, name, description, category, availability, and price in INR:

| Category | Items |
| --- | --- |
| Starters | Paneer Tikka, Crispy Corn, Chicken Tikka |
| Main course | Paneer Butter Masala, Butter Chicken, Vegetable Biryani, Chicken Biryani |
| Sides | Garlic Naan |
| Desserts | Gulab Jamun, Chocolate Brownie |
| Beverages | Fresh Lime Soda, Mango Lassi |

Search by name, ID, or description and combine category and availability filters. Reset item filters restores the full list. These filters are independent of order filters and stay selected while switching sidebar pages. All matching items are listed without pagination. Empty searches show an explanatory message and a zero item count.

The menu is a read-only sample catalogue in `data.mjs` (`menuItems`), separate from the generated orders. Item prices and availability are demonstration values; the Item Board does not change order metrics or the order CSV export.

## QR menu and table orders

### Table capacity and joined seating

T1–T4 default to 4 seats each. Under **Table QR → Tables & seating**, enter a table name (T1–T9999) and a capacity (1–30 seats) to add a table. Leave the name blank to use the next number. Each added table gets a working menu link and QR code automatically. Use **Save seats** on a table card to change its individual capacity.

Select two or more separate tables and press **Join selected tables**. The selected group displays a combined label such as **T1 + T2** and the sum of its seats. Capacity edits recalculate that sum. A table cannot belong to two joined groups; separate it before joining a different group. Press **Separate** on any group member to separate the whole group without changing the individual capacities or QR links.

Existing physical QR codes stay valid while tables are joined or separated. Customer menu pages read the current seating configuration when opened. New orders snapshot the physical table scanned, joined-table label, group members, and combined seat capacity at submission. Previous orders and retry responses retain their original seating details even after separation. Joining changes seating; it does not merge existing orders, receipts, carts, or payments.

Configuration is stored in `F1/data/tables.json` and survives restart. Table edits refresh QR cards on the admin page. Use **Refresh tables** to load changes made in another admin tab, and `npm run qr` to refresh exported files after changing the layout.

### Customer ordering

1. Open **Table QR** in the admin sidebar. Each table card encodes `/menu?table=T1` (or the corresponding table). All tables read the same `/api/menu` catalogue.
2. Connect customer phones to the same Wi-Fi as the computer. Open one displayed customer URL on a phone before printing. Keep the server running. The restaurant network must allow phone-to-computer connections and the selected server port; guest-network isolation or a firewall can prevent access.
3. Use **Print all N QR cards** or **Download QR**. You can also run `npm run qr` from either folder to export an SVG and 800px PNG for every configured table, plus the self-contained printable `qr-codes/tables.html`. Run `npm run check:qr` inside F1 to independently decode the PNGs and verify each encoded table URL.
4. Customers scan their table, browse categories, search dishes, adjust quantities, and optionally add a kitchen note. Unavailable dishes cannot be ordered. Pressing **Place order** sends the selection; opening or scanning the menu does not submit anything.
5. The customer sees **Order placed**. The admin inbox updates about every three seconds while the page is open, with the table, order number, item quantities, note, total, and an **Ordered** status. A notification announces new orders across sidebar pages.
6. Staff clicks **Confirm order**. The saved status becomes **Confirmed**, and the customer's receipt updates to **Order confirmed**. Confirming does not collect a payment. Customers pay at the restaurant.

QR orders appear in **Live table orders**, above the sample reports on Dashboard and Orders, and on Table QR. They do not feed the sample metrics or order CSV. Each table's cart, pending submission, and latest receipt are saved separately in that browser when local storage is available. Customers can start another order from the receipt. The server calculates prices and totals from its catalogue and rejects invalid tables, sold-out items, empty orders, and quantities outside 1–20. Retry IDs prevent duplicate orders when a response is lost. Receipt status requires the token issued with that order.

Orders persist in `F1/data/orders.json`, excluded from Git and not exposed as a static file. Restarting the server retains orders and confirmations. Back up this file if retaining orders matters. Run one server process per data file. This is a local-network application; no public hosting, staff login, payment integration, or connection to a production restaurant database is configured.

### Choosing the address encoded in the QRs

The server and exporter choose a local IPv4 address automatically. If there are multiple adapters (for example a VPN), explicitly select the computer's Wi-Fi address before starting the server and regenerating the QR files:

```powershell
$env:MENU_BASE_URL = 'http://192.168.1.24:3000'
npm run qr
npm run dev
```

Replace that example address with the computer's actual reachable address. `MENU_BASE_URL` accepts an HTTP(S) origin, without a path. Setting it only changes QR destinations; it does not publish the app. If the IP address, `PORT`, or override changes, regenerate and reprint. The **Open menu** admin button previews locally; the encoded QR uses the customer network address. Orders and notifications require the server to remain available.

### Fixing a stuck Table QR page

If the page shows “Connecting to the restaurant” or “Preparing your table links” indefinitely, restart the server in its terminal with Ctrl+C followed by `npm run dev`, then reload the browser. The old static server can serve updated HTML while returning 404 for new JavaScript and API routes. The module loader now shows restart instructions if it cannot load; API and QR image requests time out after eight seconds. **Refresh tables** and **Refresh** retry table and order requests after the server is available. Use the printed localhost admin URL, not a file URL or a separate static preview server.

## Metric definitions

- **Total revenue:** Sum of matching completed order amounts, displayed in INR.
- **Total orders:** Count of all matching orders, including cancelled and unfinished orders.
- **Average order value:** Completed revenue divided by matching completed orders; zero if none.
- **Completion rate:** Matching completed orders divided by all matching orders; zero if none.
- **Revenue overview:** Completed revenue grouped by day, from the first to the last matching order date. Intermediate days with no revenue show zero.
- **Orders by type:** Count and percentage of all matching orders by Dine-in, Delivery, and Takeaway. Rounded percentages may not total exactly 100%.

CSV contains order ID, customer, UTC timestamp, location, order type, status, payment method, and amount in INR. It includes all matching statuses, so select Completed when exporting completed sales. Text fields are quoted and spreadsheet formula prefixes are neutralized.

## Files and integration

| File | Responsibility |
| --- | --- |
| `index.html` | Sidebar, dashboard structure, filters, and embedded guide |
| `styles.css` | Responsive cream/green theme; Google Fonts with local sans-serif fallback |
| `app.mjs` | Page navigation, rendering, filter events, pagination, and downloads |
| `data.mjs` | Sample data, filtering, sorting, metric calculations, and CSV encoding |
| `server.mjs` | Local HTTP server, shared menu/order APIs, loopback-only admin routes, and QR generation |
| `order-store.mjs` | Validated order creation, retry deduplication, JSON persistence, and confirmation |
| `table-store.mjs` | Persistent table names, seat capacities, joining/separation, and combined seating summaries |
| `admin-orders.mjs` | Printable QR cards, live order inbox, notifications, and staff confirmation |
| `menu.html`, `menu.css`, `menu.mjs` | Responsive customer menu, categories, cart, checkout, and order receipt |
| `scripts/export-qr.mjs` | Generates PNG/SVG codes and printable cards for all configured tables |
| `scripts/check-qr.mjs` | Independently decodes exported PNG codes and checks their table URLs |
| `tests/dashboard.test.mjs` | Data behavior and CSV regression tests |
| `tests/ui.test.mjs` | DOM interaction checks against the actual HTML and application module |
| `tests/ordering.test.mjs` | HTTP and customer/admin DOM integration checks for QR ordering |
| `tests/run.mjs` | Runs both suites in one process, including on systems that restrict child processes |
| `package-lock.json` | Reproducible development dependency installation |

To integrate real data, replace `createOrders()` in `app.mjs` with an authenticated API request and keep the same order fields: `id`, `customer`, ISO timestamp `date`, `location`, `type`, `status`, `payment`, and numeric `amount` in rupees. Update the filter options to match the actual restaurant. Establish the restaurant’s reporting timezone and accounting rules before using these calculations for live reports. Enforce administrator authorization on the server and handle API loading/errors before deployment. Remove demo labels only after real data is connected.

## Verification

```powershell
npm ci
npm test
```

The test runner reports 27 passing tests, including the ordering workflow parent test. Coverage includes the original 17 data/DOM checks, distinct table QR outputs, shared menu access, server-side totals, invalid requests, concurrent retry deduplication, receipt access, customer-to-admin ordering and confirmation, restart persistence, table cart separation, and recovery after a lost response. Seating checks exercise adding a table, editing capacity, joining, recalculating group seats, ordering from a new table, separating without rewriting history, validation failures, and recovery from an older server's 404 responses. Tests use temporary files and do not add tables or orders to the real workspace.

Use `npm run test:data`, `npm run test:ui`, or `npm run test:ordering` inside F1 for individual suites. The DOM tests use Happy DOM; they do not render or verify CSS layout. Visual desktop/mobile verification remains outstanding because Windows permissions blocked the browser launch. A physical phone scan and printed QR scan have not been verified in this environment.

For a manual visual check, open each sidebar page, combine filters, test an empty search, use a custom date range, reset, page/sort orders, and export CSV. Resize to a narrow mobile viewport and confirm the order table scrolls horizontally.

No hosted deployment has been configured; this project runs locally in `F1`.

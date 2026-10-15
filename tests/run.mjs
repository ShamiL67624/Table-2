// Import the suites in one process for environments that restrict spawning.
await import('./dashboard.test.mjs');
await import('./ui.test.mjs');
await import('./ordering.test.mjs');

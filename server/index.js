import { db } from './db.js';
import { ensureSuperAdmin, seedDemo, seedExtras } from './seed.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';

const PROD = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const PORT = Number(process.env.PORT) || 5173;

const app = await createApp({ prod: PROD, vite: !PROD });
const server = app.listen(PORT, () => console.log(`BANA Connect running at http://localhost:${PORT} (${PROD ? 'production' : 'development'})`));
server.headersTimeout = 30_000;
server.requestTimeout = 120_000;

if (process.env.SEED_DEMO === 'true') {
  seedDemo();
  seedExtras();
} else {
  ensureSuperAdmin();
}
startJobs();

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

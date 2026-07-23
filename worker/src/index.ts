import 'dotenv/config';
import { startHealthServer } from './healthServer.js';
import { runWorkerLoop } from './workerLoop.js';

async function main(): Promise<void> {
  console.log('Starting worker...');
  // Runs concurrently with the poll loop below — it must never block or delay polling.
  startHealthServer();
  await runWorkerLoop();
}

main().catch((err) => {
  console.error('Worker process crashed:', err);
  process.exit(1);
});

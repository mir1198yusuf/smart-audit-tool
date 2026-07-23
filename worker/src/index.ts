import 'dotenv/config';
import { runWorkerLoop } from './workerLoop.js';

async function main(): Promise<void> {
  console.log('Starting worker...');
  await runWorkerLoop();
}

main().catch((err) => {
  console.error('Worker process crashed:', err);
  process.exit(1);
});

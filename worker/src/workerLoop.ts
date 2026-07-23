import { processClaimedRecord } from './processEntry.js';
import { claimPendingRecord } from './queue.js';
import { sleep } from './rateLimit.js';

const POLL_INTERVAL_MS = 10_000;

export async function runWorkerLoop(): Promise<void> {
  console.log('[worker] started');

  while (true) {
    const claimed = await claimPendingRecord();

    if (!claimed) {
      console.log(`[worker] no pending records, waiting ${POLL_INTERVAL_MS / 1000}s`);
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.log(`[worker] claimed audit_entries.id=${claimed.entry.id}`);

    try {
      await processClaimedRecord(claimed);
      console.log(`[worker] completed audit_entries.id=${claimed.entry.id} (status=COMPLETED)`);
    } catch (err) {
      // processClaimedRecord already rolled back the transaction before rethrowing.
      console.error(`[worker] failed audit_entries.id=${claimed.entry.id}, left PENDING for retry:`, err);
    }
  }
}

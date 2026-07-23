import type { Knex } from 'knex';

export async function fetchAnomalyFlagNames(trx: Knex.Transaction): Promise<string[]> {
  const rows = await trx('anomaly_flags').select('name').orderBy('name', 'asc');
  return rows.map((row) => row.name as string);
}

export async function insertNewAnomalyFlags(
  trx: Knex.Transaction,
  proposedFlags: string[],
  knownFlags: string[]
): Promise<void> {
  const known = new Set(knownFlags);
  const newFlags = [...new Set(proposedFlags)].filter((flag) => !known.has(flag));

  if (newFlags.length === 0) return;

  await trx('anomaly_flags')
    .insert(newFlags.map((name) => ({ name })))
    .onConflict('name')
    .ignore();
}

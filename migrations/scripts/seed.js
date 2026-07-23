// Seeds 10 varied audit entries by inserting directly into Postgres via knex (same connection
// config as the migration files — see ../knexfile.js), rather than exercising the HTTP API. This
// mirrors exactly what AuditRepository.create() does on POST /api/audit-entries: one row into
// `audit_entries` (baseline evidence) plus one row into `audit_ai_metadata` with
// `status = 'PENDING'` per entry, in a single transaction each, so the backend server does not
// need to be running and the worker's polling loop still picks these rows up normally on its next
// cycle. Run: node scripts/seed.js

const knex = require('knex');
const knexConfig = require('../knexfile.js');

const db = knex(knexConfig);

const DEMO_TENANT_ID = 'tenant_abc123';

function isoNow(offsetMinutes) {
  return new Date(Date.now() - offsetMinutes * 60000).toISOString();
}

const records = [
  {
    eventType: 'Control Execution',
    evidenceId: 'EVID-SEED-001',
    entityName: 'Global Procurement Services',
    description: 'Manual approval override executed for vendor invoice payables exceeding $50k threshold',
    monetaryImpact: 68000,
    controlId: 'CTRL-FIN-302',
    actorUserId: 'user_7731',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(10),
  },
  {
    eventType: 'Transaction Approval',
    evidenceId: 'EVID-SEED-002',
    entityName: 'Regional Sales Division',
    description: 'Routine purchase order approval within standard delegation of authority limits',
    monetaryImpact: 3600,
    controlId: 'CTRL-OPS-118',
    actorUserId: 'user_2210',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(20),
  },
  {
    eventType: 'Access Control Change',
    evidenceId: 'EVID-SEED-003',
    entityName: 'IT Infrastructure Team',
    description: 'Emergency access grant to production financial database outside standard change window',
    monetaryImpact: 0,
    controlId: 'CTRL-SEC-045',
    actorUserId: 'user_5589',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(30),
  },
  {
    eventType: 'Vendor Onboarding',
    evidenceId: 'EVID-SEED-004',
    entityName: 'Third-Party Risk Management',
    description: 'New vendor added to approved supplier list without completed sanctions-list screening',
    monetaryImpact: 0,
    controlId: 'CTRL-VEN-210',
    actorUserId: 'user_3345',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(40),
  },
  {
    eventType: 'Payroll Adjustment',
    evidenceId: 'EVID-SEED-005',
    entityName: 'Human Resources Shared Services',
    description: 'Off-cycle payroll adjustment processed for departing executive without dual sign-off',
    monetaryImpact: 42000,
    controlId: 'CTRL-HR-077',
    actorUserId: 'user_9012',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(50),
  },
  {
    eventType: 'Journal Entry',
    evidenceId: 'EVID-SEED-006',
    entityName: 'Corporate Accounting',
    description: 'Manual journal entry posted directly to the general ledger to correct a quarter-end revenue recognition error',
    monetaryImpact: 210000,
    controlId: 'CTRL-FIN-118',
    actorUserId: 'user_6642',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(60),
  },
  {
    eventType: 'Data Export',
    evidenceId: 'EVID-SEED-007',
    entityName: 'Customer Data Platform',
    description: 'Bulk export of customer PII data initiated by a service account outside normal business hours',
    monetaryImpact: 0,
    controlId: 'CTRL-SEC-098',
    actorUserId: 'user_1187',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(70),
  },
  {
    eventType: 'Contract Approval',
    evidenceId: 'EVID-SEED-008',
    entityName: 'Legal & Contracts',
    description: 'Master services agreement signed by a single approver despite policy requiring two-party sign-off above $100k',
    monetaryImpact: 150000,
    controlId: 'CTRL-LEG-033',
    actorUserId: 'user_4471',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(80),
  },
  {
    eventType: 'System Configuration Change',
    evidenceId: 'EVID-SEED-009',
    entityName: 'Core Banking Platform',
    description: 'Fraud-detection threshold lowered in production without a documented change request or peer review',
    monetaryImpact: 0,
    controlId: 'CTRL-SEC-061',
    actorUserId: 'user_8820',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(90),
  },
  {
    eventType: 'Transaction Approval',
    evidenceId: 'EVID-SEED-010',
    entityName: 'Regional Sales Division',
    description: 'Routine purchase order approval within standard delegation of authority limits',
    monetaryImpact: 5100,
    controlId: 'CTRL-OPS-118',
    actorUserId: 'user_2210',
    tenantId: DEMO_TENANT_ID,
    timestamp: isoNow(100),
  },
];

// Mirrors AuditRepository.create(): one transaction per record, inserting the baseline row into
// audit_entries then the AI-metadata row (status = 'PENDING') into audit_ai_metadata, keyed off
// the entry's generated id. Per docs/backend.md's transaction convention: no explicit commit in
// the try block (an early return would skip it) — catch rolls back, finally commits only if the
// transaction wasn't already completed by a rollback.
async function insertRecord(record) {
  const trx = await db.transaction();

  try {
    const [entry] = await trx('audit_entries')
      .insert({
        event_type: record.eventType,
        evidence_id: record.evidenceId,
        entity_name: record.entityName,
        description: record.description,
        monetary_impact: record.monetaryImpact,
        control_id: record.controlId,
        actor_user_id: record.actorUserId,
        tenant_id: record.tenantId,
        timestamp: record.timestamp,
      })
      .returning('*');

    await trx('audit_ai_metadata')
      .insert({
        audit_entry_id: entry.id,
        status: 'PENDING',
      })
      .returning('*');

    return entry;
  } catch (err) {
    await trx.rollback();
    throw err;
  } finally {
    if (!trx.isCompleted()) {
      await trx.commit();
    }
  }
}

async function seed() {
  console.log(`Seeding ${records.length} records directly into Postgres ...`);
  for (const record of records) {
    try {
      const entry = await insertRecord(record);
      console.log(`created id=${entry.id} evidenceId=${record.evidenceId} eventType=${record.eventType}`);
    } catch (err) {
      console.error(`FAILED evidenceId=${record.evidenceId}:`, err);
    }
  }
  console.log('Done. The worker will pick these up (status=PENDING) and enrich them on its next poll cycles.');
}

seed()
  .catch((err) => {
    console.error('Seed script failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });

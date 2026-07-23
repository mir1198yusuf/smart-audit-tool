exports.up = async function up(knex) {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS vector');

  await knex.schema.createTable('audit_entries', (table) => {
    table.increments('id').primary();
    table.text('event_type').notNullable();
    table.text('evidence_id').notNullable();
    table.text('entity_name').notNullable();
    table.text('description').notNullable();
    table.decimal('monetary_impact', null);
    table.text('control_id');
    table.text('actor_user_id');
    table.text('tenant_id').notNullable();
    table.timestamp('timestamp', { useTz: false }).notNullable();
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('audit_ai_metadata', (table) => {
    table.increments('id').primary();
    table
      .integer('audit_entry_id')
      .notNullable()
      .references('id')
      .inTable('audit_entries');
    table.text('status').notNullable().defaultTo('PENDING');
    table.decimal('risk_score', null);
    table.text('risk_level');
    table.text('ai_summary');
    table.specificType('anomaly_flags', 'text[]').notNullable().defaultTo('{}');
    table.specificType('semantic_vector', 'vector(768)');
    table.text('auditor_notes').notNullable().defaultTo('');
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('anomaly_flags', (table) => {
    table.increments('id').primary();
    table.text('name').notNullable().unique();
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE INDEX idx_ai_metadata_pending_queue
      ON audit_ai_metadata (created_at)
      WHERE status = 'PENDING'
  `);

  await knex.raw(`
    CREATE INDEX idx_ai_metadata_semantic_vector
      ON audit_ai_metadata
      USING hnsw (semantic_vector vector_cosine_ops)
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_ai_metadata_semantic_vector');
  await knex.raw('DROP INDEX IF EXISTS idx_ai_metadata_pending_queue');
  await knex.schema.dropTableIfExists('anomaly_flags');
  await knex.schema.dropTableIfExists('audit_ai_metadata');
  await knex.schema.dropTableIfExists('audit_entries');
};

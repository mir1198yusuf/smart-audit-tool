import knex from 'knex';

// DB_SSL=true for managed/remote Postgres (e.g. Aiven) that require SSL — rejectUnauthorized:
// false skips CA validation rather than needing the provider's CA bundle, a deliberate
// simplification for a prototype (weaker than full cert validation).
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

console.log(`[backend:db] connecting (ssl=${ssl ? 'enabled' : 'disabled'})`);

const db = knex({
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
  },
  pool: { min: 2, max: 10 },
});

export default db;

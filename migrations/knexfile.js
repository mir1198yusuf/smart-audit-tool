require('dotenv').config();

// DB_SSL=true for managed/remote Postgres (e.g. Aiven) that require SSL — rejectUnauthorized:
// false skips CA validation rather than needing the provider's CA bundle, a deliberate
// simplification for a prototype (weaker than full cert validation).
const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

module.exports = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl,
  },
  migrations: {
    directory: './files',
    tableName: 'knex_migrations',
  },
};

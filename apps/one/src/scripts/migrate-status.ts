import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Run with: npm run migrate:status (loads .env automatically)');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ version: string; applied_at: Date }>(
      'SELECT version, applied_at FROM schema_migrations ORDER BY applied_at'
    );

    if (res.rows.length === 0) {
      console.log('No migrations have been applied yet.');
      return;
    }

    console.log('Applied migrations:');
    for (const row of res.rows) {
      console.log(`  ${row.version}  ${row.applied_at.toISOString()}`);
    }
    console.log(`\nTotal: ${res.rows.length}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Status check failed:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// walk up from this file until we find infrastructure/migrations/ — works
// whether invoked from apps/one or from the repo root.
function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'infrastructure', 'migrations'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not locate infrastructure/migrations/ above ' + start);
}

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(SCRIPT_DIR);

loadEnvFile(path.join(REPO_ROOT, '.env'));

const MIGRATIONS_DIR = path.join(REPO_ROOT, 'infrastructure', 'migrations');
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Create a .env file in the project root or set the env var.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: DATABASE_URL });

async function ensureTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedVersions(client: pg.PoolClient): Promise<Set<string>> {
  const res = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
  return new Set(res.rows.map((r) => r.version));
}

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  let appliedCount = 0;

  try {
    await ensureTable(client);
    const applied = await getAppliedVersions(client);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No migration files found in infrastructure/migrations/');
      return;
    }

    // Warn when the same function is redefined across multiple migrations.
    // `CREATE OR REPLACE FUNCTION` is order-sensitive: the LAST file (by
    // sorted filename) wins. A FK table must also sort after its referenced
    // table. Collations differ (glibc vs macOS en-US), so names must be
    // collation-invariant — this guard surfaces accidental ordering traps.
    const fnOwners = new Map<string, string[]>();
    const fnRe = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+([a-zA-Z_][\w.]*)/gi;
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      let m: RegExpExecArray | null;
      while ((m = fnRe.exec(sql)) !== null) {
        const name = m[1].toLowerCase();
        if (!fnOwners.has(name)) fnOwners.set(name, []);
        fnOwners.get(name)!.push(file);
      }
    }
    for (const [name, owners] of fnOwners) {
      if (owners.length > 1) {
        console.warn(
          `  ⚠ function ${name} defined in ${owners.length} migrations ` +
            `(${owners.join(', ')}); the LAST by sorted filename wins ` +
            `(${owners[owners.length - 1]}). Ensure it carries the full body.`,
        );
      }
    }

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        console.log(`  ⊘ ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`  → ${file} ...`);

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file}`);
        appliedCount++;
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file}: ${(err as Error).message}`);
        process.exit(1);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  console.log(
    appliedCount === 0
      ? '\nNo new migrations.'
      : `\nApplied ${appliedCount} migration(s).`
  );
}

runMigrations().catch((err) => {
  console.error('Migration runner failed:', err);
  process.exit(1);
});

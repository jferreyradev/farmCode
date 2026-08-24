import 'dotenv/config';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

function buildSslConfig() {
  const flag = process.env.DATABASE_SSL?.toLowerCase();
  if (flag === 'false') return undefined as { rejectUnauthorized: boolean } | undefined;
  if (flag === 'true') return { rejectUnauthorized: false };
  // Auto-detección: solo desactiva SSL en hosts locales
  try {
    const host = new URL(process.env.DATABASE_URL ?? '').hostname.toLowerCase();
    const esLocal = ['localhost', '127.0.0.1', '::1'].includes(host);
    return esLocal ? undefined : { rejectUnauthorized: false };
  } catch {
    return { rejectUnauthorized: false };
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL no está definida. Copiá .env.example a .env y configurá el string de conexión.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: buildSslConfig(),
});

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de conexiones:', err.message);
});

export async function query<T extends QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] Error durante ROLLBACK:', rollbackErr);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function verificarConexion(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

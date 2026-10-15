import { PgBoss } from 'pg-boss';

/** Starts the pg-boss job queue in the app's PostgreSQL (schema `pgboss`, created on first start). */
export async function startJobs(databaseUrl: string): Promise<PgBoss> {
  const boss = new PgBoss(databaseUrl);
  // Without a listener an 'error' event would crash the process; log and keep running.
  boss.on('error', (error) => console.error('pg-boss error:', error));
  await boss.start();
  return boss;
}

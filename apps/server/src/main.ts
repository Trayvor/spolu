import { ConfigError, loadConfig } from './infra/config/config.js';
import { createDeps } from './deps.js';
import { runMigrations } from './infra/db/migrate.js';
import { buildApp } from './app.js';
import { backfillEntryProjects } from './modules/finance/backfill-projects.js';
import { ensureGroupChannel } from './modules/chat/service.js';
import { ensureAdminGroup } from './modules/groups/admin-group.js';
import { ensureBoard } from './modules/tasks/service.js';
import { ensureSuperadmin } from './modules/users/service.js';
import { registerStatic } from './static.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  await runMigrations(config.databaseUrl);
  const { deps, close } = await createDeps(config);
  const superadmin = await ensureSuperadmin(deps.db, {
    email: config.superadminEmail,
    name: config.superadminName,
  });
  if (superadmin === 'refused') {
    console.error(
      `SUPERADMIN_EMAIL ${config.superadminEmail} belongs to an admin or client account; it was not promoted. See docs/runbooks/deploy.md.`,
    );
  }
  // The admin group "eGrant tím" (Phase 34) with its board and chat, idempotent like the superadmin.
  const adminGroup = await ensureAdminGroup(deps.db);
  await ensureBoard(deps.db, adminGroup);
  await ensureGroupChannel(deps.db, adminGroup);
  const app = await buildApp(deps);
  if (config.webDistDir) await registerStatic(app, config.webDistDir);
  await app.listen({ host: '0.0.0.0', port: config.port });
  // Phase 33 P6: entries made before migration 0045 get their projects, once, in the background.
  void backfillEntryProjects(deps.db, { log: (line) => app.log.info(line) }).catch((error) =>
    app.log.error(error, 'finance.backfill-projects failed; it runs again on the next start'),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      app.log.warn(`${signal} received again, forcing exit`);
      process.exit(1);
    }
    shuttingDown = true;
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close(); // closes Socket.IO and the HTTP server
      await close();
      process.exit(0);
    } catch (error) {
      app.log.error(error, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

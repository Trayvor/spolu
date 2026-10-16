import { ConfigError, loadConfig } from './infra/config/config.js';
import { createDeps } from './deps.js';
import { runMigrations } from './infra/db/migrate.js';
import { buildApp } from './app.js';
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
  const app = await buildApp(deps);
  if (config.webDistDir) await registerStatic(app, config.webDistDir);
  await app.listen({ host: '0.0.0.0', port: config.port });

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

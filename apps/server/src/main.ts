import { ConfigError, loadConfig } from './infra/config/config.js';
import { createDb } from './infra/db/client.js';
import { runMigrations } from './infra/db/migrate.js';
import { startJobs } from './infra/jobs/jobs.js';
import { attachSocket } from './infra/realtime/socket.js';
import { buildApp } from './app.js';
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
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const boss = await startJobs(config.databaseUrl);
  const app = await buildApp({ config, db });
  if (config.webDistDir) await registerStatic(app, config.webDistDir);
  const io = attachSocket(app, config);
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
      await io.close(); // also closes the HTTP server
      await app.close();
      await boss.stop();
      await closeDb();
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

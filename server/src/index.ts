import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? 'musichere.db';

const db = openDb(dbPath);
const app = await buildApp({
  db,
  adminKey: process.env.ADMIN_KEY || null,
  logger: true,
});

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

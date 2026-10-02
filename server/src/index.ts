import { buildApp } from './app.ts';
import { llmFromEnv } from './ai/llm.ts';
import { openDb } from './db.ts';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = process.env.DB_PATH ?? 'musichere.db';

const db = openDb(dbPath);
const app = await buildApp({
  db,
  adminKey: process.env.ADMIN_KEY || null,
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  webDir: process.env.WEB_DIR || undefined,
  llm: llmFromEnv(),
  tz: process.env.APP_TZ || 'Asia/Shanghai',
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

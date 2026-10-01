import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError, type Deps } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { privateRoutes } from './routes/private.ts';
import { publicRoutes } from './routes/public.ts';
import { MAX_IMAGE_BYTES } from './services/images.ts';

export type AppOptions = Partial<Omit<Deps, 'db'>> & Pick<Deps, 'db'> & { logger?: boolean };

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const deps: Deps = {
    db: options.db,
    now: options.now ?? (() => new Date()),
    rng: options.rng ?? Math.random,
    adminKey: options.adminKey ?? null,
    uploadDir: options.uploadDir ?? 'uploads',
  };

  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 } });
  await app.register(cors, { origin: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: (err as Error).message });
    }
    app.log.error(err);
    return reply.code(500).send({ error: 'internal', message: '服务器开小差了' });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'Not Found' }),
  );

  await app.register(publicRoutes(deps), { prefix: '/api' });
  await app.register(privateRoutes(deps), { prefix: '/api' });
  await app.register(adminRoutes(deps), { prefix: '/api' });
  return app;
}

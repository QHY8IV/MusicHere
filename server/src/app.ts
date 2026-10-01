import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { HttpError, type Deps } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { privateRoutes } from './routes/private.ts';
import { publicRoutes } from './routes/public.ts';
import { MAX_IMAGE_BYTES } from './services/images.ts';

export type AppOptions = Partial<Omit<Deps, 'db'>> &
  Pick<Deps, 'db'> & {
    logger?: boolean;
    /** 设置后由本服务直接托管 web 版（expo export 的产物），非 /api 的未知路径回退到 index.html */
    webDir?: string | undefined;
  };

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
  const webDir = options.webDir;
  if (webDir) {
    if (!existsSync(join(webDir, 'index.html'))) {
      throw new Error(`WEB_DIR 里没有 index.html：${webDir}`);
    }
    await app.register(fastifyStatic, {
      root: webDir,
      index: ['index.html'],
      // 构建产物的文件名带内容哈希，可以长期缓存；index.html 必须每次校验
      setHeaders: (res, path) => {
        res.header(
          'cache-control',
          path.includes('/_expo/static/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    // 前端是单页应用：深链接（如 /place/xxx）刷新时回退到 index.html；API 和静态文件缺失仍是 404 JSON
    const isPage = req.method === 'GET' && !req.url.startsWith('/api/') && !/\.[a-z0-9]+(\?|$)/i.test(req.url);
    if (webDir && isPage) return reply.header('cache-control', 'no-cache').type('text/html').sendFile('index.html');
    return reply.code(404).send({ error: 'not_found', message: 'Not Found' });
  });

  await app.register(publicRoutes(deps), { prefix: '/api' });
  await app.register(privateRoutes(deps), { prefix: '/api' });
  await app.register(adminRoutes(deps), { prefix: '/api' });
  return app;
}

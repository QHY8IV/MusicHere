import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, parse, type Deps } from '../http.ts';
import { readImage } from '../services/images.ts';
import { createGuest } from '../services/users.ts';
import { nickname } from './schemas.ts';

export function publicRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.get('/health', async () => ({ ok: true }));

    // 地点图片：文件名是随机 UUID，不可枚举；<img> 标签不能带 token，所以这里不鉴权。
    // 注意：挂在 /api 前缀下，路径为 /api/uploads/<文件名>
    app.get('/uploads/:name', async (req, reply) => {
      const { name } = parse(z.object({ name: z.string().max(80) }), req.params);
      const img = readImage(deps.uploadDir, name);
      if (!img) throw notFound('图片');
      return reply
        .header('content-type', img.mime)
        .header('cache-control', 'public, max-age=31536000, immutable')
        .header('x-content-type-options', 'nosniff')
        .header('cross-origin-resource-policy', 'cross-origin')
        .send(img.data);
    });

    app.post('/auth/guest', async (req, reply) => {
      const body = parse(z.object({ nickname }), req.body);
      reply.code(201);
      return createGuest(deps, body.nickname);
    });
  };
}

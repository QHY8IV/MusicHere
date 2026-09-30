import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parse, type Deps } from '../http.ts';
import { createGuest } from '../services/users.ts';
import { nickname } from './schemas.ts';

export function publicRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.get('/health', async () => ({ ok: true }));

    app.post('/auth/guest', async (req, reply) => {
      const body = parse(z.object({ nickname }), req.body);
      reply.code(201);
      return createGuest(deps, body.nickname);
    });
  };
}

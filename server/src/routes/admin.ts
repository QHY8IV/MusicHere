import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction } from '../db.ts';
import { HttpError, parse, type Deps } from '../http.ts';
import { createPlace } from '../services/places.ts';
import { addPlaceSong } from '../services/placeSongs.ts';
import { placeInput, placeSongInput } from './schemas.ts';

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

const importBody = z.object({
  records: z
    .array(z.object({ place: placeInput, songs: z.array(placeSongInput).min(1).max(200) }))
    .min(1)
    .max(200),
});

/**
 * 官方记录导入：用于演出场地、景区、商圈等有权威来源的数据（节目单、驻场乐队、广播歌单……）。
 * 通过环境变量 ADMIN_KEY 保护；未配置时该接口直接 404。
 * 官方记录的 source 为 official，没有提交者，也不会产生点赞。
 */
export function adminRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.addHook('onRequest', async (req) => {
      const key = req.headers['x-admin-key'];
      if (!deps.adminKey) throw new HttpError(404, 'not_found', 'Not Found');
      if (typeof key !== 'string' || !safeEqual(key, deps.adminKey)) {
        throw new HttpError(401, 'unauthorized', '管理密钥无效');
      }
    });

    app.post('/admin/import', async (req, reply) => {
      const body = parse(importBody, req.body);
      const summary = transaction(deps.db, () => {
        let places = 0;
        let songs = 0;
        for (const rec of body.records) {
          const { place, created } = createPlace(deps, null, rec.place);
          if (created) places++;
          for (const s of rec.songs) {
            if (addPlaceSong(deps, null, place.id, s).created) songs++;
          }
        }
        return { placesCreated: places, songsCreated: songs };
      });
      reply.code(201);
      return summary;
    });
  };
}

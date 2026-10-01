import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { HttpError, parse, requireUser, type Deps } from '../http.ts';
import { userByToken, getUser, renameUser, userStats } from '../services/users.ts';
import {
  checkIn,
  createPlace,
  getPlace,
  setPlaceImage,
  myCheckins,
  placesNear,
  visitorCount,
} from '../services/places.ts';
import {
  addListen,
  addPlaceSong,
  deletePlaceSong,
  listPlaceSongs,
  mySongs,
  setVote,
} from '../services/placeSongs.ts';
import {
  addComment,
  deleteComment,
  listComments,
  setCommentLike,
} from '../services/comments.ts';
import { discover } from '../services/discover.ts';
import { removeUploaded, saveImage } from '../services/images.ts';
import { KINDS } from '../services/placeSongs.ts';
import {
  commentInput,
  idParam,
  lat,
  lng,
  nickname,
  placeInput,
  placeSongInput,
  positive,
} from './schemas.ts';

export function privateRoutes(deps: Deps) {
  return async (app: FastifyInstance) => {
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (req) => {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const user = token ? userByToken(deps, token) : null;
      if (!user) throw new HttpError(401, 'unauthorized', '请先登录');
      req.user = user;
    });

    // ---- 我 ----
    app.get('/me', async (req) => {
      const user = requireUser(req);
      return { user: getUser(deps, user.id), stats: userStats(deps, user.id) };
    });

    app.patch('/me', async (req) => {
      const user = requireUser(req);
      const body = parse(z.object({ nickname }), req.body);
      return { user: renameUser(deps, user.id, body.nickname) };
    });

    app.get('/me/checkins', async (req) => {
      const user = requireUser(req);
      const q = parse(z.object({ limit: positive(30, 100) }), req.query);
      return { checkins: myCheckins(deps, user.id, q.limit) };
    });

    app.get('/me/songs', async (req) => {
      const user = requireUser(req);
      const q = parse(z.object({ limit: positive(30, 100) }), req.query);
      return { songs: mySongs(deps, user.id, q.limit) };
    });

    // ---- 发现：按定位随机推荐 ----
    app.get('/discover', async (req) => {
      const user = requireUser(req);
      const q = parse(
        z.object({
          lat,
          lng,
          radius: positive(300, 2000),
          limit: positive(5, 20),
        }),
        req.query,
      );
      return discover(deps, user.id, q.lat, q.lng, { radiusM: q.radius, limit: q.limit });
    });

    // ---- 地点 ----
    app.get('/places/nearby', async (req) => {
      const user = requireUser(req);
      const q = parse(
        z.object({ lat, lng, radius: positive(1000, 5000), limit: positive(30, 100) }),
        req.query,
      );
      return { places: placesNear(deps, q.lat, q.lng, q.radius, q.limit, user.id) };
    });

    app.post('/places', async (req, reply) => {
      const user = requireUser(req);
      // 外链封面只允许官方导入指定；普通用户通过上传接口设置封面
      const body = parse(placeInput.omit({ imageUrl: true }), req.body);
      const result = createPlace(deps, user.id, body);
      reply.code(result.created ? 201 : 200);
      return result;
    });

    app.get('/places/:id', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const q = parse(z.object({ lat: lat.optional(), lng: lng.optional() }), req.query);
      return { place: getPlace(deps, id, { userId: user.id, ...q }) };
    });

    // ---- 地点封面：multipart/form-data，字段名任意，只收一个图片文件 ----
    app.post('/places/:id/image', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      getPlace(deps, id, { userId: user.id }); // 404 if missing
      if (!req.isMultipart()) throw new HttpError(400, 'validation', '请以 multipart/form-data 上传图片');
      const file = await req.file();
      if (!file) throw new HttpError(400, 'validation', '请选择一张图片');
      const buf = await file.toBuffer();
      if (file.file.truncated) throw new HttpError(413, 'too_large', '图片不能超过 5MB');
      const path = saveImage(deps.uploadDir, buf);
      try {
        const { place, previous } = setPlaceImage(deps, user.id, id, path);
        removeUploaded(deps.uploadDir, previous);
        return { place };
      } catch (err) {
        removeUploaded(deps.uploadDir, path); // 没有权限等情况：别留下孤儿文件
        throw err;
      }
    });

    // ---- 打卡：成功后直接带回三类歌曲 ----
    app.post('/places/:id/checkin', async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const body = parse(
        z.object({ lat, lng, note: z.string().trim().max(200).optional() }),
        req.body,
      );
      const result = checkIn(deps, user.id, id, body.lat, body.lng, body.note || undefined);
      reply.code(result.repeat ? 200 : 201);
      const songs = Object.fromEntries(
        KINDS.map((kind) => [kind, listPlaceSongs(deps, { placeId: id, kind, userId: user.id, limit: 10 })]),
      );
      return {
        ...result,
        place: getPlace(deps, id, { userId: user.id, lat: body.lat, lng: body.lng }),
        visitorCount: visitorCount(deps, id),
        songs,
      };
    });

    // ---- 地点的歌曲 ----
    app.get('/places/:id/songs', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const q = parse(z.object({ kind: z.enum(KINDS).optional(), limit: positive(100, 200) }), req.query);
      getPlace(deps, id, { userId: user.id }); // 404 if missing
      return { songs: listPlaceSongs(deps, { placeId: id, kind: q.kind, userId: user.id, limit: q.limit }) };
    });

    app.post('/places/:id/songs', async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const body = parse(placeSongInput, req.body);
      const result = addPlaceSong(deps, user.id, id, body);
      reply.code(result.created ? 201 : 200);
      return result;
    });

    app.put('/place-songs/:id/vote', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const { value } = parse(
        z.object({ value: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }),
        req.body,
      );
      return { placeSong: setVote(deps, user.id, id, value) };
    });

    app.post('/place-songs/:id/listen', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      return { placeSong: addListen(deps, user.id, id) };
    });

    app.delete('/place-songs/:id', async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      deletePlaceSong(deps, user.id, id);
      reply.code(204);
    });

    // ---- 评论 ----
    app.get('/places/:id/comments', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const q = parse(
        z.object({ limit: positive(30, 100), before: z.string().datetime().optional() }),
        req.query,
      );
      getPlace(deps, id, { userId: user.id }); // 404 if missing
      const comments = listComments(deps, id, user.id, q);
      return { comments, nextBefore: comments.length === q.limit ? comments.at(-1)!.createdAt : null };
    });

    app.post('/places/:id/comments', async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      const body = parse(commentInput, req.body);
      reply.code(201);
      return { comment: addComment(deps, user.id, id, body) };
    });

    app.put('/comments/:id/like', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      return { comment: setCommentLike(deps, user.id, id, true) };
    });

    app.delete('/comments/:id/like', async (req) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      return { comment: setCommentLike(deps, user.id, id, false) };
    });

    app.delete('/comments/:id', async (req, reply) => {
      const user = requireUser(req);
      const { id } = parse(idParam, req.params);
      deleteComment(deps, user.id, id);
      reply.code(204);
    });
  };
}

import { randomUUID } from 'node:crypto';
import { haversineM } from '../geo.ts';
import { HttpError, row, rows, type Deps } from '../http.ts';
import { checkinAllowanceM, getPlaceRow } from './places.ts';

/**
 * 声音漂流瓶：把一首歌和一句话留给「下一个经过这里的陌生人」。
 *
 * - 只有人在现场才能投放（与打卡同样的距离校验）；
 * - 只有人在现场打卡时才会捡到——位置是唯一的钥匙；
 * - 每个瓶子只会被一个人捡到；投放者能看到它何时被谁捡起。
 */

interface BottleRow {
  id: string;
  place_id: string;
  user_id: string;
  title: string;
  artist: string;
  url: string | null;
  message: string;
  created_at: string;
  picked_by: string | null;
  picked_at: string | null;
  place_name: string;
  from_nickname: string;
  picker_nickname: string | null;
}

export interface BottleDto {
  id: string;
  placeId: string;
  placeName: string;
  song: { title: string; artist: string; url: string | null };
  message: string;
  from: { id: string; nickname: string };
  createdAt: string;
  picked: { by: { id: string; nickname: string }; at: string } | null;
}

const SELECT = `
  SELECT b.*, p.name AS place_name, u.nickname AS from_nickname, pu.nickname AS picker_nickname
  FROM bottles b
  JOIN places p ON p.id = b.place_id
  JOIN users u ON u.id = b.user_id
  LEFT JOIN users pu ON pu.id = b.picked_by`;

const toDto = (r: BottleRow): BottleDto => ({
  id: r.id,
  placeId: r.place_id,
  placeName: r.place_name,
  song: { title: r.title, artist: r.artist, url: r.url },
  message: r.message,
  from: { id: r.user_id, nickname: r.from_nickname },
  createdAt: r.created_at,
  picked: r.picked_by && r.picked_at ? { by: { id: r.picked_by, nickname: r.picker_nickname ?? '某人' }, at: r.picked_at } : null,
});

function getBottle(deps: Deps, id: string): BottleDto {
  return toDto(row<BottleRow>(deps.db.prepare(`${SELECT} WHERE b.id = ?`).get(id))!);
}

export interface ThrowInput {
  lat: number;
  lng: number;
  title: string;
  artist: string;
  url?: string | undefined;
  message: string;
}

export function throwBottle(deps: Deps, userId: string, placeId: string, input: ThrowInput): BottleDto {
  const place = getPlaceRow(deps, placeId);
  const distanceM = haversineM(input.lat, input.lng, place.lat, place.lng);
  const allowed = checkinAllowanceM(place.radius_m);
  if (distanceM > allowed) {
    throw new HttpError(403, 'too_far', '要在现场才能投放漂流瓶', { distanceM: Math.round(distanceM), allowedM: allowed });
  }
  const pending = row(
    deps.db
      .prepare('SELECT 1 AS x FROM bottles WHERE user_id = ? AND place_id = ? AND picked_by IS NULL')
      .get(userId, placeId),
  );
  if (pending) {
    throw new HttpError(409, 'bottle_pending', '你在这里的上一个漂流瓶还没被人捡到，等它被捡起后再投吧');
  }
  const id = randomUUID();
  deps.db
    .prepare(
      `INSERT INTO bottles (id, place_id, user_id, title, artist, url, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, placeId, userId, input.title.trim(), input.artist.trim(), input.url ?? null, input.message.trim(), deps.now().toISOString());
  return getBottle(deps, id);
}

/** 打卡时调用：捡起这里最早的一个别人留下、还没被捡走的瓶子。 */
export function pickBottle(deps: Deps, userId: string, placeId: string): BottleDto | null {
  const r = row<{ id: string }>(
    deps.db
      .prepare(
        `SELECT id FROM bottles WHERE place_id = ? AND user_id != ? AND picked_by IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(placeId, userId),
  );
  if (!r) return null;
  const res = deps.db
    .prepare('UPDATE bottles SET picked_by = ?, picked_at = ? WHERE id = ? AND picked_by IS NULL')
    .run(userId, deps.now().toISOString(), r.id);
  return res.changes ? getBottle(deps, r.id) : null;
}

/** 这里还有几个等待被捡起的瓶子（不含自己投的）。 */
export function waitingBottles(deps: Deps, placeId: string, userId: string): number {
  return (
    row<{ n: number }>(
      deps.db
        .prepare('SELECT COUNT(*) AS n FROM bottles WHERE place_id = ? AND user_id != ? AND picked_by IS NULL')
        .get(placeId, userId),
    )?.n ?? 0
  );
}

export function myBottles(deps: Deps, userId: string): { thrown: BottleDto[]; picked: BottleDto[] } {
  return {
    thrown: rows<BottleRow>(deps.db.prepare(`${SELECT} WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 50`).all(userId)).map(toDto),
    picked: rows<BottleRow>(deps.db.prepare(`${SELECT} WHERE b.picked_by = ? ORDER BY b.picked_at DESC LIMIT 50`).all(userId)).map(toDto),
  };
}

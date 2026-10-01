import { z } from 'zod';
import { CATEGORIES } from '../services/places.ts';
import { EVENT_TYPES, KINDS } from '../services/placeSongs.ts';

export const lat = z.coerce.number().min(-90).max(90);
export const lng = z.coerce.number().min(-180).max(180);

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const nickname = text(20);

/** 只允许 http(s) 链接，避免存入 javascript: 之类的 URL 后被客户端直接打开。 */
const httpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, '必须是 http(s) 链接');

export const placeInput = z.object({
  name: text(60),
  lat,
  lng,
  description: optionalText(300),
  category: z.enum(CATEGORIES).optional(),
  radiusM: z.number().int().min(30).max(1000).optional(),
  imageUrl: httpUrl.optional(),
});

export const placeSongInput = z.object({
  title: text(120),
  artist: text(120),
  url: httpUrl.optional().or(z.literal('').transform(() => undefined)),
  kind: z.enum(KINDS),
  note: optionalText(300),
  eventType: z.enum(EVENT_TYPES).optional(),
  performer: optionalText(80),
  eventTitle: optionalText(120),
  eventAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD')
    .refine((v) => !Number.isNaN(Date.parse(v)), '日期无效')
    .optional(),
});

export const commentInput = z.object({
  body: text(500),
  mood: optionalText(20),
  placeSongId: z.string().uuid().optional(),
});

export const idParam = z.object({ id: z.string().uuid() });

export const positive = (def: number, max: number) =>
  z.coerce.number().int().min(1).max(max).default(def);

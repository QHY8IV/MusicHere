import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from './db.ts';

export interface User {
  id: string;
  nickname: string;
}

/** 注入到各个 service 里的依赖；时钟和随机源可替换，方便测试。 */
export interface Deps {
  db: Db;
  now: () => Date;
  rng: () => number;
  /** 官方记录导入接口的密钥；为 null 时该接口整体关闭。 */
  adminKey: string | null;
  /** 用户上传的地点图片存放目录 */
  uploadDir: string;
}

export class HttpError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what}不存在`);

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'unauthorized', '请先登录');
  return req.user;
}

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'validation', '参数不合法', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

/** 便于把 SQLite 取出的行当作具体类型使用。 */
export function rows<T>(value: unknown): T[] {
  return value as T[];
}
export function row<T>(value: unknown): T | undefined {
  return (value ?? undefined) as T | undefined;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

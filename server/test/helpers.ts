import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

/** 一个可手动拨动的时钟。 */
export class Clock {
  t: number;
  constructor(iso = '2026-06-01T12:00:00.000Z') {
    this.t = Date.parse(iso);
  }
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** 确定性伪随机数（mulberry32），用来稳定地测试加权抽样。 */
export function seededRng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 上海外滩附近的一个点
export const BUND = { lat: 31.2400, lng: 121.4900 };
/** 在 BUND 正北方约 n 米处（1° 纬度 ≈ 111,195 m） */
export const northOf = (p: { lat: number; lng: number }, meters: number) => ({
  lat: p.lat + meters / 111_195,
  lng: p.lng,
});

export interface TestEnv {
  app: FastifyInstance;
  clock: Clock;
  adminKey: string;
  close: () => Promise<void>;
  /** 带登录态的请求封装 */
  client: (token?: string) => Client;
  newUser: (nickname?: string) => Promise<{ id: string; token: string; nickname: string }>;
}

export interface Client {
  get: (url: string) => Promise<Res>;
  post: (url: string, body?: unknown) => Promise<Res>;
  put: (url: string, body?: unknown) => Promise<Res>;
  patch: (url: string, body?: unknown) => Promise<Res>;
  del: (url: string) => Promise<Res>;
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export async function setup(opts: { seed?: number; adminKey?: string | null } = {}): Promise<TestEnv> {
  const db = openDb(':memory:');
  const clock = new Clock();
  const adminKey = opts.adminKey === undefined ? 'test-admin-key' : opts.adminKey;
  const app = await buildApp({
    db,
    now: clock.now,
    rng: seededRng(opts.seed ?? 1),
    adminKey,
  });

  const client = (token?: string): Client => {
    const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
      const res = await app.inject({
        method: method as 'GET',
        url: `/api${url}`,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      const text = res.body;
      return { status: res.statusCode, body: text ? JSON.parse(text) : null };
    };
    return {
      get: (u) => call('GET', u),
      post: (u, b) => call('POST', u, b),
      put: (u, b) => call('PUT', u, b),
      patch: (u, b) => call('PATCH', u, b),
      del: (u) => call('DELETE', u),
    };
  };

  let n = 0;
  const newUser = async (nickname = `用户${++n}`) => {
    const res = await client().post('/auth/guest', { nickname });
    if (res.status !== 201) throw new Error(`guest failed: ${JSON.stringify(res.body)}`);
    return { id: res.body.user.id as string, token: res.body.token as string, nickname };
  };

  return {
    app,
    clock,
    adminKey: adminKey ?? '',
    client,
    newUser,
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

export async function createPlace(
  c: Client,
  name = '外滩观景台',
  at = BUND,
  extra: Record<string, unknown> = {},
) {
  const res = await c.post('/places', { name, ...at, ...extra });
  if (res.status !== 201 && res.status !== 200) throw new Error(JSON.stringify(res.body));
  return res.body.place as { id: string; [k: string]: unknown };
}

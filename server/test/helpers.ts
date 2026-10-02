import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { createLlm, type Llm } from '../src/ai/llm.ts';
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
  uploadDir: string;
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

export async function setup(
  opts: { seed?: number; adminKey?: string | null; llm?: Llm | null; tz?: string } = {},
): Promise<TestEnv> {
  const db = openDb(':memory:');
  const clock = new Clock();
  const uploadDir = mkdtempSync(join(tmpdir(), 'musichere-up-'));
  const adminKey = opts.adminKey === undefined ? 'test-admin-key' : opts.adminKey;
  const app = await buildApp({
    db,
    now: clock.now,
    rng: seededRng(opts.seed ?? 1),
    adminKey,
    uploadDir,
    llm: opts.llm ?? null,
    tz: opts.tz ?? 'Asia/Shanghai',
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
    uploadDir,
    client,
    newUser,
    close: async () => {
      await app.close();
      db.close();
      rmSync(uploadDir, { recursive: true, force: true });
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

/** 最小的合法图片字节：PNG 文件头 + 填充。只用于测试文件头判断，不要求能解码。 */
export const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

/** 手工拼一个 multipart/form-data 请求体。 */
export function multipartFile(field: string, filename: string, mime: string, data: Buffer) {
  const boundary = '----musichere' + Math.random().toString(16).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export interface FakeLlm {
  llm: Llm;
  /** 收到的请求体（已解析） */
  requests: { body: any; auth: string | undefined }[];
  /** 设置下一次（及之后）的回复：字符串作为 message.content；函数可按请求动态返回；'hang' 表示不回应 */
  reply: (r: string | ((body: any) => string) | { status: number } | 'hang') => void;
  close: () => Promise<void>;
}

/** 一个本地的 OpenAI 兼容假服务，用来测试大模型路径（成功、格式错误、超时、HTTP 错误）。 */
export async function startFakeLlm(timeoutMs = 1500): Promise<FakeLlm> {
  const requests: FakeLlm['requests'] = [];
  let next: Parameters<FakeLlm['reply']>[0] = '{}';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw || '{}');
      requests.push({ body, auth: req.headers.authorization });
      if (next === 'hang') return; // 永不回应，触发超时
      if (typeof next === 'object') {
        res.writeHead(next.status).end('{}');
        return;
      }
      const content = typeof next === 'function' ? next(body) : next;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    llm: createLlm({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test-key',
      model: 'text-model',
      visionModel: 'vision-model',
      label: '测试模型',
      timeoutMs,
    }),
    requests,
    reply: (r) => {
      next = r;
    },
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

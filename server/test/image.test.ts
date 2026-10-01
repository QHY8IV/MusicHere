import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BUND, createPlace, JPEG, multipartFile, PNG, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.close();
});

async function upload(token: string, placeId: string, data: Buffer, mime = 'image/png', name = 'a.png') {
  const { payload, headers } = multipartFile('file', name, mime, data);
  const res = await env.app.inject({
    method: 'POST',
    url: `/api/places/${placeId}/image`,
    headers: { authorization: `Bearer ${token}`, ...headers },
    payload,
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

describe('地点封面图片', () => {
  it('新地点没有图，创建者可以上传；之后能通过公开地址取回，且类型正确', async () => {
    const u = await env.newUser();
    const c = env.client(u.token);
    const place = await createPlace(c);
    assert.equal(place.imageUrl, null);
    assert.equal(place.canSetImage, true);

    const res = await upload(u.token, place.id, PNG);
    assert.equal(res.status, 200);
    assert.match(res.body.place.imageUrl, /^\/api\/uploads\/[0-9a-f-]{36}\.png$/);

    // 不带 token 也能取图（<Image> 无法带请求头）
    const img = await env.app.inject({ method: 'GET', url: res.body.place.imageUrl });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['x-content-type-options'], 'nosniff');
    assert.match(String(img.headers['cache-control']), /immutable/);
    assert.deepEqual(img.rawPayload, PNG);

    // 列表/详情里都带上了
    const near = await c.get(`/places/nearby?lat=${BUND.lat}&lng=${BUND.lng}`);
    assert.equal(near.body.places[0].imageUrl, res.body.place.imageUrl);
  });

  it('按文件头判断类型：声明 png 实际是 jpeg 就按 jpeg 保存；文本冒充图片被拒', async () => {
    const c = env.client((await env.newUser()).token);
    const u2 = await env.newUser();
    const place = await createPlace(env.client(u2.token));
    const ok = await upload(u2.token, place.id, JPEG, 'image/png', 'fake.png');
    assert.equal(ok.status, 200);
    assert.match(ok.body.place.imageUrl, /\.jpg$/);

    const place2 = await createPlace(c, '另一处', { lat: 10, lng: 10 });
    const bad = await upload((await env.newUser()).token, place2.id, Buffer.from('<script>alert(1)</script>'), 'image/png', 'x.png');
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'invalid_image');
    assert.deepEqual(readdirSync(env.uploadDir).length, 1, '被拒绝的上传不应落盘');
  });

  it('超过 5MB 被拒绝', async () => {
    const u = await env.newUser();
    const place = await createPlace(env.client(u.token));
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10, 3)]);
    const res = await upload(u.token, place.id, big);
    assert.equal(res.status, 413);
    assert.equal(readdirSync(env.uploadDir).length, 0);
  });

  it('权限：没有图时任何人可补；已有图时只有创建者能换，换后旧文件被回收', async () => {
    const owner = await env.newUser();
    const other = await env.newUser();
    const place = await createPlace(env.client(owner.token));

    // 别人先补了一张（地点还没有图）
    const first = await upload(other.token, place.id, PNG);
    assert.equal(first.status, 200);
    // 此时别人对这个地点：已有图，且自己不是创建者 → 不能再换
    const view = await env.client(other.token).get(`/places/${place.id}`);
    assert.equal(view.body.place.canSetImage, false);
    assert.equal((await upload(other.token, place.id, JPEG)).status, 403);
    assert.equal(readdirSync(env.uploadDir).length, 1, '被拒绝的上传不应留下孤儿文件');

    // 创建者可以换，旧文件删除
    const oldUrl = first.body.place.imageUrl as string;
    const second = await upload(owner.token, place.id, JPEG);
    assert.equal(second.status, 200);
    assert.notEqual(second.body.place.imageUrl, oldUrl);
    assert.equal(readdirSync(env.uploadDir).length, 1);
    assert.equal((await env.app.inject({ method: 'GET', url: oldUrl })).statusCode, 404);
  });

  it('其它错误：未登录 401、地点不存在 404、没带文件 400', async () => {
    const u = await env.newUser();
    const place = await createPlace(env.client(u.token));
    const { payload, headers } = multipartFile('file', 'a.png', 'image/png', PNG);
    const anon = await env.app.inject({ method: 'POST', url: `/api/places/${place.id}/image`, headers, payload });
    assert.equal(anon.statusCode, 401);
    assert.equal((await upload(u.token, '6f1b0e8e-0000-4000-8000-000000000000', PNG)).status, 404);
    const empty = await env.app.inject({
      method: 'POST',
      url: `/api/places/${place.id}/image`,
      headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' },
      payload: {},
    });
    assert.equal(empty.statusCode, 400);
  });

  it('图片读取：路径穿越、非法文件名、不存在都是 404', async () => {
    for (const url of [
      '/api/uploads/..%2F..%2Fetc%2Fpasswd',
      '/api/uploads/..%2Fmusichere.db',
      '/api/uploads/nothing.png',
      '/api/uploads/a.svg',
      '/api/uploads/x.html',
    ]) {
      const res = await env.app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 404, url);
    }
  });

  it('普通用户不能通过新建地点指定外链封面；官方导入可以', async () => {
    const c = env.client((await env.newUser()).token);
    const p = await c.post('/places', { name: '甲', ...BUND, imageUrl: 'https://evil.example/x.png' });
    assert.equal(p.body.place.imageUrl, null);

    const res = await env.app.inject({
      method: 'POST',
      url: '/api/admin/import',
      headers: { 'x-admin-key': env.adminKey },
      payload: {
        records: [
          {
            place: { name: '官方地点', lat: 20, lng: 20, imageUrl: 'https://img.example.com/a.jpg' },
            songs: [{ title: 'x', artist: 'y', kind: 'vibe' }],
          },
        ],
      },
    });
    assert.equal(res.statusCode, 201);
    const near = await c.get('/places/nearby?lat=20&lng=20');
    assert.equal(near.body.places[0].imageUrl, 'https://img.example.com/a.jpg');
    // 非 http(s) 的外链被拒
    const bad = await env.app.inject({
      method: 'POST',
      url: '/api/admin/import',
      headers: { 'x-admin-key': env.adminKey },
      payload: {
        records: [{ place: { name: 'z', lat: 1, lng: 1, imageUrl: 'javascript:alert(1)' }, songs: [{ title: 'x', artist: 'y', kind: 'vibe' }] }],
      },
    });
    assert.equal(bad.statusCode, 400);
    assert.ok(existsSync(env.uploadDir));
  });
});

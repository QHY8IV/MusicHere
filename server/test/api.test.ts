import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { BUND, createPlace, DAY, HOUR, northOf, setup, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.close();
});

const vibe = (title: string, artist = '歌手甲', extra: Record<string, unknown> = {}) => ({
  title,
  artist,
  kind: 'vibe',
  ...extra,
});

describe('认证', () => {
  it('未登录访问受保护接口 401；健康检查公开', async () => {
    assert.equal((await env.client().get('/me')).status, 401);
    assert.equal((await env.client('bogus').get('/me')).status, 401);
    assert.equal((await env.client().get('/health')).status, 200);
  });

  it('访客注册后可用 token 访问并改昵称', async () => {
    const u = await env.newUser('阿明');
    const c = env.client(u.token);
    const me = await c.get('/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.nickname, '阿明');
    const renamed = await c.patch('/me', { nickname: '小明' });
    assert.equal(renamed.body.user.nickname, '小明');
  });

  it('昵称校验', async () => {
    assert.equal((await env.client().post('/auth/guest', { nickname: '' })).status, 400);
    assert.equal((await env.client().post('/auth/guest', { nickname: 'x'.repeat(21) })).status, 400);
  });
});

describe('地点', () => {
  it('创建后能在附近列表里按距离排序找到', async () => {
    const c = env.client((await env.newUser()).token);
    const near = await createPlace(c, '近处', northOf(BUND, 50));
    const far = await createPlace(c, '稍远', northOf(BUND, 400));
    await createPlace(c, '很远', northOf(BUND, 3000));

    const res = await c.get(`/places/nearby?lat=${BUND.lat}&lng=${BUND.lng}&radius=1000`);
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.places.map((p: { id: string }) => p.id),
      [near.id, far.id],
    );
    assert.ok(res.body.places[0].distanceM < res.body.places[1].distanceM);
  });

  it('200 米内同名地点不会重复创建', async () => {
    const c = env.client((await env.newUser()).token);
    const a = await c.post('/places', { name: '外滩 观景台', ...BUND });
    const b = await c.post('/places', { name: ' 外滩  观景台 ', ...northOf(BUND, 80) });
    assert.equal(a.status, 201);
    assert.equal(b.status, 200);
    assert.equal(b.body.created, false);
    assert.equal(b.body.place.id, a.body.place.id);
    // 不同名字则新建
    assert.equal((await c.post('/places', { name: '另一个地方', ...BUND })).status, 201);
  });

  it('参数校验：经纬度越界、名字为空', async () => {
    const c = env.client((await env.newUser()).token);
    assert.equal((await c.post('/places', { name: 'x', lat: 91, lng: 0 })).status, 400);
    assert.equal((await c.post('/places', { name: '  ', lat: 1, lng: 1 })).status, 400);
    assert.equal((await c.get('/places/nearby?lat=abc&lng=1')).status, 400);
    assert.equal((await c.get('/places/not-a-uuid')).status, 400);
    assert.equal((await c.get('/places/6f1b0e8e-0000-4000-8000-000000000000')).status, 404);
  });
});

describe('上传歌曲：应景 / 常听 / 现场', () => {
  it('应景：创建后提交者自动点 1 赞，出现在地点列表', async () => {
    const u = await env.newUser('甲');
    const c = env.client(u.token);
    const place = await createPlace(c);
    const res = await c.post(`/places/${place.id}/songs`, vibe('晴天', '周杰伦', { note: '傍晚江边风很舒服' }));
    assert.equal(res.status, 201);
    const ps = res.body.placeSong;
    assert.equal(ps.kind, 'vibe');
    assert.equal(ps.source, 'user');
    assert.equal(ps.likes, 1);
    assert.equal(ps.myVote, 1);
    assert.equal(ps.submittedBy.nickname, '甲');
    assert.equal(ps.live, null);

    const list = await c.get(`/places/${place.id}/songs?kind=vibe`);
    assert.equal(list.body.songs.length, 1);
    assert.equal(list.body.songs[0].song.title, '晴天');
  });

  it('重复上传同一首同一种关系：不新增，记为「我也觉得」一次点赞', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const first = await a.post(`/places/${place.id}/songs`, vibe('晴天', '周杰伦'));
    const second = await b.post(`/places/${place.id}/songs`, vibe('  晴天 ', '周杰伦'));
    assert.equal(second.status, 200);
    assert.equal(second.body.created, false);
    assert.equal(second.body.placeSong.id, first.body.placeSong.id);
    assert.equal(second.body.placeSong.likes, 2);
    assert.equal((await a.get(`/places/${place.id}/songs`)).body.songs.length, 1);
  });

  it('同一首歌可以同时是应景和常听（两条记录共用一首 song）', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const v = await c.post(`/places/${place.id}/songs`, vibe('晴天', '周杰伦'));
    const f = await c.post(`/places/${place.id}/songs`, { ...vibe('晴天', '周杰伦'), kind: 'frequent' });
    assert.equal(v.body.placeSong.song.id, f.body.placeSong.song.id);
    assert.notEqual(v.body.placeSong.id, f.body.placeSong.id);
    assert.equal(f.body.placeSong.listeners, 1, '常听自动记一次在听');
  });

  it('外部链接：只接受 http(s)', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const ok = await c.post(`/places/${place.id}/songs`, vibe('A', 'x', { url: 'https://music.163.com/song?id=1' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.body.placeSong.song.url, 'https://music.163.com/song?id=1');
    for (const url of ['javascript:alert(1)', 'not a url', 'ftp://x.com/a']) {
      const bad = await c.post(`/places/${place.id}/songs`, vibe('B', 'x', { url }));
      assert.equal(bad.status, 400, url);
    }
    // 空字符串视为没填
    assert.equal((await c.post(`/places/${place.id}/songs`, vibe('C', 'x', { url: '' }))).status, 201);
  });

  it('现场：必须选演出类型；同一首歌不同演出者/日期各算一场', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const live = (over: Record<string, unknown>) => ({
      title: '海阔天空',
      artist: 'Beyond',
      kind: 'live',
      ...over,
    });
    assert.equal((await c.post(`/places/${place.id}/songs`, live({}))).status, 400);

    const a = await c.post(`/places/${place.id}/songs`, live({ eventType: 'busker', performer: '街头吉他手', eventAt: '2026-05-20' }));
    assert.equal(a.status, 201);
    assert.equal(a.body.placeSong.live.performer, '街头吉他手');
    assert.equal(a.body.placeSong.live.eventAt, '2026-05-20');

    const b = await c.post(`/places/${place.id}/songs`, live({ eventType: 'busker', performer: '街头吉他手', eventAt: '2026-05-21' }));
    const again = await c.post(`/places/${place.id}/songs`, live({ eventType: 'busker', performer: '街头吉他手', eventAt: '2026-05-20' }));
    assert.equal(b.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.placeSong.id, a.body.placeSong.id);
    assert.equal((await c.get(`/places/${place.id}/songs?kind=live`)).body.songs.length, 2);

    assert.equal((await c.post(`/places/${place.id}/songs`, live({ eventType: 'concert', eventAt: '2026/05/20' }))).status, 400);
    assert.equal((await c.post(`/places/${place.id}/songs`, live({ eventType: 'party' }))).status, 400);
  });

  it('非现场记录忽略演出字段', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const res = await c.post(`/places/${place.id}/songs`, vibe('A', 'x', { eventType: 'concert', performer: 'p' }));
    assert.equal(res.body.placeSong.live, null);
  });

  it('只能删除自己上传的记录', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const { placeSong } = (await a.post(`/places/${place.id}/songs`, vibe('A'))).body;
    assert.equal((await b.del(`/place-songs/${placeSong.id}`)).status, 403);
    assert.equal((await a.del(`/place-songs/${placeSong.id}`)).status, 204);
    assert.equal((await a.get(`/places/${place.id}/songs`)).body.songs.length, 0);
    assert.equal((await a.del(`/place-songs/${placeSong.id}`)).status, 404);
  });

  it('对不存在的地点上传 404', async () => {
    const c = env.client((await env.newUser()).token);
    assert.equal((await c.post('/places/6f1b0e8e-0000-4000-8000-000000000000/songs', vibe('A'))).status, 404);
  });
});

describe('点赞 / 点踩 / 在听 改变推荐权重', () => {
  it('点赞把歌顶到前面；点踩压下去；取消恢复', async () => {
    const owner = env.client((await env.newUser()).token);
    const fans = await Promise.all([env.newUser(), env.newUser(), env.newUser()]);
    const place = await createPlace(owner);
    const a = (await owner.post(`/places/${place.id}/songs`, vibe('A'))).body.placeSong;
    env.clock.advance(1000);
    const b = (await owner.post(`/places/${place.id}/songs`, vibe('B'))).body.placeSong;

    const order = async () =>
      (await owner.get(`/places/${place.id}/songs`)).body.songs.map((s: { song: { title: string } }) => s.song.title);
    // 票数相同时新的在前
    assert.deepEqual(await order(), ['B', 'A']);

    for (const f of fans) {
      const r = await env.client(f.token).put(`/place-songs/${a.id}/vote`, { value: 1 });
      assert.equal(r.status, 200);
    }
    assert.deepEqual(await order(), ['A', 'B']);
    const aNow = (await owner.get(`/places/${place.id}/songs`)).body.songs[0];
    assert.equal(aNow.likes, 4);
    assert.ok(aNow.weight > a.weight);

    // 三个人改成点踩：A 反而被压到后面
    for (const f of fans) await env.client(f.token).put(`/place-songs/${a.id}/vote`, { value: -1 });
    assert.deepEqual(await order(), ['B', 'A']);
    const aDown = (await owner.get(`/places/${place.id}/songs`)).body.songs[1];
    assert.equal(aDown.likes, 1);
    assert.equal(aDown.dislikes, 3);

    // 取消点踩
    for (const f of fans) await env.client(f.token).put(`/place-songs/${a.id}/vote`, { value: 0 });
    assert.equal((await owner.get(`/places/${place.id}/songs`)).body.songs.find((s: { id: string }) => s.id === a.id).dislikes, 0);
    void b;
  });

  it('同一用户只有一票，改票是覆盖而不是叠加', async () => {
    const c = env.client((await env.newUser()).token);
    const other = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const ps = (await c.post(`/places/${place.id}/songs`, vibe('A'))).body.placeSong;
    await other.put(`/place-songs/${ps.id}/vote`, { value: 1 });
    await other.put(`/place-songs/${ps.id}/vote`, { value: 1 });
    const r = await other.put(`/place-songs/${ps.id}/vote`, { value: -1 });
    assert.equal(r.body.placeSong.likes, 1);
    assert.equal(r.body.placeSong.dislikes, 1);
    assert.equal(r.body.placeSong.myVote, -1);
    assert.equal((await other.put(`/place-songs/${ps.id}/vote`, { value: 2 })).status, 400);
  });

  it('「我也在听」：同一天幂等，不同人累加，30 天后过期', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const ps = (await a.post(`/places/${place.id}/songs`, { ...vibe('A'), kind: 'frequent' })).body.placeSong;
    assert.equal(ps.listeners, 1);

    assert.equal((await a.post(`/place-songs/${ps.id}/listen`)).body.placeSong.listeners, 1);
    const afterB = (await b.post(`/place-songs/${ps.id}/listen`)).body.placeSong;
    assert.equal(afterB.listeners, 2);
    assert.equal(afterB.listenedToday, true);
    const weightWith = afterB.weight;

    env.clock.advance(31 * DAY);
    const later = (await b.get(`/places/${place.id}/songs`)).body.songs[0];
    assert.equal(later.listeners, 0, '窗口外的不再计入');
    assert.equal(later.listenedToday, false);
    assert.ok(later.weight < weightWith);

    // 次日同一人可以再记一次
    assert.equal((await b.post(`/place-songs/${ps.id}/listen`)).body.placeSong.listeners, 1);
  });
});

describe('打卡', () => {
  it('距离太远被拒绝，并返回距离信息', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const far = northOf(BUND, 1000);
    const res = await c.post(`/places/${place.id}/checkin`, far);
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'too_far');
    assert.ok(Math.abs(res.body.distanceM - 1000) < 5);
    assert.equal(res.body.allowedM, 200);
  });

  it('在范围内打卡成功，并带回三类歌曲', async () => {
    const owner = env.client((await env.newUser()).token);
    const visitor = env.client((await env.newUser('路人')).token);
    const place = await createPlace(owner);
    await owner.post(`/places/${place.id}/songs`, vibe('应景歌'));
    await owner.post(`/places/${place.id}/songs`, { ...vibe('常听歌'), kind: 'frequent' });
    await owner.post(`/places/${place.id}/songs`, {
      ...vibe('现场歌'),
      kind: 'live',
      eventType: 'concert',
      performer: '某乐队',
      eventAt: '2026-05-01',
    });
    await env.app.inject({ method: 'GET', url: '/api/health' });

    const res = await visitor.post(`/places/${place.id}/checkin`, { ...northOf(BUND, 60), note: '第一次来' });
    assert.equal(res.status, 201);
    assert.equal(res.body.firstVisit, true);
    assert.equal(res.body.repeat, false);
    assert.equal(res.body.checkin.note, '第一次来');
    assert.equal(res.body.visitorCount, 1);
    assert.equal(res.body.songs.vibe[0].song.title, '应景歌');
    assert.equal(res.body.songs.frequent[0].song.title, '常听歌');
    assert.equal(res.body.songs.live[0].song.title, '现场歌');
    assert.equal(res.body.songs.live[0].live.performer, '某乐队');
    assert.equal(res.body.place.visitorCount, 1);
  });

  it('6 小时内重复打卡只算一次；之后再打卡算新的一次且不是首次', async () => {
    const c = env.client((await env.newUser()).token);
    const place = await createPlace(c);
    const first = await c.post(`/places/${place.id}/checkin`, BUND);
    env.clock.advance(2 * HOUR);
    const again = await c.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(again.status, 200);
    assert.equal(again.body.repeat, true);
    assert.equal(again.body.checkin.id, first.body.checkin.id);

    env.clock.advance(5 * HOUR);
    const later = await c.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(later.status, 201);
    assert.equal(later.body.firstVisit, false);
    assert.notEqual(later.body.checkin.id, first.body.checkin.id);
    assert.equal(later.body.visitorCount, 1, '按人去重');

    const mine = await c.get('/me/checkins');
    assert.equal(mine.body.checkins.length, 2);
    assert.equal(mine.body.checkins[0].placeName, '外滩观景台');
    const me = await c.get('/me');
    assert.equal(me.body.stats.checkins, 2);
    assert.equal(me.body.stats.places, 1);
  });

  it('打卡的地点不存在 404；缺坐标 400', async () => {
    const c = env.client((await env.newUser()).token);
    assert.equal((await c.post('/places/6f1b0e8e-0000-4000-8000-000000000000/checkin', BUND)).status, 404);
    const place = await createPlace(c);
    assert.equal((await c.post(`/places/${place.id}/checkin`, {})).status, 400);
  });
});

describe('评论', () => {
  it('发表、按时间倒序、分页', async () => {
    const a = env.client((await env.newUser('甲')).token);
    const place = await createPlace(a);
    for (const body of ['第一条', '第二条', '第三条']) {
      const r = await a.post(`/places/${place.id}/comments`, { body, mood: '惬意' });
      assert.equal(r.status, 201);
      assert.equal(r.body.comment.author.nickname, '甲');
      env.clock.advance(1000);
    }
    const page1 = await a.get(`/places/${place.id}/comments?limit=2`);
    assert.deepEqual(page1.body.comments.map((c: { body: string }) => c.body), ['第三条', '第二条']);
    assert.ok(page1.body.nextBefore);
    const page2 = await a.get(`/places/${place.id}/comments?limit=2&before=${encodeURIComponent(page1.body.nextBefore)}`);
    assert.deepEqual(page2.body.comments.map((c: { body: string }) => c.body), ['第一条']);
    assert.equal(page2.body.nextBefore, null);
    assert.equal((await a.get(`/places/${place.id}`)).body.place.commentCount, 3);
  });

  it('校验：不能为空、不能过长；可关联本地点的歌但不能关联别处的', async () => {
    const a = env.client((await env.newUser()).token);
    const p1 = await createPlace(a, '地点一');
    const p2 = await createPlace(a, '地点二', northOf(BUND, 2000));
    const song1 = (await a.post(`/places/${p1.id}/songs`, vibe('A'))).body.placeSong;
    assert.equal((await a.post(`/places/${p1.id}/comments`, { body: '   ' })).status, 400);
    assert.equal((await a.post(`/places/${p1.id}/comments`, { body: 'x'.repeat(501) })).status, 400);

    const ok = await a.post(`/places/${p1.id}/comments`, { body: '这首太应景了', placeSongId: song1.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.comment.song.title, 'A');
    const bad = await a.post(`/places/${p2.id}/comments`, { body: '串了', placeSongId: song1.id });
    assert.equal(bad.status, 400);
  });

  it('评论点赞 / 取消，只能删自己的', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const c = (await a.post(`/places/${place.id}/comments`, { body: '好地方' })).body.comment;

    const liked = await b.put(`/comments/${c.id}/like`);
    assert.equal(liked.body.comment.likes, 1);
    assert.equal(liked.body.comment.likedByMe, true);
    // 幂等
    assert.equal((await b.put(`/comments/${c.id}/like`)).body.comment.likes, 1);
    // 对作者视角没有 likedByMe
    assert.equal((await a.get(`/places/${place.id}/comments`)).body.comments[0].likedByMe, false);
    assert.equal((await b.del(`/comments/${c.id}/like`)).body.comment.likes, 0);

    assert.equal((await b.del(`/comments/${c.id}`)).status, 403);
    assert.equal((await a.del(`/comments/${c.id}`)).status, 204);
    assert.equal((await a.get(`/places/${place.id}/comments`)).body.comments.length, 0);
  });
});

describe('发现：按定位随机推荐', () => {
  async function seedPlace(owner: ReturnType<TestEnv['client']>, name: string, at: { lat: number; lng: number }, titles: string[]) {
    const place = await createPlace(owner, name, at);
    const ids: Record<string, string> = {};
    for (const t of titles) {
      const r = await owner.post(`/places/${place.id}/songs`, vibe(t, '某歌手'));
      ids[t] = r.body.placeSong.id;
    }
    return { place, ids };
  }

  it('只推荐半径内别人的歌，返回当前所在地点', async () => {
    const owner = env.client((await env.newUser()).token);
    const me = env.client((await env.newUser()).token);
    const here = await seedPlace(owner, '这里', BUND, ['近一', '近二']);
    await seedPlace(owner, '很远', northOf(BUND, 5000), ['远歌']);

    const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=10`);
    assert.equal(res.status, 200);
    const titles = res.body.recommendations.map((r: { placeSong: { song: { title: string } } }) => r.placeSong.song.title).sort();
    assert.deepEqual(titles, ['近一', '近二']);
    assert.equal(res.body.currentPlace.id, here.place.id);
    assert.equal(res.body.recommendations[0].place.name, '这里');
  });

  it('不推荐自己上传的、自己点过踩的；同一首歌只出现一次', async () => {
    const owner = env.client((await env.newUser()).token);
    const me = env.client((await env.newUser()).token);
    const { place, ids } = await seedPlace(owner, '这里', BUND, ['保留', '被我踩', '重复']);
    await owner.post(`/places/${place.id}/songs`, { ...vibe('重复', '某歌手'), kind: 'frequent' });
    await me.post(`/places/${place.id}/songs`, vibe('我自己传的', '某歌手'));
    await me.put(`/place-songs/${ids['被我踩']}/vote`, { value: -1 });

    const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=10`);
    const titles = res.body.recommendations.map((r: { placeSong: { song: { title: string } } }) => r.placeSong.song.title).sort();
    assert.deepEqual(titles, ['保留', '重复']);
  });

  it('被多人点踩的歌不再进入随机推荐，但地点列表里仍在', async () => {
    const owner = env.client((await env.newUser()).token);
    const me = env.client((await env.newUser()).token);
    const { place, ids } = await seedPlace(owner, '这里', BUND, ['好歌', '烂歌']);
    for (let i = 0; i < 4; i++) {
      await env.client((await env.newUser()).token).put(`/place-songs/${ids['烂歌']}/vote`, { value: -1 });
    }
    // 提交者自己那一票是赞：1 赞 vs 4 踩 → 满足 dislikes>=3 且 > 2*likes
    const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=10`);
    assert.deepEqual(
      res.body.recommendations.map((r: { placeSong: { song: { title: string } } }) => r.placeSong.song.title),
      ['好歌'],
    );
    const list = await me.get(`/places/${place.id}/songs`);
    assert.equal(list.body.songs.length, 2);
  });

  it('离地点越远越难被推荐，点赞越多越容易被推荐（统计意义上）', async () => {
    const owner = env.client((await env.newUser()).token);
    const me = env.client((await env.newUser()).token);
    const crowd = await Promise.all(Array.from({ length: 8 }, () => env.newUser()));
    const { ids: popular } = await seedPlace(owner, '热门处', BUND, ['热门']);
    const { ids: plain } = await seedPlace(owner, '普通处', northOf(BUND, 10), ['普通']);
    const { ids: distant } = await seedPlace(owner, '较远处', northOf(BUND, 290), ['较远']);
    for (const u of crowd) await env.client(u.token).put(`/place-songs/${popular['热门']}/vote`, { value: 1 });
    void plain;
    void distant;

    const counts: Record<string, number> = { 热门: 0, 普通: 0, 较远: 0 };
    for (let i = 0; i < 300; i++) {
      const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=1`);
      counts[res.body.recommendations[0].placeSong.song.title]!++;
    }
    assert.ok(counts['热门']! > counts['普通']!, JSON.stringify(counts));
    assert.ok(counts['普通']! > counts['较远']!, JSON.stringify(counts));
    assert.ok(counts['较远']! > 0, '远处的也偶尔会出现: ' + JSON.stringify(counts));
  });

  it('多次刷新结果不同（随机），limit 生效', async () => {
    const owner = env.client((await env.newUser()).token);
    const me = env.client((await env.newUser()).token);
    await seedPlace(owner, '这里', BUND, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=3`);
      assert.equal(res.body.recommendations.length, 3);
      seen.add(res.body.recommendations.map((r: { placeSong: { song: { title: string } } }) => r.placeSong.song.title).join(','));
    }
    assert.ok(seen.size > 1, '10 次刷新应该出现不止一种组合');
  });

  it('附近没有任何数据时返回空，不报错', async () => {
    const me = env.client((await env.newUser()).token);
    const res = await me.get(`/discover?lat=10&lng=10`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { currentPlace: null, nearbyPlaces: [], recommendations: [] });
  });
});

describe('官方记录导入', () => {
  const payload = {
    records: [
      {
        place: { name: '音乐厅广场', ...BUND, category: 'venue' },
        songs: [
          {
            title: '月光奏鸣曲',
            artist: '贝多芬',
            kind: 'live',
            eventType: 'concert',
            performer: '市交响乐团',
            eventTitle: '夏夜露天音乐会',
            eventAt: '2026-07-01',
          },
          { title: '常驻曲', artist: '广播', kind: 'frequent' },
        ],
      },
    ],
  };
  const admin = (key?: string) => ({ 'x-admin-key': key ?? env.adminKey });
  const importAs = (key?: string, body: unknown = payload) =>
    env.app.inject({ method: 'POST', url: '/api/admin/import', headers: admin(key), payload: body as object });

  it('未配置 ADMIN_KEY 时接口关闭', async () => {
    await env.close();
    env = await setup({ adminKey: null });
    assert.equal((await importAs('anything')).statusCode, 404);
  });

  it('密钥错误 401', async () => {
    assert.equal((await importAs('wrong')).statusCode, 401);
    const noHeader = await env.app.inject({ method: 'POST', url: '/api/admin/import', payload });
    assert.equal(noHeader.statusCode, 401);
  });

  it('导入后用户能看到 official 标记的记录，且幂等', async () => {
    const first = await importAs();
    assert.equal(first.statusCode, 201);
    assert.deepEqual(first.json(), { placesCreated: 1, songsCreated: 2 });
    assert.deepEqual((await importAs()).json(), { placesCreated: 0, songsCreated: 0 });

    const me = env.client((await env.newUser()).token);
    const nearby = await me.get(`/places/nearby?lat=${BUND.lat}&lng=${BUND.lng}`);
    assert.equal(nearby.body.places.length, 1);
    assert.equal(nearby.body.places[0].songCount, 2);

    const songs = (await me.get(`/places/${nearby.body.places[0].id}/songs`)).body.songs;
    assert.equal(songs.length, 2);
    for (const s of songs) {
      assert.equal(s.source, 'official');
      assert.equal(s.submittedBy, null);
      assert.equal(s.likes, 0);
    }
    const live = songs.find((s: { kind: string }) => s.kind === 'live');
    assert.equal(live.live.eventTitle, '夏夜露天音乐会');

    // 用户可以给官方记录点赞
    const voted = await me.put(`/place-songs/${live.id}/vote`, { value: 1 });
    assert.equal(voted.body.placeSong.likes, 1);
    // 但不能删除官方记录
    assert.equal((await me.del(`/place-songs/${live.id}`)).status, 403);
  });

  it('官方记录也会进入发现页推荐', async () => {
    await importAs();
    const me = env.client((await env.newUser()).token);
    const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=5`);
    assert.equal(res.body.recommendations.length, 2);
    assert.ok(res.body.recommendations.every((r: { placeSong: { source: string } }) => r.placeSong.source === 'official'));
  });

  it('某条数据非法时整体回滚', async () => {
    const bad = {
      records: [
        payload.records[0],
        { place: { name: '另一处', ...BUND, lat: 10 }, songs: [{ title: 'x', artist: 'y', kind: 'live' }] },
      ],
    };
    const res = await importAs(undefined, bad);
    assert.equal(res.statusCode, 400);
    const me = env.client((await env.newUser()).token);
    assert.equal((await me.get(`/places/nearby?lat=${BUND.lat}&lng=${BUND.lng}`)).body.places.length, 0);
  });
});

describe('我的', () => {
  it('我上传的歌与统计', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const ps = (await a.post(`/places/${place.id}/songs`, vibe('A'))).body.placeSong;
    await a.post(`/places/${place.id}/comments`, { body: 'hi' });
    await b.put(`/place-songs/${ps.id}/vote`, { value: 1 });

    const songs = (await a.get('/me/songs')).body.songs;
    assert.equal(songs.length, 1);
    assert.equal(songs[0].placeName, '外滩观景台');
    assert.equal(songs[0].likes, 2);

    const stats = (await a.get('/me')).body.stats;
    assert.equal(stats.songs, 1);
    assert.equal(stats.comments, 1);
    assert.equal(stats.likesReceived, 1, '不含自己给自己的那一票');
  });
});

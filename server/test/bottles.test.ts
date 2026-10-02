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

const bottle = (extra: Record<string, unknown> = {}) => ({
  ...BUND,
  title: '晴天',
  artist: '周杰伦',
  message: '给下一个路过江边的人：今天的晚霞很好看',
  ...extra,
});

describe('声音漂流瓶', () => {
  it('只能在现场投放；投放后等待被捡起', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const place = await createPlace(a);
    const far = await a.post(`/places/${place.id}/bottles`, bottle(northOf(BUND, 800)));
    assert.equal(far.status, 403);
    assert.equal(far.body.error, 'too_far');

    const ok = await a.post(`/places/${place.id}/bottles`, bottle());
    assert.equal(ok.status, 201);
    assert.equal(ok.body.bottle.picked, null);
    assert.equal(ok.body.bottle.from.nickname, '阿晴');

    // 同一地点未被捡起前不能再投
    assert.equal((await a.post(`/places/${place.id}/bottles`, bottle())).status, 409);
    // 自己看不到自己的瓶子在「等待中」
    assert.equal((await a.get(`/places/${place.id}/bottles/waiting`)).body.count, 0);
  });

  it('别人到现场打卡时捡起；每个瓶子只会被一个人捡到；投放者能看到被谁捡起', async () => {
    const a = env.client((await env.newUser('阿晴')).token);
    const b = env.client((await env.newUser('小夏')).token);
    const c = env.client((await env.newUser('路人')).token);
    const place = await createPlace(a);
    await a.post(`/places/${place.id}/bottles`, bottle());
    assert.equal((await b.get(`/places/${place.id}/bottles/waiting`)).body.count, 1);

    // 投放者自己打卡不会捡到自己的瓶子
    const self = await a.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(self.body.bottle, null);

    env.clock.advance(2 * DAY);
    const picked = await b.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(picked.status, 201);
    assert.equal(picked.body.bottle.song.title, '晴天');
    assert.equal(picked.body.bottle.from.nickname, '阿晴');
    assert.equal(picked.body.bottle.picked.by.nickname, '小夏');
    assert.equal(picked.body.waitingBottles, 0);

    // 第三个人来，已经没有了
    const none = await c.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(none.body.bottle, null);

    const mine = await a.get('/me/bottles');
    assert.equal(mine.body.thrown.length, 1);
    assert.equal(mine.body.thrown[0].picked.by.nickname, '小夏');
    const theirs = await b.get('/me/bottles');
    assert.equal(theirs.body.picked.length, 1);

    // 被捡起后，阿晴可以在这里再投一个
    assert.equal((await a.post(`/places/${place.id}/bottles`, bottle({ title: '稻香' }))).status, 201);
  });

  it('6 小时内的重复打卡不会再捡瓶子（防刷）；先到先得按投放时间', async () => {
    const a = env.client((await env.newUser()).token);
    const a2 = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    await a.post(`/places/${place.id}/bottles`, bottle({ title: '最早的' }));
    env.clock.advance(HOUR);
    await a2.post(`/places/${place.id}/bottles`, bottle({ title: '后来的' }));

    const first = await b.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(first.body.bottle.song.title, '最早的');
    env.clock.advance(HOUR);
    const repeat = await b.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(repeat.body.repeat, true);
    assert.equal(repeat.body.bottle, null);

    env.clock.advance(6 * HOUR);
    const later = await b.post(`/places/${place.id}/checkin`, BUND);
    assert.equal(later.body.bottle.song.title, '后来的');
  });

  it('留言经过审核；发现页给出当前地点等待中的瓶子数', async () => {
    const a = env.client((await env.newUser()).token);
    const b = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    const spam = await a.post(`/places/${place.id}/bottles`, bottle({ message: '加微信领取福利' }));
    assert.equal(spam.status, 400);
    assert.equal(spam.body.error, 'content_rejected');

    await a.post(`/places/${place.id}/bottles`, bottle());
    const d = await b.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&hour=20`);
    assert.equal(d.body.currentPlace.id, place.id);
    assert.equal(d.body.waitingBottles, 1);
  });
});

describe('发现页的推荐理由与时段', () => {
  it('每条推荐都有基于数据的理由与情绪标签', async () => {
    const a = env.client((await env.newUser()).token);
    const place = await createPlace(a);
    await a.post(`/places/${place.id}/songs`, { title: '晴天', artist: '周杰伦', kind: 'vibe', note: '日落时分循环这首' });
    const me = env.client((await env.newUser()).token);
    const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&hour=18`);
    const r = res.body.recommendations[0];
    assert.ok(r.reason.length > 0);
    assert.match(r.reason, /日落时分/);
    assert.deepEqual(r.moods.slice(0, 2), ['怀旧', '清新'], '命中曲库的歌带曲库情绪');
  });

  it('在当前时段常被听的歌更容易被推荐', async () => {
    const owner = env.client((await env.newUser()).token);
    const place = await createPlace(owner);
    const night = (await owner.post(`/places/${place.id}/songs`, { title: '夜曲', artist: '周杰伦', kind: 'frequent' })).body.placeSong;
    await owner.post(`/places/${place.id}/songs`, { title: '稻香', artist: '周杰伦', kind: 'frequent' });
    // 夜曲：很多人在上海 20 点（时钟默认 UTC 12:00）表示在听
    for (let i = 0; i < 5; i++) {
      const u = env.client((await env.newUser()).token);
      await u.post(`/place-songs/${night.id}/listen`);
    }
    const me = env.client((await env.newUser()).token);
    const count = async (hour: number) => {
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const res = await me.get(`/discover?lat=${BUND.lat}&lng=${BUND.lng}&limit=1&hour=${hour}`);
        if (res.body.recommendations[0].placeSong.song.title === '夜曲') n++;
      }
      return n;
    };
    const atNight = await count(20);
    const atMorning = await count(8);
    assert.ok(atNight > atMorning, `20 点 ${atNight} 次 vs 8 点 ${atMorning} 次`);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boundingBox, haversineM } from '../src/geo.ts';
import {
  isSuppressed,
  proximityFactor,
  songWeight,
  weightedSample,
  type RankInput,
} from '../src/ranking.ts';
import { DAY, seededRng } from './helpers.ts';

const now = new Date('2026-06-01T00:00:00Z');
const base: RankInput = {
  kind: 'vibe',
  source: 'user',
  likes: 0,
  dislikes: 0,
  listeners30d: 0,
  referenceAt: now,
  now,
};
const w = (over: Partial<RankInput>) => songWeight({ ...base, ...over });

describe('songWeight', () => {
  it('点赞越多权重越高，但边际递减', () => {
    const [a, b, c, d] = [0, 1, 10, 100].map((likes) => w({ likes }));
    assert.ok(a! < b! && b! < c! && c! < d!);
    // 平均每个赞带来的增量递减：10→100（多 90 赞）比 1→10（多 9 赞）每赞贡献更小
    assert.ok((d! - c!) / 90 < (c! - b!) / 9, '每个赞的边际贡献应递减');
  });

  it('点踩压低权重，且永远为正', () => {
    assert.ok(w({ likes: 5, dislikes: 5 }) < w({ likes: 5 }));
    assert.ok(w({ dislikes: 1000 }) > 0);
  });

  it('官方记录高于用户上传；现场高于应景', () => {
    assert.ok(w({ source: 'official' }) > w({ source: 'user' }));
    assert.ok(w({ kind: 'live' }) > w({ kind: 'vibe' }));
  });

  it('近 30 天在听的人越多权重越高', () => {
    assert.ok(w({ kind: 'frequent', listeners30d: 20 }) > w({ kind: 'frequent', listeners30d: 0 }));
  });

  it('随时间衰减，但有下限（老记录仍可被推荐）', () => {
    const fresh = w({});
    const oneYear = w({ referenceAt: new Date(now.getTime() - 365 * DAY) });
    const tenYears = w({ referenceAt: new Date(now.getTime() - 3650 * DAY) });
    assert.ok(oneYear < fresh && tenYears < oneYear);
    assert.ok(tenYears >= fresh * 0.6 - 1e-9, '衰减不应低于 60%');
  });

  it('未来的演出（官方节目单）不会被当成负的年龄', () => {
    const future = w({ referenceAt: new Date(now.getTime() + 30 * DAY) });
    assert.equal(future, w({}));
  });
});

describe('isSuppressed', () => {
  it('踩的人多且远多于赞时才屏蔽', () => {
    assert.equal(isSuppressed(0, 2), false);
    assert.equal(isSuppressed(0, 3), true);
    assert.equal(isSuppressed(2, 4), false);
    assert.equal(isSuppressed(2, 5), true);
    assert.equal(isSuppressed(20, 5), false);
  });
});

describe('proximityFactor', () => {
  it('半径内为 1，之后单调下降', () => {
    assert.equal(proximityFactor(0, 150), 1);
    assert.equal(proximityFactor(150, 150), 1);
    assert.ok(Math.abs(proximityFactor(300, 150) - 0.5) < 1e-9);
    assert.ok(proximityFactor(600, 150) < proximityFactor(300, 150));
  });
});

describe('weightedSample', () => {
  const items = [
    { item: 'a', weight: 1 },
    { item: 'b', weight: 1 },
    { item: 'c', weight: 50 },
    { item: 'zero', weight: 0 },
  ];

  it('不重复、不超过 n、排除零权重', () => {
    const out = weightedSample(items, 10, seededRng(7));
    assert.deepEqual([...out].sort(), ['a', 'b', 'c']);
    assert.equal(weightedSample(items, 2, seededRng(7)).length, 2);
    assert.deepEqual(weightedSample(items, 0, seededRng(7)), []);
  });

  it('相同随机源得到相同结果', () => {
    assert.deepEqual(weightedSample(items, 2, seededRng(42)), weightedSample(items, 2, seededRng(42)));
  });

  it('权重大的更常排在第一位', () => {
    const rng = seededRng(2024);
    const first: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 2000; i++) first[weightedSample(items, 1, rng)[0]!]!++;
    // 期望 c ≈ 50/52 ≈ 96%
    assert.ok(first.c! > 1800, `c 应该绝大多数时候第一: ${JSON.stringify(first)}`);
    assert.ok(first.a! > 0 && first.b! > 0, '低权重的也有机会');
  });
});

describe('geo', () => {
  it('haversine：1° 纬度约 111.2 km，同点为 0', () => {
    assert.equal(haversineM(31, 121, 31, 121), 0);
    const d = haversineM(31, 121, 32, 121);
    assert.ok(Math.abs(d - 111_195) < 200, String(d));
  });

  it('boundingBox 包住圆内的点', () => {
    const c = { lat: 31.24, lng: 121.49 };
    const box = boundingBox(c.lat, c.lng, 500);
    const within = (p: { lat: number; lng: number }) =>
      p.lat >= box.minLat && p.lat <= box.maxLat && p.lng >= box.minLng && p.lng <= box.maxLng;
    const m = 1 / 111_195; // 1 米对应的纬度
    const mLng = m / Math.cos((c.lat * Math.PI) / 180); // 1 米对应的经度
    assert.ok(within({ lat: c.lat + 499 * m, lng: c.lng }));
    assert.ok(within({ lat: c.lat - 499 * m, lng: c.lng }));
    assert.ok(within({ lat: c.lat, lng: c.lng + 499 * mLng }));
    assert.ok(within({ lat: c.lat, lng: c.lng - 499 * mLng }));
    assert.ok(!within({ lat: c.lat + 510 * m, lng: c.lng }), '超出范围的点应在框外');
    assert.ok(!within({ lat: c.lat, lng: c.lng + 510 * mLng }), '超出范围的点应在框外');
  });
});

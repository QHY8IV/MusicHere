import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'musichere-web-'));
  mkdirSync(join(dir, '_expo', 'static', 'js'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>MusicHere</title>');
  writeFileSync(join(dir, '_expo', 'static', 'js', 'app-abc123.js'), 'console.log(1)');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('托管 web 版', () => {
  it('首页、静态资源、SPA 深链接、API 404 各自正确', async () => {
    const app = await buildApp({ db: openDb(':memory:'), webDir: dir });
    const home = await app.inject({ url: '/' });
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /MusicHere/);
    assert.equal(home.headers['cache-control'], 'no-cache');

    const js = await app.inject({ url: '/_expo/static/js/app-abc123.js' });
    assert.equal(js.statusCode, 200);
    assert.match(String(js.headers['cache-control']), /immutable/);

    // 深链接刷新：回退到 index.html
    const deep = await app.inject({ url: '/place/6f1b0e8e-0000-4000-8000-000000000000' });
    assert.equal(deep.statusCode, 200);
    assert.match(deep.body, /MusicHere/);
    assert.match(String(deep.headers['content-type']), /text\/html/);

    // API 未知路径、缺失的静态文件：仍然是 404，不能被当成页面
    const api = await app.inject({ url: '/api/nope' });
    assert.equal(api.statusCode, 404);
    assert.equal(api.json().error, 'not_found');
    assert.equal((await app.inject({ url: '/_expo/static/js/missing.js' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/whatever' })).statusCode, 404);

    // API 照常工作
    assert.equal((await app.inject({ url: '/api/health' })).statusCode, 200);
    await app.close();
  });

  it('没配置 webDir 时不托管页面；webDir 无效时启动即失败', async () => {
    const app = await buildApp({ db: openDb(':memory:') });
    assert.equal((await app.inject({ url: '/' })).statusCode, 404);
    await app.close();
    await assert.rejects(buildApp({ db: openDb(':memory:'), webDir: join(dir, 'nope') }), /index\.html/);
  });
});

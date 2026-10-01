/**
 * 端到端冒烟测试：用无头 Chromium 打开 app 的 web 版，模拟手机尺寸和 GPS 定位，
 * 对着真实后端走一遍核心流程（登录 → 发现 → 打卡 → 点赞 → 评论 → 分享 → 足迹 → 离场）。
 *
 * 前置：后端运行在 API_URL（默认 3000），并已用 `npm run seed` 在 (31.24, 121.49) 附近生成示例数据；
 *       web 版已导出并由静态服务器提供在 WEB_URL（默认 8081）。详见根目录 README 的“端到端测试”。
 * 注意：每次运行都会写入数据（新用户、评论、新地点），重跑前请重置数据库。
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const WEB_URL = process.env.WEB_URL || 'http://localhost:8081/';
const OUT = process.env.E2E_OUT || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const HERE = { latitude: 31.24, longitude: 121.49, accuracy: 20 };
// 正北约 450 米：在「江边步道」半径之外
const FAR = { latitude: 31.24 + 450 / 111195, longitude: 121.49, accuracy: 20 };

(async () => {
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    geolocation: HERE,
    permissions: ['geolocation'],
    locale: 'zh-CN',
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });

  const step = async (name, fn) => {
    try { await fn(); console.log('✔', name); }
    catch (e) { console.log('✘', name, '\n   ', e.message.split('\n')[0]); await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png`, fullPage: true }); throw e; }
  };
  const shot = (n) => page.screenshot({ path: `${OUT}/shot-${n}.png`, fullPage: true });
  const T = (id) => page.getByTestId(id);

  await page.goto(WEB_URL);

  await step('欢迎页：输入昵称进入', async () => {
    await page.getByText('每个地方，都有它的背景音乐').waitFor();
    await T('start').click();
    await T('welcome-error').waitFor(); // 空昵称被拦下
    await T('nickname').fill('测试员');
    await shot('1-welcome');
    await T('start').click();
  });

  await step('发现页：识别出当前地点并给出推荐', async () => {
    await T('current-place').waitFor();
    assert.equal(await T('current-place').innerText(), '江边步道');
    await T('song-title').first().waitFor();
    assert.ok((await T('song-title').count()) >= 1);
    await shot('2-discover');
  });

  await step('发现页：换一批', async () => {
    const reloaded = page.waitForResponse((r) => r.url().includes('/api/discover'));
    await T('shuffle').click();
    await reloaded;
    await page.waitForTimeout(300); // 等渲染
  });

  await step('发现页：点赞会变化且可取消', async () => {
    const like = T('like').first();
    const before = Number((await like.innerText()).replace(/\D/g, ''));
    await like.click();
    await page.waitForFunction(([b]) => Number(document.querySelector('[data-testid=like]').innerText.replace(/\D/g, '')) === b + 1, [before]);
    await page.waitForTimeout(300);
    await like.click();
    await page.waitForFunction(([b]) => Number(document.querySelector('[data-testid=like]').innerText.replace(/\D/g, '')) === b, [before]);
  });

  await step('进入地点页并打卡，显示三类歌曲', async () => {
    await T('go-checkin').click();
    await T('place-name-title').waitFor();
    await T('checkin').click();
    await T('checkin-done').waitFor();
    const txt = await T('checkin-done').innerText();
    assert.match(txt, /应景/); assert.match(txt, /常听/); assert.match(txt, /现场/);
    assert.match(txt, /第 \d+ 位/);
    assert.match(txt, /《海阔天空》/, '现场栏应出现街头艺人唱过的歌');
    await shot('3-checkin');
  });

  await step('重复打卡被服务端折叠（刷新后按钮依旧可用且提示重复）', async () => {
    // 重新进入页面，状态被重置；再点一次应提示“刚刚已经打过卡”
    await page.reload(); // 深链接：仍停留在该地点页，登录态从本地存储恢复
    await T('place-name-title').waitFor();
    await T('checkin').click();
    await page.getByText('你刚刚已经在这里打过卡了').waitFor();
  });

  await step('现场 / 常听 标签；“我也在听”', async () => {
    await T('tab-live').click();
    await page.getByText('街头艺人').first().waitFor();
    await page.getByText('江边吉他大叔').waitFor();
    await shot('4-live');
    await T('tab-frequent').click();
    const listen = T('listen').first();
    const before = await listen.innerText();
    await listen.click();
    await page.getByText('已记下').waitFor();
    assert.notEqual(await listen.innerText(), before);
  });

  await step('评论：发布、点赞、排在最前', async () => {
    await T('tab-comments').click();
    await T('comment-input').fill('傍晚的江风配这些歌刚刚好');
    await page.getByRole('button', { name: '治愈' }).click();
    await T('post-comment').click();
    await page.getByText('评论已发布').waitFor();
    assert.equal(await T('comment-body').first().innerText(), '傍晚的江风配这些歌刚刚好');
    await T('comment-like').first().click();
    await page.waitForFunction(() => document.querySelector('[data-testid=comment-like]').innerText.replace(/\D/g, '') === '1');
    await shot('5-comments');
  });

  await step('分享页：新建地点并上传一首“现场”歌', async () => {
    // 地点页是压在 tab 之上的页面，没有底部 tab；先用页面内的“添加”按钮验证带 placeId 跳转
    await T('tab-vibe').click();
    await page.getByText('添加', { exact: true }).click();
    await page.getByText('分享一首歌').waitFor();
    const chip = page.getByRole('button', { name: /江边步道/ });
    await chip.waitFor();
    const border = await chip.evaluate((el) => getComputedStyle(el).borderTopColor);
    assert.equal(border, 'rgb(255, 122, 89)', '来源地点应被预选（强调色边框）');
    await T('new-place').click();
    await T('place-name').fill('测试角落');
    await T('kind-live').click();
    await T('submit-song').click(); // 缺歌名
    await T('form-error').waitFor();
    await T('song-title-input').fill('起风了');
    await T('song-artist-input').fill('买辣椒也用券');
    await page.getByRole('button', { name: '街头艺人' }).click();
    await page.getByPlaceholder('乐队 / 艺人 / 街头歌手').fill('地铁口歌手');
    await shot('6-add');
    await T('submit-song').click();
    await page.locator('[data-testid=place-name-title]', { hasText: '测试角落' }).waitFor();
    await T('tab-live').last().click();
    await page.getByText('地铁口歌手').waitFor();
  });

  await step('我的页：统计与足迹', async () => {
    await page.goBack();
    await page.getByText('我的', { exact: true }).last().click();
    await T('nickname-display').waitFor();
    assert.equal(await T('nickname-display').innerText(), '测试员');
    await page.getByText('打卡足迹').waitFor();
    await page.getByText('📍 江边步道').first().waitFor();
    await page.getByText('起风了').first().waitFor();
    await shot('7-me');
  });

  await step('离开现场后：打卡按钮不可用并说明距离', async () => {
    await ctx.setGeolocation(FAR);
    await page.reload();
    // 登录态由本地存储恢复，页面停在“我的”；定位已变成 450 米外
    await T('nickname-display').waitFor();
    await page.getByText('地点', { exact: true }).last().click();
    await page.getByText('附近的地点').waitFor();
    await page.getByText('江边步道').first().click();
    await T('place-name-title').waitFor();
    await page.getByText(/进入 \d+ 米范围内即可打卡/).waitFor();
    let posted = false;
    page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/checkin')) posted = true; });
    await T('checkin').click();
    await page.waitForTimeout(500);
    assert.equal(posted, false, '不在现场时点击打卡不应向服务端发请求');
    assert.equal(await T('checkin').evaluate((el) => getComputedStyle(el).opacity), '0.45', '按钮应呈禁用样式');
    await shot('8-too-far');
  });

  await browser.close();
  const real = problems.filter((p) => !/favicon|DevTools/i.test(p));
  if (real.length) { console.log('\n运行期问题:\n' + real.join('\n')); process.exitCode = 1; }
  else console.log('\n全部通过，无控制台错误');
})().catch((e) => { console.error('E2E 失败:', e.message); process.exit(1); });

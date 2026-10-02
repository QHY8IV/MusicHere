/**
 * 生成 5 分钟路演 PPT：pitch/此地有歌-路演.pptx
 *
 * 依赖不在仓库里（只有生成材料时才需要）：
 *   mkdir -p /tmp/deck && cd /tmp/deck && npm i pptxgenjs react-icons react react-dom
 *   NODE_PATH=/tmp/deck/node_modules AUTHOR="你的名字" node pitch/tools/make-deck.cjs
 *
 * 背景光晕、手机样机、图标先用 Chromium 渲染成 PNG（复用 e2e 里的 playwright），再由 pptxgenjs 组装。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../../e2e')] }));
const pptxgen = require('pptxgenjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const io = require('react-icons/io5');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, '此地有歌-路演.pptx');
const AUTHOR = process.env.AUTHOR || '【队长姓名】';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-'));

const HEX = {
  bg: '07080C', surface: '12151D', surface2: '191D27', text: 'F4F5F7', sub: 'A7ACB9', faint: '6B7181',
  lime: 'D2F76A', mint: '3EE6C1', sky: '5CC8FF', sunset: 'FF8A5B', violet: 'A08BFF', pink: 'FF7AC6',
};

const THEME = {
  name: '此地有歌 · 城市夜色',
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  colors: {
    // 深色演示：tx1 是浅色文字、bg1 是近黑底，PowerPoint 里新加的文字默认就是可读的浅色
    dk1: HEX.text, lt1: HEX.bg, dk2: HEX.sub, lt2: HEX.surface,
    accent1: HEX.lime, accent2: HEX.mint, accent3: HEX.sky, accent4: HEX.sunset, accent5: HEX.violet, accent6: HEX.pink,
    hlink: HEX.mint, folHlink: HEX.violet,
  },
};

// ---------- 1. 用 Chromium 渲染图片素材 ----------
const shot = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(ROOT, 'screens', f)).toString('base64');

const assets = {
  bgCover: { w: 1920, h: 1080, html: bg([['-15%', '-30%', 1300, 'rgba(183,243,107,.30)'], ['70%', '45%', 1400, 'rgba(160,139,255,.32)'], ['45%', '60%', 800, 'rgba(62,230,193,.14)']]) },
  bgA: { w: 1920, h: 1080, html: bg([['75%', '-45%', 1300, 'rgba(160,139,255,.22)'], ['-20%', '70%', 1000, 'rgba(62,230,193,.10)']]) },
  bgB: { w: 1920, h: 1080, html: bg([['-20%', '-50%', 1300, 'rgba(183,243,107,.16)'], ['80%', '60%', 1100, 'rgba(92,200,255,.14)']]) },
};
function bg(glows) {
  return `<body style="margin:0;width:1920px;height:1080px;background:#07080C;position:relative;overflow:hidden">${glows
    .map(([l, t, s, c]) => `<div style="position:absolute;left:${l};top:${t};width:${s}px;height:${s}px;border-radius:50%;background:radial-gradient(closest-side,${c},rgba(0,0,0,0))"></div>`)
    .join('')}</body>`;
}
for (const f of fs.readdirSync(path.join(ROOT, 'screens'))) {
  const id = 'ph_' + f.replace(/\.jpg$/, '');
  if (f.startsWith('17')) {
    assets[id] = { w: 1080 + 80, h: 1440 + 80, transparent: true, html: `<body style="margin:0;background:transparent"><div style="margin:40px;width:1080px;height:1440px;border-radius:48px;overflow:hidden;box-shadow:0 0 0 3px rgba(255,255,255,.14)"><img src="${shot(f)}" style="width:100%;height:100%;display:block"/></div></body>` };
  } else {
    assets[id] = { w: 780 + 64, h: 1688 + 64, transparent: true, html: `<body style="margin:0;background:transparent"><div style="width:${780 + 64}px;height:${1688 + 64}px;border-radius:120px;background:#000;padding:28px;box-sizing:border-box;border:4px solid rgba(255,255,255,.2)"><img src="${shot(f)}" style="width:100%;height:100%;object-fit:cover;object-position:top;border-radius:94px;display:block"/></div></body>` };
  }
}
const ICONS = {
  list: ['IoListOutline', HEX.lime], ghost: ['IoTimeOutline', HEX.sunset], people: ['IoPeopleOutline', HEX.violet],
  pin: ['IoLocationOutline', HEX.mint], camera: ['IoCameraOutline', HEX.violet], sparkles: ['IoSparklesOutline', HEX.violet],
  layers: ['IoLayersOutline', HEX.sky], chat: ['IoChatbubbleEllipsesOutline', HEX.mint], pulse: ['IoPulseOutline', HEX.pink],
  mail: ['IoMailOutline', HEX.sky], flag: ['IoFlagOutline', HEX.lime], image: ['IoImageOutline', HEX.sunset],
  pen: ['IoCreateOutline', HEX.lime], shield: ['IoShieldCheckmarkOutline', HEX.mint], snow: ['IoSnowOutline', HEX.sky],
  music: ['IoMusicalNotesOutline', HEX.lime], business: ['IoStorefrontOutline', HEX.sunset], mic: ['IoMicOutline', HEX.pink],
  data: ['IoAnalyticsOutline', HEX.violet],
};
for (const [k, [name, color]] of Object.entries(ICONS)) {
  const svg = renderToStaticMarkup(React.createElement(io[name], { size: 150, color: '#' + color }));
  assets['ic_' + k] = {
    w: 256, h: 256, transparent: true,
    html: `<body style="margin:0;background:transparent"><div style="width:256px;height:256px;border-radius:50%;background:#${color}26;border:3px solid #${color}55;box-sizing:border-box;display:flex;align-items:center;justify-content:center">${svg}</div></body>`,
  };
}

async function renderAssets() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  for (const [id, a] of Object.entries(assets)) {
    const page = await browser.newPage({ viewport: { width: a.w, height: a.h } });
    await page.setContent(a.html);
    await page.waitForTimeout(50);
    a.path = path.join(TMP, id + '.png');
    await page.screenshot({ path: a.path, omitBackground: !!a.transparent });
    await page.close();
  }
  await browser.close();
}

// ---------- 2. 组装 PPT ----------
async function build() {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5
  pres.title = '此地有歌 · 路演';
  pres.author = AUTHOR;
  pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
  const C = pres.SchemeColor;

  pres.defineSlideMaster({
    title: 'COVER',
    background: { path: assets.bgCover.path },
    objects: [],
  });
  for (const [name, bgPath] of [['CONTENT_A', assets.bgA.path], ['CONTENT_B', assets.bgB.path]]) {
    pres.defineSlideMaster({
      title: name,
      background: { path: bgPath },
      margin: [0.5, 0.6, 0.5, 0.6],
      objects: [
        { placeholder: { options: { name: 'kicker', type: 'body', x: 0.6, y: 0.45, w: 8, h: 0.35, fontSize: 13, bold: true, color: C.accent2, margin: 0, charSpacing: 2 }, text: '' } },
        { placeholder: { options: { name: 'title', type: 'title', x: 0.6, y: 0.82, w: 12.1, h: 0.9, fontSize: 34, bold: true, color: C.text1, margin: 0, valign: 'top', align: 'left' }, text: '' } },
        { text: { text: '此地有歌 · Q Music Ideas AI Hackathon', options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 9, color: C.text2, margin: 0 } } },
      ],
      slideNumber: { x: 12.3, y: 7.0, w: 0.5, h: 0.3, fontSize: 9, color: C.text2, align: 'right' },
    });
  }

  const PH_R = 1752 / 844; // 手机样机高宽比
  const phone = (s, id, x, y, h, name) => s.addImage({ path: assets['ph_' + id].path, x, y, h, w: h / PH_R, objectName: name || 'phone ' + id });
  const icon = (s, k, x, y, d = 0.6) => s.addImage({ path: assets['ic_' + k].path, x, y, w: d, h: d, objectName: 'icon ' + k });
  const card = (s, x, y, w, h, name) =>
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.18, fill: { color: HEX.surface, transparency: 15 }, line: { color: 'FFFFFF', transparency: 88, width: 0.75 }, objectName: name });
  const text = (s, t, o) => s.addText(t, { isTextBox: true, margin: 0, color: C.text1, fontSize: 14, valign: 'top', ...o });
  const chip = (s, t, x, y, color, w = 1.1) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.38, rectRadius: 0.19, fill: { color, transparency: 80 }, line: { color, transparency: 40, width: 0.75 }, objectName: 'chip ' + t });
    text(s, t, { x, y, w, h: 0.38, fontSize: 12, bold: true, color, align: 'center', valign: 'middle' });
  };
  const head = (s, kicker, title) => {
    s.addText(kicker, { placeholder: 'kicker' });
    s.addText(title, { placeholder: 'title' });
  };

  // 1 封面
  pres.addSection({ title: '开场' });
  let s = pres.addSlide({ masterName: 'COVER', sectionTitle: '开场' });
  text(s, [{ text: 'Q Music ', options: { color: C.text1 } }, { text: 'Ideas', options: { color: C.accent1 } }, { text: '  ·  AI Hackathon 2026  ·  赛道 A 创新音乐产品', options: { color: C.text2, fontSize: 14, bold: false } }], { x: 0.7, y: 0.6, w: 8, h: 0.4, fontSize: 18, bold: true });
  text(s, '此地有歌', { x: 0.7, y: 2.0, w: 6.2, h: 1.4, fontSize: 80, bold: true, color: C.accent1 });
  text(s, '每个地方，都有它的背景音乐', { x: 0.7, y: 3.5, w: 6.2, h: 0.6, fontSize: 26, color: C.text1 });
  text(s, '走到一个地方，打开 App，就能听到这里的人留下的歌；\nAI 读懂此刻的光线与心情，再从人群记忆里为你挑一首。', { x: 0.7, y: 4.3, w: 6.0, h: 0.9, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.3 });
  chip(s, 'AI 读懂此刻', 0.7, 5.5, HEX.violet, 1.5);
  chip(s, 'AI 声音画像', 2.35, 5.5, HEX.sky, 1.5);
  chip(s, '声音漂流瓶', 4.0, 5.5, HEX.lime, 1.4);
  text(s, `团队：${AUTHOR}`, { x: 0.7, y: 6.6, w: 6, h: 0.35, fontSize: 12, color: C.text2 });
  // 中间那台压在最上面
  phone(s, '02-now', 6.75, 1.55, 5.0);
  phone(s, '11-bottle', 10.35, 1.55, 5.0);
  phone(s, '05-scene', 8.55, 1.1, 5.0);
  s.addNotes('开场（20 秒）：大家好，我们的作品叫《此地有歌》——每个地方，都有它的背景音乐。今天的音乐推荐都在回答“你是谁”，我们想回答的是“你在哪、此刻是什么样”。');

  // 2 问题洞察
  pres.addSection({ title: '问题' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '问题' });
  head(s, '问题洞察', '推荐系统知道你是谁，却不知道你在哪');
  const pains = [
    ['list', '通用歌单 ≠ 此刻', '散步、通勤、等人时，人们会搜“适合傍晚江边听的歌”。但歌单是给所有人的，它不知道这条江、这个傍晚是什么样。'],
    ['ghost', '地点的声音在流失', '街头艺人的一首即兴、小 livehouse 的一场演出、咖啡馆一直循环的那首歌，没有任何平台记录，走了就没了。'],
    ['people', '音乐社交缺少在场感', '评论区在线上，和真实世界脱节。两个人在同一个地方被同一首歌打动，却永远不会知道彼此。'],
  ];
  pains.forEach(([ic, t, d], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 2.15, 3.85, 3.65, 'pain card ' + (i + 1));
    icon(s, ic, x + 0.35, 2.5, 0.75);
    text(s, t, { x: x + 0.35, y: 3.5, w: 3.2, h: 0.5, fontSize: 21, bold: true });
    text(s, d, { x: x + 0.35, y: 4.15, w: 3.2, h: 1.5, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.35 });
  });
  text(s, '我们想回答的是：你在哪，此刻是什么样。', { x: 0.6, y: 6.15, w: 12, h: 0.5, fontSize: 20, bold: true, color: C.accent1 });
  s.addNotes('问题（35 秒）：我们观察到三件事。第一，场景化听歌需求真实存在，但歌单是通用的，不知道“这里”。第二，地点的声音记忆在流失，街头艺人、livehouse 的现场没人记录。第三，音乐社交缺少在场感。');

  // 3 产品概念
  pres.addSection({ title: '方案' });
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '方案' });
  head(s, '解决方案', '把歌钉在地点上');
  text(s, '路过的人留下歌，后来的人在这里听到它。每个地点有三类歌单：', { x: 0.6, y: 1.75, w: 7, h: 0.4, fontSize: 15, color: C.text2 });
  const kinds = [
    ['应景', HEX.mint, '路过时觉得“就是这首”，随手上传'],
    ['常听', HEX.sky, '这里的人真正在听的歌，自动统计'],
    ['现场', HEX.sunset, '演唱会、即兴、街头艺人；官方记录 + 用户上传'],
  ];
  kinds.forEach(([k, c, d], i) => {
    const y = 2.35 + i * 0.78;
    chip(s, k, 0.6, y, c, 0.9);
    text(s, d, { x: 1.7, y, w: 5.3, h: 0.38, fontSize: 15, valign: 'middle' });
  });
  const flow = [['pin', '经过'], ['music', '留下歌'], ['flag', '打卡沉淀'], ['sparkles', '推荐给下一个人']];
  card(s, 0.6, 4.85, 6.7, 1.85, 'flow card');
  flow.forEach(([ic, t], i) => {
    const x = 0.9 + i * 1.6;
    icon(s, ic, x + 0.2, 5.1, 0.6);
    text(s, t, { x: x - 0.2, y: 5.85, w: 1.4, h: 0.35, fontSize: 13, bold: true, align: 'center' });
    if (i < flow.length - 1) text(s, '→', { x: x + 0.95, y: 5.15, w: 0.4, h: 0.5, fontSize: 20, color: C.text2, align: 'center' });
  });
  text(s, '点赞、播放、打卡都会改变推荐权重', { x: 0.9, y: 6.25, w: 6.2, h: 0.3, fontSize: 11, color: C.text2, align: 'center' });
  phone(s, '03-now-memory', 7.85, 1.45, 5.3);
  phone(s, '09-radar', 10.4, 1.45, 5.3);
  s.addNotes('方案（35 秒）：我们把歌钉在地点上。每个地点有三类歌单：应景、常听、现场。路人经过时，按定位随机推荐；点赞、播放、打卡都会改变推荐权重。右边是首页的“此地记忆”和附近的声景雷达。');

  // 4 AI 读懂此刻
  pres.addSection({ title: 'AI' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: 'AI' });
  head(s, '核心 AI 能力 ①', 'AI 读懂此刻：拍一下，听这里');
  phone(s, '04-listen', 0.6, 1.8, 5.0);
  phone(s, '08-scene-photo', 3.05, 1.8, 5.0);
  const steps = [
    ['camera', '输入此刻', '一张照片、一句心情（都可选），加上时段与位置'],
    ['sparkles', '多模态理解', '腾讯混元视觉 + 文本模型，把画面与心情解析为 14 维情绪坐标（能量 × 明亮）'],
    ['layers', '检索人群记忆', '这里的歌按 权重 × 距离 × 情绪相似度 × 时段 打分，选出 6 首'],
    ['chat', '有依据的理由', '“近 30 天 7 人在这里听过，傍晚最常被点播”；数据不足时由 AI 补充新发现'],
  ];
  steps.forEach(([ic, t, d], i) => {
    const y = 1.85 + i * 1.22;
    icon(s, ic, 5.95, y, 0.7);
    text(s, `${i + 1}  ${t}`, { x: 6.9, y: y - 0.02, w: 5.8, h: 0.4, fontSize: 18, bold: true });
    text(s, d, { x: 6.9, y: y + 0.42, w: 5.8, h: 0.7, fontSize: 13, color: C.text2, lineSpacingMultiple: 1.25 });
  });
  s.addNotes('AI 读懂此刻（50 秒）：这是我们的核心。用户拍一张照片或写一句心情，混元多模态模型把光线、色彩、心情解析成 14 维情绪坐标；然后在这个地点的人群记忆里，按权重、距离、情绪相似度和时段打分选歌。每一首都附一句有数据依据的理由，比如“近 30 天 7 人在这里听过”。新地点没有数据时，由 AI 补充推荐，解决冷启动。');

  // 5 声音画像
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: 'AI' });
  head(s, '核心 AI 能力 ②', 'AI 声音画像：每个地方听起来是什么样');
  card(s, 0.6, 1.95, 7.6, 1.7, 'quote card');
  text(s, '“江边步道听起来是「夜色」里带点「热血」，黄昏 18–20 点最热闹；人们常在这里听 Beyond、五月天，也曾响起过 1 次现场。”', { x: 0.95, y: 2.2, w: 7.0, h: 1.3, fontSize: 18, italic: true, color: C.accent1, lineSpacingMultiple: 1.3 });
  const facets = [
    ['pulse', '情绪构成', '14 种情绪的占比'],
    ['data', '24 小时热度', '自动找出高峰时段'],
    ['mic', '常听歌手', '这里的人的口味'],
    ['sparkles', 'AI 一句话', '数据变了才重写'],
  ];
  facets.forEach(([ic, t, d], i) => {
    const x = 0.6 + (i % 2) * 3.85, y = 4.0 + Math.floor(i / 2) * 1.3;
    icon(s, ic, x, y, 0.62);
    text(s, t, { x: x + 0.8, y: y - 0.02, w: 2.9, h: 0.38, fontSize: 16, bold: true });
    text(s, d, { x: x + 0.8, y: y + 0.36, w: 2.9, h: 0.35, fontSize: 13, color: C.text2 });
  });
  phone(s, '13-live', 9.3, 1.9, 4.9);
  s.addNotes('声音画像（25 秒）：每个地点会自动生成一张声音画像：情绪构成、24 小时热度、高峰时段、常听歌手，以及 AI 写的一句“这里听起来像什么”。画像按数据签名缓存，数据变了才重写，既省调用又始终新鲜。');

  // 6 在场交互
  pres.addSection({ title: '在场' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '在场' });
  head(s, '只有到了现场才能完成', '把线上音乐社交拉回真实世界');
  const cols = [
    ['12-throw', 'mail', '声音漂流瓶', '一首歌 + 一句话，只能在现场投；下一个来打卡的陌生人才能捡到。'],
    ['11-bottle', 'flag', '打卡', '到了现场才能打卡：捡起漂流瓶、点亮足迹，也计入推荐权重。'],
    ['17-postcard-export', 'image', '声音明信片', '地点图 + 歌 + AI 写的一句话，一键存图发朋友圈，把好奇的人带回现场。'],
  ];
  cols.forEach(([shotId, ic, t, d], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.85, 3.85, 4.85, 'moment card ' + t);
    const h = 2.95;
    const w = shotId.startsWith('17') ? h * (1160 / 1520) : h / PH_R;
    s.addImage({ path: assets['ph_' + shotId].path, x: x + (3.85 - w) / 2, y: 2.1, w, h, objectName: 'shot ' + shotId });
    icon(s, ic, x + 0.3, 5.2, 0.5);
    text(s, t, { x: x + 0.95, y: 5.25, w: 2.7, h: 0.42, fontSize: 18, bold: true });
    text(s, d, { x: x + 0.3, y: 5.8, w: 3.3, h: 0.8, fontSize: 12.5, color: C.text2, lineSpacingMultiple: 1.25 });
  });
  s.addNotes('在场交互（30 秒）：有些事只能在现场完成。声音漂流瓶只能在地点投放，下一个打卡的陌生人才能捡到。打卡还能生成声音明信片，一键分享，把好奇的人重新带回这个地方。');

  // 7 AI 全链路
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: 'AI' });
  head(s, 'AI 贯穿全链路', '六处 AI，每一处都解决一个具体问题');
  const ai = [
    ['camera', '读懂此刻', '照片 + 心情 → 情绪坐标', '“此刻的感觉”无法用规则表达'],
    ['chat', '推荐理由', '基于真实数据生成一句解释', '让推荐可解释、可信'],
    ['snow', '冷启动', '新地点由大模型补充推荐', '地点类产品最难的一关'],
    ['pulse', '声音画像', '统计数据 → 有温度的描述', '让一个地方“有性格”'],
    ['pen', '帮我写', '按地点与歌曲生成分享文案', '降低 UGC 门槛'],
    ['shield', '内容审核', '规则 + 大模型双重把关', '社区安全，失败时放行不阻塞'],
  ];
  ai.forEach(([ic, t, what, why], i) => {
    const x = 0.6 + (i % 3) * 4.1, y = 1.95 + Math.floor(i / 3) * 2.35;
    card(s, x, y, 3.85, 2.1, 'ai card ' + t);
    icon(s, ic, x + 0.3, y + 0.3, 0.6);
    text(s, t, { x: x + 1.05, y: y + 0.38, w: 2.6, h: 0.45, fontSize: 19, bold: true });
    text(s, what, { x: x + 0.3, y: y + 1.07, w: 3.3, h: 0.38, fontSize: 13.5 });
    text(s, why, { x: x + 0.3, y: y + 1.5, w: 3.3, h: 0.38, fontSize: 12, color: C.text2 });
  });
  text(s, '默认接入腾讯混元（OpenAI 兼容接口，可替换）；未配置大模型时自动降级为本地规则引擎，并在界面如实标注。', { x: 0.6, y: 6.6, w: 12, h: 0.3, fontSize: 11.5, color: C.text2 });
  s.addNotes('AI 全链路（25 秒）：除了读懂此刻和声音画像，AI 还负责推荐理由、新地点冷启动、帮用户写分享文案，以及内容审核。默认接入腾讯混元，没有配置时会降级为本地规则引擎，界面上如实标注，保证任何环境下都能完整演示。');

  // 8 完成度
  pres.addSection({ title: '完成度' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '完成度' });
  head(s, '完成度', '不是概念稿，是能跑起来的产品');
  const stats = [['84', '项后端自动化测试'], ['16', '步端到端测试，自动录制演示视频'], ['3 端', 'iOS / Android / Web 一套代码'], ['1 条', '命令部署到 Linux 服务器']];
  stats.forEach(([n, l], i) => {
    const x = 0.6 + i * 3.1;
    text(s, n, { x, y: 1.95, w: 2.9, h: 1.0, fontSize: 54, bold: true, color: C.accent1 });
    text(s, l, { x, y: 3.0, w: 2.8, h: 0.6, fontSize: 13, color: C.text2 });
  });
  const arch = [
    ['手机 App', 'Expo · React Native\n此刻 / 地点 / 听这里 / 分享 / 我的', HEX.lime],
    ['API 服务', 'Fastify · SQLite\n地点、歌单、权重、打卡、漂流瓶', HEX.mint],
    ['AI 层', '腾讯混元（文本 + 视觉）\n本地规则引擎兜底', HEX.violet],
    ['QQ 音乐', '一键跳转播放\n（规划：曲库与播放 SDK）', HEX.sky],
  ];
  arch.forEach(([t, d, c], i) => {
    const x = 0.6 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.2, w: 2.75, h: 2.0, rectRadius: 0.18, fill: { color: c, transparency: 88 }, line: { color: c, transparency: 50, width: 1 }, objectName: 'arch ' + t });
    text(s, t, { x: x + 0.25, y: 4.42, w: 2.3, h: 0.45, fontSize: 18, bold: true, color: c });
    text(s, d, { x: x + 0.25, y: 5.0, w: 2.35, h: 1.0, fontSize: 12, color: C.text2, lineSpacingMultiple: 1.3 });
    if (i < arch.length - 1) text(s, '→', { x: x + 2.75, y: 4.95, w: 0.35, h: 0.5, fontSize: 20, color: C.text2, align: 'center' });
  });
  s.addNotes('完成度（25 秒）：这不是概念稿。后端 84 项自动化测试，前端 16 步端到端测试并自动录制了演示视频，一套代码覆盖 iOS、安卓和 Web，一条命令部署。架构上，App、API、AI 层分离，播放导流到 QQ 音乐。');

  // 9 商业价值
  pres.addSection({ title: '商业' });
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '商业' });
  head(s, '商业价值', '一个新的推荐维度：在哪听');
  const biz = [
    ['music', 'QQ 音乐 / TME', '新增“附近 · 此刻”入口：线下场景带来新的打开时机；明信片与漂流瓶形成社交裂变；播放全部导流到 QQ 音乐。'],
    ['business', '文旅、商圈与门店', '认领地点，发布官方“这里的声音”与店内 BGM；按热度曲线安排营销；地点画像就是一份声音版商圈报告。'],
    ['mic', '演出与音乐人', 'livehouse 与街头艺人的“现场”歌单成为宣传渠道，衔接演出票务；独立音乐人把歌投放到合适的地点。'],
    ['data', '独有数据资产', '“地点 × 时段 × 情绪 × 歌曲”的数据集，是现有平台没有的场景化推荐训练数据。'],
  ];
  biz.forEach(([ic, t, d], i) => {
    const x = 0.6 + (i % 2) * 6.15, y = 1.95 + Math.floor(i / 2) * 2.45;
    card(s, x, y, 5.9, 2.2, 'biz card ' + t);
    icon(s, ic, x + 0.3, y + 0.3, 0.7);
    text(s, t, { x: x + 1.2, y: y + 0.38, w: 4.4, h: 0.5, fontSize: 20, bold: true });
    text(s, d, { x: x + 1.2, y: y + 0.95, w: 4.45, h: 1.15, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.3 });
  });
  s.addNotes('商业价值（30 秒）：对 QQ 音乐，这是一个新的推荐维度“在哪听”，带来线下打开时机和社交裂变。对文旅、商圈和门店，可以认领地点、发布官方声音。对演出和音乐人，现场歌单就是宣传渠道，能衔接票务。最后，地点×时段×情绪×歌曲的数据，是平台独有的资产。');

  // 10 路线图
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '商业' });
  head(s, '路线图', '从一个 App，到 QQ 音乐里的一个入口');
  const road = [
    ['现在 · 已完成', HEX.lime, ['三类地点歌单与推荐权重', 'AI 读懂此刻 / 声音画像 / 帮我写 / 审核', '漂流瓶、打卡、明信片', '一键跳转 QQ 音乐']],
    ['下一步 · 3 个月', HEX.mint, ['接入 QQ 音乐曲库与播放 SDK', '听歌识曲自动记录“现场”', '在 2–3 个城市街区试点']],
    ['之后 · 6–12 个月', HEX.violet, ['商家 / 景区认领后台', '演出排期与票务联动', '城市声音地图与年度报告']],
  ];
  s.addShape(pres.shapes.LINE, { x: 0.9, y: 2.35, w: 11.6, h: 0, line: { color: 'FFFFFF', transparency: 75, width: 1.5 }, objectName: 'timeline' });
  road.forEach(([t, c, items], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.OVAL, { x: x + 0.15, y: 2.2, w: 0.3, h: 0.3, fill: { color: c }, line: { color: c }, objectName: 'dot ' + t });
    text(s, t, { x, y: 2.75, w: 3.8, h: 0.45, fontSize: 19, bold: true, color: c });
    card(s, x, 3.35, 3.85, 2.45, 'road card ' + t);
    text(s, items.map((it, j) => ({ text: it, options: { bullet: true, breakLine: j < items.length - 1 } })), { x: x + 0.25, y: 3.6, w: 3.4, h: 2.05, fontSize: 14, paraSpaceAfter: 10 });
  });
  text(s, '目标：成为 QQ 音乐里的「附近 · 此刻」入口，让每一次出门都有一首对的歌。', { x: 0.6, y: 6.2, w: 12, h: 0.45, fontSize: 18, bold: true, color: C.accent2 });
  s.addNotes('路线图（20 秒）：现在核心功能都已完成。下一步接入 QQ 音乐曲库和播放 SDK，用听歌识曲自动记录现场，并在两三个街区试点。之后开放商家和景区后台，联动演出票务，做城市声音地图。');

  // 11 结尾
  pres.addSection({ title: '结尾' });
  s = pres.addSlide({ masterName: 'COVER', sectionTitle: '结尾' });
  text(s, '每个地方，\n都有它的背景音乐。', { x: 0.8, y: 1.5, w: 7.5, h: 2.6, fontSize: 52, bold: true, color: C.accent1, lineSpacingMultiple: 1.15 });
  text(s, '此地有歌 —— 让下一个路过的人，听见你在这里听见的。', { x: 0.8, y: 4.35, w: 7.5, h: 0.5, fontSize: 18, color: C.text1 });
  text(s, `谢谢 · ${AUTHOR}`, { x: 0.8, y: 5.6, w: 7, h: 0.5, fontSize: 18, bold: true, color: C.text2 });
  phone(s, '06-scene-picks', 9.4, 0.9, 5.7);
  s.addNotes('结尾（15 秒）：每个地方，都有它的背景音乐。《此地有歌》让下一个路过的人，听见你在这里听见的。谢谢大家，欢迎提问。');

  await pres.writeFile({ fileName: OUT });
  try {
    const { applyTheme } = require(process.env.APPLY_THEME || 'apply_theme');
    await applyTheme(OUT, THEME);
  } catch (e) {
    console.warn('未写入主题色（可选）：', e.message);
  }
  console.log('已生成', OUT);
}

renderAssets()
  .then(build)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => fs.rmSync(TMP, { recursive: true, force: true }));

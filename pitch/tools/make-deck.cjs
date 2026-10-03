/**
 * 生成 5 分钟路演 PPT：pitch/共鸣-路演.pptx
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
const OUT = process.argv[2] || path.join(ROOT, '共鸣-路演.pptx');
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
  headset: ['IoHeadsetOutline', HEX.sky], mute: ['IoVolumeMuteOutline', HEX.faint], ear: ['IoEarOutline', HEX.mint],
  walk: ['IoWalkOutline', HEX.lime], train: ['IoTrainOutline', HEX.sky], guitar: ['IoMusicalNoteOutline', HEX.pink],
  lock: ['IoLockClosedOutline', HEX.mint], finger: ['IoFingerPrintOutline', HEX.lime], earth: ['IoEarthOutline', HEX.violet],
  share: ['IoShareSocialOutline', HEX.sunset], hand: ['IoHandLeftOutline', HEX.sunset],
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
  pres.title = '共鸣 · 路演';
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
        { text: { text: '共鸣 · 此地有歌 · Build With AI 腾讯音乐首届高校 AI Hackathon', options: { x: 0.6, y: 7.0, w: 6, h: 0.3, fontSize: 9, color: C.text2, margin: 0 } } },
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
  text(s, [{ text: 'Build With ', options: { color: C.text1 } }, { text: 'AI', options: { color: C.accent5 } }, { text: '  ·  腾讯音乐首届高校 AI Hackathon  ·  赛道② 创新音乐产品', options: { color: C.text2, fontSize: 14, bold: false } }], { x: 0.7, y: 0.6, w: 9, h: 0.4, fontSize: 18, bold: true });
  text(s, '此地有歌 · MusicHere', { x: 0.7, y: 1.75, w: 6, h: 0.4, fontSize: 16, bold: true, color: C.text2, charSpacing: 2 });
  text(s, '共鸣', { x: 0.7, y: 2.15, w: 6.2, h: 1.5, fontSize: 96, bold: true, color: C.accent1 });
  text(s, '让世界为你的歌伴奏', { x: 0.7, y: 3.75, w: 6.2, h: 0.6, fontSize: 28, color: C.text1 });
  text(s, '降噪把世界关在外面，通透把世界放进来——\n共鸣让世界成为你这首歌的一部分。', { x: 0.7, y: 4.55, w: 6.0, h: 0.9, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.3 });
  chip(s, '对拍', 0.7, 5.65, HEX.lime, 1.0);
  chip(s, '定调', 1.85, 5.65, HEX.violet, 1.0);
  chip(s, '入景', 3.0, 5.65, HEX.sky, 1.0);
  text(s, `团队：${AUTHOR}`, { x: 0.7, y: 6.6, w: 6, h: 0.35, fontSize: 12, color: C.text2 });
  phone(s, '10-place', 6.75, 1.55, 5.0);
  phone(s, 'r2-scene', 10.35, 1.55, 5.0);
  phone(s, 'r1-locked', 8.55, 1.1, 5.0);
  s.addNotes('开场（20 秒）：大家好，我们的作品叫《共鸣》。耳机今天有两种模式：降噪把世界关在外面，通透把世界放进来。我们做了第三种——让世界为你的歌伴奏。');

  // 2 洞察
  pres.addSection({ title: '洞察' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '洞察' });
  head(s, '问题洞察', '你的歌和你身边的世界，是两条互不相干的声轨');
  const modes = [
    ['mute', '降噪', '把世界关在外面', '安静了，但你和街道断开了', HEX.faint],
    ['ear', '通透', '把世界原样放进来', '听得见了，但脚步和鼓点永远错开，轰鸣和旋律互相打架', HEX.sky],
    ['pulse', '共鸣', '让世界成为这首歌的一部分', '歌跟上世界的拍子、落在世界的调上：脚步踩在鼓点上，嗡鸣成了和声', HEX.lime],
  ];
  modes.forEach(([ic, t, sub, d, c], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 2.0, 3.85, 3.2, 'mode ' + t);
    icon(s, ic, x + 0.35, 2.35, 0.75);
    text(s, t, { x: x + 1.3, y: 2.45, w: 2.3, h: 0.55, fontSize: 26, bold: true, color: c });
    text(s, sub, { x: x + 0.35, y: 3.4, w: 3.2, h: 0.45, fontSize: 16, bold: true });
    text(s, d, { x: x + 0.35, y: 4.0, w: 3.2, h: 1.6, fontSize: 13.5, color: C.text2, lineSpacingMultiple: 1.35 });
  });
  text(s, '通勤、散步、跑步是戴耳机最多的时刻，却也是音乐和环境冲突最大的时刻。', { x: 0.6, y: 5.75, w: 12, h: 0.45, fontSize: 18, bold: true, color: C.accent1 });
  s.addNotes('洞察（35 秒）：通勤、散步、跑步，是我们戴耳机最多的时刻。降噪让你和街道断开，通透让你听得见，但脚步和鼓点永远错开，地铁的轰鸣和旋律互相打架。音乐产品看你是谁、几点、心情如何，却从来不“听”你身边在发生什么。');

  // 3 三件事
  pres.addSection({ title: '方案' });
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '方案' });
  head(s, '解决方案', '共鸣模式：三件事，实时发生');
  const three = [
    ['pulse', '对拍', '听出脚步、转向灯、车轮、街头艺人的节奏；歌的速度平滑滑过去，每一拍落在世界的拍点上'],
    ['music', '定调', '听出发动机的嗡鸣、风铃、街头艺人弹的调；歌移调，让嗡鸣成为新调的主音或属音'],
    ['camera', '入景', '拍一下眼前，AI 按画面调混响空间、音色明暗、编配密度和大小调'],
  ];
  three.forEach(([ic, t, d], i) => {
    const y = 1.95 + i * 1.45;
    icon(s, ic, 0.6, y, 0.8);
    text(s, t, { x: 1.65, y: y + 0.02, w: 5.6, h: 0.45, fontSize: 22, bold: true });
    text(s, d, { x: 1.65, y: y + 0.52, w: 5.6, h: 0.8, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.3 });
  });
  text(s, '环境声只在手机本机实时分析，不上传、不保存。', { x: 0.6, y: 6.45, w: 7, h: 0.35, fontSize: 13, bold: true, color: C.accent2 });
  phone(s, 'r1-locked', 8.2, 1.45, 5.3);
  text(s, '紫：世界的拍子\n青柠：歌的拍子\n两根指针重合 = 已对拍', { x: 11.0, y: 2.0, w: 2.0, h: 1.2, fontSize: 11, color: C.text2, lineSpacingMultiple: 1.3 });
  s.addNotes('方案（35 秒）：共鸣模式做三件事。对拍：听出环境里的节奏，歌的速度平滑滑过去，每一拍落在世界的拍点上。定调：听出环境里持续的音高，歌移调过去。入景：拍一下眼前，AI 调混响、明暗和编配。右边的调性轮上，紫色指针是世界的拍子，青柠是歌的拍子，重合就是对上了。所有环境声都只在本机分析，不上传。');

  // 3b 三种模式 + 对比
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '方案' });
  head(s, '一个引擎，三种模式', '街头 · 跑步 · 声景');
  phone(s, 'm1-run-guide', 0.6, 1.85, 4.55);
  phone(s, 'm3-scape', 2.85, 1.85, 4.55);
  text(s, '跑步', { x: 0.6, y: 6.5, w: 2.2, h: 0.3, fontSize: 11, bold: true, color: C.accent1, align: 'center' });
  text(s, '声景', { x: 2.85, y: 6.5, w: 2.2, h: 0.3, fontSize: 11, bold: true, color: C.accent5, align: 'center' });
  const th = (t, c) => ({ text: t, options: { bold: true, color: c, fill: { color: HEX.surface2 }, fontSize: 12.5 } });
  const td = (t, hl = false) => ({ text: t, options: { color: hl ? HEX.lime : HEX.text, bold: hl, fill: { color: HEX.surface }, fontSize: 11.5 } });
  const lbl = (t) => ({ text: t, options: { color: HEX.sub, bold: true, fill: { color: HEX.surface }, fontSize: 11.5 } });
  s.addTable(
    [
      [th('', HEX.sub), th('Spotify Running', HEX.sub), th('Endel', HEX.sub), th('共鸣', HEX.lime)],
      [lbl('跟步频'), td('挑同速度的歌'), td('运动状态影响声景'), td('一首歌里逐拍对齐相位 + 合拍率', true)],
      [lbl('主动引导'), td('无'), td('无'), td('音乐先快 3%，带你到目标步频', true)],
      [lbl('听真实环境'), td('无'), td('不听（时间、天气、心率、运动）'), td('环境的节奏、嗡鸣决定拍子和根音', true)],
      [lbl('地点'), td('无'), td('只用来推算天气'), td('共鸣指纹：众包的城市节拍地图', true)],
      [lbl('放什么'), td('曲库里的歌'), td('只有生成的声景'), td('街头 / 跑步对齐你的歌；声景生成音乐', true)],
    ],
    { x: 5.35, y: 1.95, w: 7.4, colW: [1.25, 1.85, 1.95, 2.35], rowH: 0.62, border: { type: 'solid', color: '2A2F3D', pt: 0.75 }, valign: 'middle', margin: 0.08, fontFace: '+mn-lt' },
  );
  text(s, '同一套"听世界"的能力，覆盖一天里通勤、运动、工作和睡前四种场景。', { x: 5.35, y: 6.0, w: 7.4, h: 0.4, fontSize: 14, bold: true, color: C.accent1 });
  text(s, '对比依据各产品公开介绍；Spotify Running 已于 2018 年前后下线。', { x: 5.35, y: 6.45, w: 7.4, h: 0.3, fontSize: 10, color: C.text2 });
  s.addNotes('三种模式（35 秒）：同一个引擎有三种用法。跑步时它数你的步频，自动挑最合拍的歌，锁在你的脚步上；设了目标，音乐先快 3% 把你带上去。声景不放歌，用时间、天气、步子和身边的嗡鸣实时生成。和 Spotify Running 比，我们不只是挑同速度的歌，而是在一首歌里逐拍对齐，还会主动引导；和 Endel 比，我们会听真实的环境，根音跟着街上的嗡鸣走。');

  // 4 对拍原理 + 实测
  pres.addSection({ title: '技术' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '技术' });
  head(s, '对拍怎么做到的', '不是换一首歌，而是在一首歌里面对齐拍子');
  const chain = [
    ['起音检测', 'AudioWorklet 每 10.7 ms 算低频 / 全频能量的跳变'],
    ['速度', '最近 6 秒自相关，强弱拍纠错，抛物线插值到小数拍'],
    ['相位', '「梳子」滑动找最近一拍，近拍权重更高'],
    ['锁相', '速度每拍滑 35%，相位每拍最多修正 6%；减掉输出延迟'],
  ];
  chain.forEach(([t, d], i) => {
    const y = 1.95 + i * 1.12;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.6, y, w: 5.6, h: 0.95, rectRadius: 0.14, fill: { color: HEX.surface, transparency: 10 }, line: { color: HEX.violet, transparency: 60, width: 1 }, objectName: 'chain ' + t });
    text(s, `${i + 1}`, { x: 0.8, y: y + 0.22, w: 0.4, h: 0.5, fontSize: 22, bold: true, color: C.accent5 });
    text(s, t, { x: 1.3, y: y + 0.12, w: 4.7, h: 0.35, fontSize: 15, bold: true });
    text(s, d, { x: 1.3, y: y + 0.5, w: 4.75, h: 0.4, fontSize: 11.5, color: C.text2 });
  });
  s.addChart(
    pres.charts.LINE,
    [{ name: '相位差（毫秒）', labels: ['5 秒', '7.5 秒', '10 秒', '12.5 秒', '15 秒'], values: [153, 34, 0, 1, 2] }],
    {
      x: 6.7, y: 1.85, w: 6.1, h: 4.3,
      showTitle: true, title: '实测：开启后歌曲与脚步的相位差', titleFontSize: 14, titleColor: HEX.text, titleFontFace: '+mn-lt',
      chartColors: [HEX.lime], lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 8,
      showValue: true, dataLabelPosition: 't', dataLabelColor: HEX.text, dataLabelFontSize: 11, dataLabelFontFace: '+mn-lt',
      catAxisLabelColor: HEX.sub, valAxisLabelColor: HEX.sub, catAxisLabelFontFace: '+mn-lt', valAxisLabelFontFace: '+mn-lt',
      valGridLine: { color: '2A2F3D', size: 0.5 }, catGridLine: { style: 'none' }, showLegend: false,
      valAxisMinVal: 0, valAxisMaxVal: 180,
    },
  );
  text(s, '浏览器实测（合成街头声：112 BPM 脚步 + 110 Hz 嗡鸣）。录下的片段里，锁定后脚步与鼓点合为同一个起音峰。', { x: 6.7, y: 6.25, w: 6.1, h: 0.45, fontSize: 10.5, color: C.text2, lineSpacingMultiple: 1.2 });
  s.addNotes('对拍原理（40 秒）：四步。AudioWorklet 每 10 毫秒算一次起音强度；最近 6 秒做自相关得到速度，并纠正强弱拍造成的慢一倍；用梳状滑动找到最近一拍的相位；最后逐拍锁相——速度每拍滑 35%，相位每拍最多修 6%，所以听起来是被世界带着走，不是跳拍。右边是浏览器实测：开启约 5 秒锁定，相位差从 150 毫秒收敛到 0 到 2 毫秒。');

  // 5 定调 + 入景 + 原创曲
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '技术' });
  head(s, '定调与入景', '落在世界的调上，长成眼前的样子');
  card(s, 0.6, 1.95, 6.05, 4.7, 'key card');
  icon(s, 'music', 0.9, 2.2, 0.6);
  text(s, '定调', { x: 1.7, y: 2.27, w: 3, h: 0.45, fontSize: 20, bold: true });
  const keySteps = [
    '16384 点频谱 → 只取局部峰值 → 折叠成 12 个音级',
    '一个音级压过其他：嗡鸣（发动机、风铃、空调）',
    '能量分散但像某个调：Krumhansl 轮廓识别 24 个调（街头艺人）',
    '嗡鸣作新调的主音或属音，取移动最少的；移调只在小节线生效',
  ];
  text(s, keySteps.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < keySteps.length - 1 } })), { x: 0.9, y: 3.0, w: 5.5, h: 2.2, fontSize: 13, paraSpaceAfter: 8 });
  text(s, '例：110 Hz 嗡鸣 → A；《夜行》E 小调 → D 小调（A 是属音，只移 2 个半音）', { x: 0.9, y: 5.55, w: 5.5, h: 0.8, fontSize: 13, bold: true, color: C.accent1, lineSpacingMultiple: 1.25 });
  card(s, 6.85, 1.95, 5.9, 2.25, 'scene card');
  icon(s, 'camera', 7.15, 2.2, 0.6);
  text(s, '入景', { x: 7.95, y: 2.27, w: 3, h: 0.45, fontSize: 20, bold: true });
  text(s, '腾讯混元看图 → 能量、效价、情绪；画面明暗在本机计算；地点类型决定空间。\n→ 编配密度 · 低通明暗 · 大小调 · 混响（小房间 / 开阔户外 / 隧道 / 现场）', { x: 7.15, y: 2.95, w: 5.35, h: 1.15, fontSize: 12.5, color: C.text2, lineSpacingMultiple: 1.3 });
  card(s, 6.85, 4.4, 5.9, 2.25, 'synth card');
  icon(s, 'layers', 7.15, 4.65, 0.6);
  text(s, '正式曲目', { x: 7.95, y: 4.72, w: 3.5, h: 0.45, fontSize: 20, bold: true });
  text(s, 'Demo：5 首按级数记谱的实时合成原创曲。正式曲目：离线算节拍和调，实时变速变调（±10–15% / ±2–3 半音内）；差得更远就按速度和调选歌。', { x: 7.15, y: 5.4, w: 5.35, h: 1.15, fontSize: 12.5, color: C.text2, lineSpacingMultiple: 1.3 });
  s.addNotes('定调与入景（35 秒）：定调把频谱的峰值折叠成 12 个音级——一个音级压过其他就是嗡鸣，能量分散但像某个调就用调性轮廓识别。比如 110 赫兹的嗡鸣是 A，《夜行》就从 E 小调移到 D 小调，让 A 成为属音，只移 2 个半音。入景用混元看图，调混响、明暗、编配和大小调。Demo 用实时合成的原创曲，速度和调都能无损变化；正式版接 QQ 音乐的分轨。');

  // 6 共鸣片段 + 共鸣指纹
  pres.addSection({ title: '传播' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '传播' });
  head(s, '从一个人的耳机，到一座城市的节拍', '共鸣片段 · 共鸣指纹');
  phone(s, 'r3-print', 0.6, 1.8, 5.0);
  phone(s, '10-place', 3.05, 1.8, 5.0);
  const spread = [
    ['share', '共鸣片段', '把「世界 + 你的歌」录成 15 秒：环境声和音乐按耳朵听到的时刻对齐。每条街、每一刻都独一无二，天然适合分享。'],
    ['finger', '共鸣指纹', '在现场贡献这里的拍子和调——只存数字，不存声音。多人数据折叠八度后取中位数，调取多数票。'],
    ['earth', '城市节拍地图', '下一个人来到江边步道，歌一开始就按「112 BPM · A 嗡鸣」预调；地点越热门，体验越好。'],
  ];
  spread.forEach(([ic, t, d], i) => {
    const y = 1.9 + i * 1.5;
    icon(s, ic, 5.95, y, 0.7);
    text(s, t, { x: 6.9, y: y - 0.02, w: 5.8, h: 0.42, fontSize: 19, bold: true });
    text(s, d, { x: 6.9, y: y + 0.45, w: 5.8, h: 0.95, fontSize: 13, color: C.text2, lineSpacingMultiple: 1.3 });
  });
  s.addNotes('传播（30 秒）：共鸣片段把世界和你的歌一起录下来，每一条都独一无二，天然适合分享。共鸣指纹让在场的人贡献这里的拍子和调，只存数字不存声音，慢慢拼出一张城市的节拍地图——下一个人到江边，歌一开始就在调上。');

  // 7 为什么会主动用
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '传播' });
  head(s, '为什么会主动用', '不改变习惯，只是多了一个开关');
  const uses = [
    ['walk', '散步 · 跑步', '脚步就是节拍器：歌锁在步子上；想跑快一点，音乐先快 3% 带你'],
    ['train', '通勤', '列车的节奏、进站的轰鸣，从噪音变成伴奏'],
    ['guitar', '街头艺人', '他弹 G 大调，你的歌也到 G 大调；还能把现场记进这个地点'],
    ['hand', '专注 · 入睡', '声景：时间、天气和窗外的嗡鸣，生成只属于此刻的背景声'],
  ];
  uses.forEach(([ic, t, d], i) => {
    const x = 0.6 + (i % 2) * 6.15, y = 1.95 + Math.floor(i / 2) * 2.3;
    card(s, x, y, 5.9, 2.05, 'use ' + t);
    icon(s, ic, x + 0.3, y + 0.3, 0.7);
    text(s, t, { x: x + 1.2, y: y + 0.38, w: 4.4, h: 0.5, fontSize: 20, bold: true });
    text(s, d, { x: x + 1.2, y: y + 0.95, w: 4.45, h: 0.95, fontSize: 14, color: C.text2, lineSpacingMultiple: 1.3 });
  });
  text(s, '结果立刻可感知：踩在鼓点上的那一刻，就是这个产品的全部说服力。', { x: 0.6, y: 6.6, w: 12, h: 0.35, fontSize: 15, bold: true, color: C.accent1 });
  s.addNotes('为什么会主动用（25 秒）：散步跑步时脚步就是节拍器；通勤时列车的轰鸣变成伴奏；遇到街头艺人，你的歌会转到他的调上；等人发呆时，转向灯和雨声都有了音乐性。不需要改变任何习惯，结果立刻可感知。');

  // 8 完成度
  pres.addSection({ title: '完成度' });
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '完成度' });
  head(s, '完成度', '已经在浏览器里跑起来了');
  const stats = [['~5 s', '锁定环境拍子'], ['0–2 ms', '锁定后的相位差'], ['34 + 98', '前端单测 + 服务端测试'], ['23 步', '端到端测试（含假麦克风）']];
  stats.forEach(([n, l], i) => {
    const x = 0.6 + i * 3.1;
    text(s, n, { x, y: 1.95, w: 2.95, h: 1.0, fontSize: 44, bold: true, color: C.accent1 });
    text(s, l, { x, y: 2.95, w: 2.8, h: 0.6, fontSize: 13, color: C.text2 });
  });
  const arch = [
    ['输入（本机）', '麦克风 · 加速度计 · 相机', HEX.sky],
    ['分析（本机）', 'AudioWorklet 起音\n16384 点 FFT 色度', HEX.violet],
    ['引擎（本机）', '实时合成 · 锁相 · 移调\n入景混音 · 侧链 · 录制', HEX.lime],
    ['服务端', '只收共鸣指纹的数字\n地点、AI 场景理解', HEX.mint],
  ];
  arch.forEach(([t, d, c], i) => {
    const x = 0.6 + i * 3.1;
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.1, w: 2.75, h: 2.1, rectRadius: 0.18, fill: { color: c, transparency: 88 }, line: { color: c, transparency: 50, width: 1 }, objectName: 'arch ' + t });
    text(s, t, { x: x + 0.25, y: 4.32, w: 2.3, h: 0.45, fontSize: 17, bold: true, color: c });
    text(s, d, { x: x + 0.25, y: 4.9, w: 2.35, h: 1.1, fontSize: 12, color: C.text2, lineSpacingMultiple: 1.3 });
    if (i < arch.length - 1) text(s, '→', { x: x + 2.75, y: 4.9, w: 0.35, h: 0.5, fontSize: 20, color: C.text2, align: 'center' });
  });
  text(s, '端到端测试用合成的街头声当麦克风、合成的加速度当跑步，在真实浏览器里断言对拍、定调、步频引导、声景与片段；演示视频就是它录下来的。', { x: 0.6, y: 6.45, w: 12, h: 0.4, fontSize: 11.5, color: C.text2 });
  s.addNotes('完成度（25 秒）：这一切已经在浏览器里跑起来了：约 5 秒锁定，锁定后相位差 0 到 2 毫秒。DSP 有 19 项单元测试，服务端 98 项；端到端测试用合成的街头声当麦克风，在真实浏览器里验证对拍和定调。分析和合成全在本机，服务端只收指纹的几个数字。');

  // 9 对照评审标准
  pres.addSection({ title: '价值' });
  s = pres.addSlide({ masterName: 'CONTENT_B', sectionTitle: '价值' });
  head(s, '对照评审标准', '用户价值 · 可行性 · 创新性');
  const crit = [
    ['music', '用户价值', HEX.lime, ['通勤、跑步、专注、入睡全天可用', '零学习成本，开关一开立刻可感知', '跑步有合拍率、能被音乐带着提速', '环境声不上传，隐私友好']],
    ['shield', '可行性', HEX.mint, ['纯浏览器实时运行，已可部署上线', '实测约 5 秒锁定，相位差 0–2 ms', '34 项前端单测 + 98 项服务端 + 23 步 e2e', '正式曲目：离线节拍 / 调 + 实时变速变调，太远就换歌']],
    ['sparkles', '创新性', HEX.violet, ['耳机的第三种模式：与环境合奏', '在一首歌里连续对齐拍子相位与调', '会主动引导步频；会听环境的声景', '众包的城市节拍地图']],
  ];
  crit.forEach(([ic, t, c, items], i) => {
    const x = 0.6 + i * 4.1;
    card(s, x, 1.95, 3.85, 3.85, 'criteria ' + t);
    icon(s, ic, x + 0.3, 2.25, 0.62);
    text(s, t, { x: x + 1.1, y: 2.33, w: 2.5, h: 0.5, fontSize: 21, bold: true, color: c });
    text(s, items.map((it, j) => ({ text: it, options: { bullet: true, breakLine: j < items.length - 1 } })), { x: x + 0.3, y: 3.2, w: 3.3, h: 2.45, fontSize: 13.5, paraSpaceAfter: 10, lineSpacingMultiple: 1.15 });
  });
  text(s, '一句话：降噪和通透之后，耳机的下一个模式是「共鸣」。', { x: 0.6, y: 6.15, w: 12, h: 0.45, fontSize: 18, bold: true, color: C.accent1 });
  s.addNotes('对照评审标准（30 秒）：用户价值上，它改善的是每天最高频的听歌场景，零学习成本、立刻可感知。可行性上，纯浏览器实时运行、已可上线、有实测数据和完整测试。创新性上，这是耳机的第三种模式，在一首歌里连续对齐拍子和调，并且众包出城市的节拍地图。');

  // 10 路线图
  s = pres.addSlide({ masterName: 'CONTENT_A', sectionTitle: '价值' });
  head(s, '路线图', '从一个网页，到 QQ 音乐播放器里的一个模式');
  const road = [
    ['现在 · 已完成', HEX.lime, ['街头：对拍 / 定调 / 入景', '跑步：步频选歌、节拍引导、合拍率', '声景：时间 / 天气 / 步子 / 嗡鸣生成', '共鸣片段与共鸣指纹']],
    ['下一步 · 3 个月', HEX.mint, ['正式曲目：离线节拍 / 调 + 实时变速变调', '原生端：react-native-audio-api', '真机与蓝牙耳机延迟校准', '片段分享改为链接 + 参数']],
    ['之后 · 6–12 个月', HEX.violet, ['与 TWS 耳机通透模式联动', '演出现场：观众手机与舞台同拍', '开放城市节拍地图']],
  ];
  s.addShape(pres.shapes.LINE, { x: 0.9, y: 2.35, w: 11.6, h: 0, line: { color: 'FFFFFF', transparency: 75, width: 1.5 }, objectName: 'timeline' });
  road.forEach(([t, c, items], i) => {
    const x = 0.6 + i * 4.1;
    s.addShape(pres.shapes.OVAL, { x: x + 0.15, y: 2.2, w: 0.3, h: 0.3, fill: { color: c }, line: { color: c }, objectName: 'dot ' + t });
    text(s, t, { x, y: 2.75, w: 3.8, h: 0.45, fontSize: 19, bold: true, color: c });
    card(s, x, 3.35, 3.85, 2.55, 'road card ' + t);
    text(s, items.map((it, j) => ({ text: it, options: { bullet: true, breakLine: j < items.length - 1 } })), { x: x + 0.25, y: 3.6, w: 3.4, h: 2.15, fontSize: 14, paraSpaceAfter: 10 });
  });
  text(s, '目标：成为 QQ 音乐播放器里与「降噪」「通透」并列的第三个开关。', { x: 0.6, y: 6.25, w: 12, h: 0.45, fontSize: 18, bold: true, color: C.accent2 });
  s.addNotes('路线图（20 秒）：现在实时引擎、原创曲、片段和指纹都已完成。下一步接入 QQ 音乐分轨加实时变速变调，做原生端和蓝牙耳机的延迟校准。之后和耳机的通透模式联动，让演出现场观众的手机和舞台同拍。目标是成为播放器里和降噪、通透并列的第三个开关。');

  // 11 结尾
  pres.addSection({ title: '结尾' });
  s = pres.addSlide({ masterName: 'COVER', sectionTitle: '结尾' });
  text(s, '让世界\n为你的歌伴奏。', { x: 0.8, y: 1.5, w: 7.5, h: 2.6, fontSize: 56, bold: true, color: C.accent1, lineSpacingMultiple: 1.15 });
  text(s, '共鸣 —— 降噪和通透之后，耳机的第三种模式。', { x: 0.8, y: 4.35, w: 7.5, h: 0.5, fontSize: 18, color: C.text1 });
  text(s, `谢谢 · ${AUTHOR}`, { x: 0.8, y: 5.6, w: 7, h: 0.5, fontSize: 18, bold: true, color: C.text2 });
  phone(s, 'r1-locked', 9.4, 0.9, 5.7);
  s.addNotes('结尾（10 秒）：让世界为你的歌伴奏。共鸣，是降噪和通透之后，耳机的第三种模式。谢谢大家，欢迎提问——现场可以直接戴耳机体验。');

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

/**
 * 概念图：AI 眼镜上的「共鸣」——看向谁，就跟谁合奏。
 * 第一视角的黄昏街景（纯 SVG 绘制，不含任何照片素材）+ 眼镜 HUD。
 *
 *   node pitch/tools/make-glasses.cjs pitch/glasses-concept.jpg
 */
const { chromium } = require(require.resolve('playwright', { paths: [require('node:path').join(__dirname, '../../e2e')] }));
const path = require('node:path');

const out = process.argv[2] || path.join(__dirname, '..', 'glasses-concept.jpg');
const W = 1920;
const H = 1080;
const VX = 960; // 消失点
const VY = 560;

// 确定性随机
let seed = 11;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

// 天际线
let skyline = '';
let windows = '';
for (let x = -20; x < W + 40; ) {
  const w = 60 + rnd() * 110;
  const h = 70 + rnd() * 260 * (Math.abs(x - VX) / VX + 0.35);
  skyline += `<rect x="${x.toFixed(0)}" y="${(VY - h).toFixed(0)}" width="${w.toFixed(0)}" height="${(h + 4).toFixed(0)}" fill="#22183A"/>`;
  for (let wy = VY - h + 14; wy < VY - 10; wy += 22) {
    for (let wx = x + 10; wx < x + w - 12; wx += 18) {
      if (rnd() < 0.32) windows += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="7" height="10" fill="#FFC56B" opacity="${(0.35 + rnd() * 0.5).toFixed(2)}"/>`;
    }
  }
  x += w + 4;
}

// 地面的透视线
let floor = '';
for (let i = -14; i <= 14; i++) {
  const bx = VX + i * 150;
  floor += `<line x1="${VX}" y1="${VY}" x2="${bx}" y2="${H + 40}" stroke="#ffffff" stroke-opacity="0.045" stroke-width="2"/>`;
}
for (let k = 1; k < 9; k++) {
  const y = VY + (H - VY) * (k / 9) ** 1.8;
  floor += `<line x1="0" y1="${y.toFixed(0)}" x2="${W}" y2="${y.toFixed(0)}" stroke="#ffffff" stroke-opacity="0.04" stroke-width="2"/>`;
}

// 串灯
let lights = '';
for (const [y0, sag] of [[150, 90], [235, 70]]) {
  let d = `M -20 ${y0}`;
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const x = -20 + (i / 40) * (W + 40);
    const t = i / 40;
    const y = y0 + sag * 4 * t * (1 - t);
    d += ` L ${x.toFixed(0)} ${y.toFixed(0)}`;
    if (i % 2 === 0) pts.push([x, y + 8]);
  }
  lights += `<path d="${d}" stroke="#0E0A18" stroke-width="2" fill="none"/>`;
  for (const [x, y] of pts) lights += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="5" fill="#FFD27A"/><circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="16" fill="url(#bulb)"/>`;
}

// 一个人形剪影（脚底在 (x, y)，身高 h）
const person = (x, y, h, color, extra = '') => {
  const s = h / 300;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="${color}" ${extra}>
    <circle cx="0" cy="-268" r="24"/>
    <path d="M -34 -236 Q 0 -250 34 -236 L 42 -120 L 26 -118 L 22 -40 L 30 0 L 10 0 L 4 -96 L -4 -96 L -10 0 L -30 0 L -22 -40 L -26 -118 L -42 -120 Z"/>
  </g>`;
};

const BX = 1240; // 街头艺人
const BY = 745;
const busker = `
  <g>
    <!-- 地上打开的吉他盒 -->
    <path d="M ${BX - 190} ${BY + 26} L ${BX - 40} ${BY + 26} L ${BX - 56} ${BY + 64} L ${BX - 176} ${BY + 64} Z" fill="#1A1226" stroke="#FF9A5B" stroke-opacity="0.5" stroke-width="2"/>
    <circle cx="${BX - 130}" cy="${BY + 46}" r="5" fill="#FFC56B"/><circle cx="${BX - 104}" cy="${BY + 50}" r="4" fill="#FFC56B"/><circle cx="${BX - 86}" cy="${BY + 42}" r="4" fill="#FFC56B"/>
    <!-- 人 -->
    ${person(BX, BY, 320, '#140E20', 'stroke="#FF9A5B" stroke-opacity="0.55" stroke-width="5"')}
    <!-- 吉他 -->
    <g transform="translate(${BX + 18} ${BY - 150}) rotate(-62)">
      <ellipse cx="0" cy="18" rx="54" ry="40" fill="#3A2232" stroke="#FFB070" stroke-opacity="0.8" stroke-width="3"/>
      <ellipse cx="0" cy="-16" rx="40" ry="30" fill="#3A2232" stroke="#FFB070" stroke-opacity="0.8" stroke-width="3"/>
      <circle cx="0" cy="6" r="12" fill="#120C1A"/>
      <rect x="-6" y="-170" width="12" height="150" rx="3" fill="#2A1A26" stroke="#FFB070" stroke-opacity="0.6" stroke-width="2"/>
    </g>
    <!-- 小音箱 -->
    <rect x="${BX + 70}" y="${BY - 70}" width="70" height="78" rx="8" fill="#1A1226" stroke="#FF9A5B" stroke-opacity="0.45" stroke-width="2"/>
    <circle cx="${BX + 105}" cy="${BY - 32}" r="22" fill="#0F0A16" stroke="#FF9A5B" stroke-opacity="0.35" stroke-width="2"/>
  </g>`;

// 声波
let waves = '';
for (let i = 1; i <= 5; i++) {
  waves += `<path d="M ${BX + 70 + i * 34} ${BY - 300 - i * 6} A ${70 + i * 46} ${120 + i * 50} 0 0 1 ${BX + 70 + i * 34} ${BY - 70 + i * 6}" stroke="#B7F36B" stroke-width="3" fill="none" opacity="${(0.55 - i * 0.09).toFixed(2)}"/>`;
}

const html = `<html><head><style>
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;overflow:hidden;background:#07080C;font-family:"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;color:#F4F5F7;position:relative}
svg{position:absolute;inset:0}
.hud{position:absolute;color:#F4F5F7}
.glass{background:rgba(10,12,20,0.55);border:1.5px solid rgba(183,243,107,0.45);border-radius:22px;backdrop-filter:blur(6px);box-shadow:0 0 40px rgba(183,243,107,0.12)}
.k{font-size:20px;color:#A7ACB9;font-weight:700;letter-spacing:1px}
.v{font-size:42px;font-weight:900;color:#B7F36B;line-height:1.1;white-space:nowrap}
.s{font-size:20px;color:#C9CDD8;margin-top:6px;white-space:nowrap}
.k{white-space:nowrap}
.tag{position:absolute;font-size:20px;font-weight:800;padding:8px 16px;border-radius:999px;background:rgba(10,12,20,0.6);border:1.5px solid rgba(255,255,255,0.18);color:#8A90A0}
</style></head><body>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#140F30"/><stop offset="0.45" stop-color="#4A2A6A"/><stop offset="0.82" stop-color="#C46A6A"/><stop offset="1" stop-color="#F29A62"/>
    </linearGradient>
    <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2C2238"/><stop offset="1" stop-color="#0D0A14"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFD9A0" stop-opacity="0.95"/><stop offset="0.35" stop-color="#FF9A6A" stop-opacity="0.45"/><stop offset="1" stop-color="#FF9A6A" stop-opacity="0"/></radialGradient>
    <radialGradient id="bulb" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFD27A" stop-opacity="0.55"/><stop offset="1" stop-color="#FFD27A" stop-opacity="0"/></radialGradient>
    <radialGradient id="lamp" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FFE3A8" stop-opacity="0.5"/><stop offset="1" stop-color="#FFE3A8" stop-opacity="0"/></radialGradient>
    <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.7"/></radialGradient>
    <linearGradient id="beam" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#B7F36B" stop-opacity="0.16"/><stop offset="1" stop-color="#B7F36B" stop-opacity="0.02"/></linearGradient>
    <radialGradient id="spot" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#FF9A5B" stop-opacity="0.35"/><stop offset="1" stop-color="#FF9A5B" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${VY + 10}" fill="url(#sky)"/>
  <circle cx="1480" cy="${VY - 40}" r="260" fill="url(#sun)"/>
  <circle cx="1480" cy="${VY - 40}" r="70" fill="#FFE2B0" opacity="0.85"/>
  ${skyline}${windows}
  <rect y="${VY}" width="${W}" height="${H - VY}" fill="url(#ground)"/>
  ${floor}
  ${lights}
  <!-- 路灯 -->
  <rect x="300" y="300" width="8" height="${VY + 120 - 300}" fill="#0E0A16"/><circle cx="304" cy="300" r="12" fill="#FFE3A8"/><circle cx="304" cy="300" r="90" fill="url(#lamp)"/>
  <rect x="1660" y="250" width="10" height="${VY + 200 - 250}" fill="#0E0A16"/><circle cx="1665" cy="250" r="14" fill="#FFE3A8"/><circle cx="1665" cy="250" r="110" fill="url(#lamp)"/>
  <!-- 广播喇叭 -->
  <rect x="1650" y="300" width="34" height="22" rx="4" fill="#0E0A16"/><path d="M 1684 300 L 1712 288 L 1712 334 L 1684 322 Z" fill="#0E0A16"/>
  <!-- 远处的车 -->
  <g transform="translate(150 ${VY + 70})"><rect x="0" y="0" width="220" height="56" rx="18" fill="#120E1C"/><rect x="36" y="-26" width="130" height="34" rx="12" fill="#120E1C"/><circle cx="214" cy="26" r="8" fill="#FFF2C0"/><circle cx="214" cy="26" r="40" fill="url(#lamp)"/></g>
  <!-- 行人 -->
  ${person(560, VY + 150, 150, '#120E1C')}${person(650, VY + 160, 140, '#120E1C')}${person(820, VY + 110, 110, '#150F22')}${person(1520, VY + 140, 150, '#120E1C')}
  <!-- 视线方向的拾音波束 -->
  <path d="M 860 ${H} L 1040 ${H} L ${BX + 210} ${BY - 380} L ${BX - 230} ${BY - 380} Z" fill="url(#beam)"/>
  <ellipse cx="${BX}" cy="${BY + 40}" rx="300" ry="60" fill="url(#spot)"/>
  ${busker}
  ${waves}
  <!-- 取景框 -->
  <g stroke="#B7F36B" stroke-width="5" fill="none" stroke-linecap="round">
    <path d="M ${BX - 230} ${BY - 330} v -40 h 40"/><path d="M ${BX + 230} ${BY - 330} v -40 h -40"/>
    <path d="M ${BX - 230} ${BY + 40} v 40 h 40"/><path d="M ${BX + 230} ${BY + 40} v 40 h -40"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#vig)"/>
</svg>

<div class="hud glass" style="left:${BX - 230}px;top:${BY - 440}px;padding:10px 20px;border-radius:999px;font-size:24px;font-weight:900;color:#B7F36B">◉ 看向：街头艺人 · 正在跟他合奏</div>
<div class="tag" style="left:150px;top:${VY + 150}px">车流 · 已忽略</div>
<div class="tag" style="left:1560px;top:350px">广播 · 已忽略</div>

<div class="hud glass" style="left:56px;top:48px;padding:18px 24px">
  <div style="font-size:30px;font-weight:900">共鸣 · 街头</div>
  <div class="s">跟随：视线方向的声源</div>
</div>
<div class="hud" style="right:60px;top:56px;text-align:right">
  <div style="font-size:30px;font-weight:900">18:42</div>
  <div class="s">江边步道 · 黄昏</div>
</div>

<div class="hud glass" style="left:50%;transform:translateX(-50%);bottom:40px;display:flex;gap:40px;padding:20px 36px;align-items:center;white-space:nowrap">
  <svg width="96" height="96" viewBox="0 0 96 96" style="position:static">
    <circle cx="48" cy="48" r="38" stroke="rgba(255,255,255,0.18)" stroke-width="3" fill="none"/>
    <circle cx="74" cy="22" r="10" fill="#A08BFF"/><circle cx="74" cy="22" r="7" fill="#B7F36B"/>
  </svg>
  <div><div class="k">已锁定他的拍子</div><div class="v">112 BPM</div><div class="s">相位差 3 ms</div></div>
  <div style="width:1.5px;align-self:stretch;background:rgba(255,255,255,0.15)"></div>
  <div><div class="k">落在他的调上</div><div class="v">D 小调</div><div class="s">《夜行》E 小调 → −2 半音</div></div>
  <div style="width:1.5px;align-self:stretch;background:rgba(255,255,255,0.15)"></div>
  <div><div class="k">入景</div><div class="v" style="color:#A08BFF">开阔户外</div><div class="s">黄昏 · 混响 1.9 s</div></div>
</div>
<div class="hud" style="right:24px;bottom:12px;font-size:16px;color:rgba(255,255,255,0.4)">概念示意 · 非实拍</div>
</body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(html);
  await p.waitForTimeout(300);
  await p.screenshot({ path: out, type: 'jpeg', quality: 92 });
  await b.close();
  console.log('已生成', out);
})();

/**
 * 设计语言：「城市夜色 × 黑胶 × 光晕」
 *
 * - 近黑的底色，让封面图和光晕成为主角；
 * - 主色是青柠→薄荷的「声波」渐变（呼应 QQ 音乐的绿），按钮上用深色字，干净有力；
 * - AI 相关一律用「极光」渐变（紫→蓝→青），一眼能认出哪里是 AI 在工作；
 * - 三类歌曲、14 种情绪各有专属色，信息靠颜色也能读。
 */

export const colors = {
  bg: '#07080C',
  bg2: '#0C0E14',
  surface: '#12151D',
  surface2: '#191D27',
  surface3: '#222735',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
  text: '#F4F5F7',
  sub: '#A7ACB9',
  faint: '#6B7181',
  ink: '#07080C',
  lime: '#B7F36B',
  mint: '#3EE6C1',
  sky: '#5CC8FF',
  sunset: '#FF8A5B',
  violet: '#9A8CFF',
  pink: '#FF7AC6',
  gold: '#FFC85C',
  red: '#FF5C7A',
  green: '#5BE49B',
};

export const gradients = {
  brand: ['#D2F76A', '#7FF0A0', '#3EE6C1'] as const,
  aurora: ['#A08BFF', '#5CC8FF', '#3EE6C1'] as const,
  sunset: ['#FFB067', '#FF7A7A', '#FF5CA8'] as const,
  ink: ['rgba(7,8,12,0)', 'rgba(7,8,12,0.55)', 'rgba(7,8,12,0.96)'] as const,
};

export const kindColor = {
  vibe: colors.mint,
  frequent: colors.sky,
  live: colors.sunset,
} as const;

export const moodColor: Record<string, string> = {
  惬意: '#F5C26B',
  治愈: '#8EE3B5',
  怀旧: '#E0AE7A',
  浪漫: '#FF8FB1',
  热血: '#FF6B5B',
  欢快: '#FFD84D',
  静谧: '#8FB8FF',
  孤独: '#A3ABCF',
  伤感: '#8C93FF',
  自由: '#5CD6FF',
  夜色: '#AE90FF',
  律动: '#FF7AE0',
  清新: '#B7F36B',
  梦幻: '#D2B3FF',
};

export const radius = { xs: 6, sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const font = {
  display: { fontSize: 34, fontWeight: '900' as const, letterSpacing: -0.5, color: colors.text },
  h1: { fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.3, color: colors.text },
  h2: { fontSize: 20, fontWeight: '800' as const, color: colors.text },
  title: { fontSize: 17, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 15, lineHeight: 22, color: colors.text },
  sub: { fontSize: 13, lineHeight: 19, color: colors.sub },
  caption: { fontSize: 12, lineHeight: 16, color: colors.faint },
  label: { fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.2, color: colors.sub },
};

/** 稳定的字符串哈希，用于给歌曲/地点生成固定配色。 */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const ART_PALETTES: [string, string, string][] = [
  ['#FF8A5B', '#FF5CA8', '#6A3DE8'],
  ['#3EE6C1', '#5CC8FF', '#3D3DE8'],
  ['#B7F36B', '#3EE6C1', '#0E7C66'],
  ['#FFC85C', '#FF7A59', '#B0254F'],
  ['#9A8CFF', '#FF7AC6', '#3A1C71'],
  ['#5CC8FF', '#9A8CFF', '#1B2A6B'],
  ['#FF7AC6', '#FFB067', '#7A2A58'],
  ['#8EE3B5', '#5CD6FF', '#1F4E6B'],
];

/** 歌曲「封面」配色：没有真实专辑图时按歌名生成，同一首歌永远同一组颜色。 */
export function artPalette(key: string): [string, string, string] {
  return ART_PALETTES[hashString(key) % ART_PALETTES.length]!;
}

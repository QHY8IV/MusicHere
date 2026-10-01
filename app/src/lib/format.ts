import type { Category, EventType, Kind } from './api';

export const KIND_LABEL: Record<Kind, string> = {
  vibe: '应景',
  frequent: '常听',
  live: '现场',
};

export const KIND_HINT: Record<Kind, string> = {
  vibe: '这首歌放在这里特别有氛围',
  frequent: '在这里经常听到 / 大家常在这儿听',
  live: '在这里现场听到的：演唱会、即兴、街头艺人……',
};

export const KIND_ICON: Record<Kind, 'sparkles' | 'headset' | 'mic'> = {
  vibe: 'sparkles',
  frequent: 'headset',
  live: 'mic',
};

export const EVENT_LABEL: Record<EventType, string> = {
  concert: '演唱会',
  improv: '即兴演出',
  busker: '街头艺人',
  other: '其他现场',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  street: '街道',
  park: '公园',
  cafe: '咖啡馆',
  station: '车站',
  campus: '校园',
  shop: '商场店铺',
  venue: '演出场地',
  landmark: '地标',
  other: '其他',
};

export const MOODS = ['惬意', '热闹', '安静', '怀旧', '浪漫', '治愈'];

export function formatDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return '';
  if (m < 1000) return `${Math.max(1, Math.round(m / 10) * 10)} 米`;
  return `${(m / 1000).toFixed(1)} 公里`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 客户端预判能否打卡，规则需与服务端 checkinAllowanceM 一致。 */
export const checkinAllowanceM = (radiusM: number) => Math.max(radiusM, 100) + 50;

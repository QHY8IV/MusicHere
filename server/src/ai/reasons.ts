import type { PlaceSongDto } from '../services/placeSongs.ts';
import type { Mood } from './moods.ts';
import { hourDistance, timeLabel } from './time.ts';

/**
 * 推荐理由：全部来自真实数据（点赞数、在听人数、现场演出、时段分布、听众原话），
 * 不让模型编造证据。最多三句，用「·」连接。
 */
export function crowdReason(
  ps: PlaceSongDto,
  opts: { matched?: Mood[]; hour?: number; hours?: number[] | undefined },
): string {
  const parts: string[] = [];
  if (opts.matched && opts.matched.length) parts.push(`契合此刻的「${opts.matched.join('·')}」`);

  if (ps.kind === 'live' && ps.live?.performer) {
    parts.push(`${ps.live.performer}曾在这里现场演出`);
  } else if (ps.source === 'official') {
    parts.push('官方记录');
  } else if (ps.listeners >= 2) {
    parts.push(`近 30 天 ${ps.listeners} 人在这里听`);
  } else if (ps.likes >= 2) {
    parts.push(`${ps.likes} 人觉得它属于这里`);
  }

  if (opts.hour !== undefined && opts.hours && timeShare(opts.hours, opts.hour) >= 0.4) {
    parts.push(`${timeLabel(opts.hour)}最常被点播`);
  }

  if (ps.note && parts.length < 3) {
    const q = ps.note.length > 16 ? `${ps.note.slice(0, 16)}…` : ps.note;
    parts.push(`“${q}”`);
  }
  if (parts.length === 0) parts.push('有人把它留在了这里');
  return parts.slice(0, 3).join(' · ');
}

/** 直方图里落在 hour±1 小时内的事件占比（事件少于 3 个时视为没有时段规律）。 */
export function timeShare(hours: readonly number[], hour: number): number {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < 3) return 0;
  let near = 0;
  for (let h = 0; h < 24; h++) if (hourDistance(h, hour) <= 1) near += hours[h] ?? 0;
  return near / total;
}

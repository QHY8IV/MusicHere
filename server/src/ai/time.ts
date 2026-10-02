/** 用户所在时区的「几点」与时段名。数据库里存的是 UTC，统计时段时要换算。 */

export function localHour(date: Date, tz: string): number {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(date);
  return Number(h) % 24;
}

export function timeLabel(hour: number): string {
  if (hour >= 5 && hour < 8) return '清晨';
  if (hour >= 8 && hour < 11) return '上午';
  if (hour >= 11 && hour < 13) return '正午';
  if (hour >= 13 && hour < 17) return '午后';
  if (hour >= 17 && hour < 19) return '黄昏';
  if (hour >= 19 && hour < 23) return '夜晚';
  return '深夜';
}

/** 2 小时窗口的可读描述，例如 18 → 「黄昏 18–20 点」。 */
export function windowLabel(startHour: number): string {
  const end = (startHour + 2) % 24;
  return `${timeLabel(startHour)} ${startHour}–${end === 0 ? 24 : end} 点`;
}

/** 24 小时直方图里事件最多的连续 2 小时窗口；事件太少时返回 null。 */
export function peakWindow(hours: readonly number[], minEvents = 3): number | null {
  const total = hours.reduce((a, b) => a + b, 0);
  if (total < minEvents) return null;
  let best = 0;
  let bestSum = -1;
  for (let h = 0; h < 24; h++) {
    const sum = (hours[h] ?? 0) + (hours[(h + 1) % 24] ?? 0);
    if (sum > bestSum) {
      bestSum = sum;
      best = h;
    }
  }
  return best;
}

/** h 与 center 在 24 小时环上的距离。 */
export const hourDistance = (h: number, center: number) => {
  const d = Math.abs(h - center) % 24;
  return Math.min(d, 24 - d);
};

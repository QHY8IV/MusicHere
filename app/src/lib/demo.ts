/**
 * 「30 秒体验共鸣」的跨页面标记：欢迎页点了体验按钮 → 登录后直达共鸣页并自动开始（模拟街头，不需要麦克风）。
 * 只在内存里，刷新页面就没有，不会反复触发。
 */
let pending = false;

export function requestAutoDemo() {
  pending = true;
}

export function peekAutoDemo() {
  return pending;
}

export function consumeAutoDemo() {
  const p = pending;
  pending = false;
  return p;
}

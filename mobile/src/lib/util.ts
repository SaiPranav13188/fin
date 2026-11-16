import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { useStore } from './store';

/** ₹1,23,456.50 with Indian grouping. */
export function rupees(paise: number, opts: { sign?: boolean } = {}): string {
  const abs = Math.abs(Math.round(paise));
  const r = Math.floor(abs / 100);
  const p = abs % 100;
  let s = String(r);
  if (s.length > 3) s = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  const sign = paise < 0 ? '-' : opts.sign && paise > 0 ? '+' : '';
  return `${sign}₹${s}${p ? '.' + String(p).padStart(2, '0') : ''}`;
}

/** Largest-remainder split, same as the server, so previews always match what gets saved. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const base = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => [-((total * w) % sum), i] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (left-- <= 0) break;
    base[i] += 1;
  }
  return base;
}

/** Safe calculator for the keypad: digits, + - × ÷ and a decimal point. Returns paise or null. */
export function evalAmount(expr: string): number | null {
  const tokens = expr.replace(/×/g, '*').replace(/÷/g, '/').match(/\d+\.?\d*|[+\-*/]/g);
  if (!tokens) return null;
  const nums: number[] = [];
  const ops: string[] = [];
  let expectNumber = true;
  for (const t of tokens) {
    if (/[+\-*/]/.test(t)) {
      if (expectNumber) return null;
      ops.push(t);
      expectNumber = true;
    } else {
      if (!expectNumber) return null;
      nums.push(parseFloat(t));
      expectNumber = false;
    }
  }
  if (expectNumber) {
    ops.pop(); // trailing operator: ignore it while typing
    if (!nums.length) return null;
  }
  // multiply/divide first
  const n2 = [nums[0]];
  const o2: string[] = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === '*') n2[n2.length - 1] *= b;
    else if (op === '/') n2[n2.length - 1] = b === 0 ? NaN : n2[n2.length - 1] / b;
    else {
      o2.push(op);
      n2.push(b);
    }
  });
  const value = n2.slice(1).reduce((acc, n, i) => (o2[i] === '+' ? acc + n : acc - n), n2[0]);
  if (!isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');

export function timeAgo(iso: string): string {
  // The API sends UTC; some databases drop the zone marker, so add it back.
  const s = Math.max(0, (Date.now() - new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z').getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Haptic choreography. Every pattern is a no-op when the user turns haptics off. */
const on = () => useStore.getState().settings.haptics && Platform.OS !== 'web';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const haptic = {
  tick: () => on() && Haptics.selectionAsync(),
  tap: () => on() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  bump: () => on() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  thunk: () => on() && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  warn: () => on() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => on() && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  async success() {
    if (!on()) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await wait(90);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await wait(90);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
};

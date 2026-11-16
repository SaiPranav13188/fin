/** Offline queue: expenses added with no internet are kept on the phone and sent when the connection returns. */
import { AppState } from 'react-native';
import { create } from 'zustand';

import { ApiError, api } from './api';
import { kv, useStore } from './store';

type Pending = { id: string; groupId: string; body: Record<string, unknown>; description: string };

export const useQueue = create<{ items: Pending[] }>(() => ({ items: [] }));
const KEY = 'fin.queue';
let flushing = false;

const persist = (items: Pending[]) => {
  useQueue.setState({ items });
  kv.set(KEY, items.length ? JSON.stringify(items) : null);
};

export async function loadQueue() {
  try {
    const raw = await kv.get(KEY);
    if (raw) useQueue.setState({ items: JSON.parse(raw) });
  } catch {}
}

export function enqueueExpense(groupId: string, body: Record<string, unknown>) {
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, groupId, body, description: String(body.description ?? 'Expense') };
  persist([...useQueue.getState().items, item]);
}

/** Sends everything waiting. Stops at the first network failure and tries again later. */
export async function flushQueue(onSynced?: () => void) {
  if (flushing || !useStore.getState().access) return;
  flushing = true;
  let sent = 0;
  try {
    while (useQueue.getState().items.length) {
      const [next, ...rest] = useQueue.getState().items;
      try {
        await api(`/groups/${next.groupId}/expenses`, { body: next.body });
        sent += 1;
      } catch (e) {
        if (e instanceof ApiError && e.status === 0) break; // still offline
        if (e instanceof ApiError && (e.status === 401 || e.status >= 500)) break; // try again later
        // The server refused it (for example the group changed): drop it and say so, rather than retrying forever.
        useStore.getState().showToast(`Couldn't sync “${next.description}”: ${e instanceof ApiError ? e.message : 'error'}`, 'warn');
      }
      persist(rest);
    }
  } finally {
    flushing = false;
  }
  if (sent) {
    useStore.getState().showToast(sent === 1 ? 'Synced 1 offline expense ✓' : `Synced ${sent} offline expenses ✓`, 'ok');
    onSynced?.();
  }
}

/** Call once at app start: retries when the app comes to the foreground and every 20 seconds while something waits. */
export function startQueueSync(onSynced: () => void) {
  loadQueue().then(() => flushQueue(onSynced));
  const sub = AppState.addEventListener('change', (s) => s === 'active' && flushQueue(onSynced));
  const timer = setInterval(() => useQueue.getState().items.length && flushQueue(onSynced), 20000);
  return () => {
    sub.remove();
    clearInterval(timer);
  };
}

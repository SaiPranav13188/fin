import { Platform } from 'react-native';

import { useStore } from './store';

// Android emulators reach the host machine on 10.0.2.2. Release builds get the real URL from eas.json.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000');

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function messageFrom(body: any, status: number): string {
  const d = body?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, '');
  if (status === 0) return "Can't reach Fin right now. Check your internet.";
  return 'Something went wrong. Please try again.';
}

let refreshing: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const { refresh, setTokens } = useStore.getState();
  if (!refresh) return false;
  try {
    const r = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!r.ok) {
      if (r.status === 401) await setTokens(null, null);
      return false;
    }
    const t = await r.json();
    await setTokens(t.access_token, t.refresh_token);
    return true;
  } catch {
    return false;
  }
}

type Opts = { method?: string; body?: unknown; form?: FormData; auth?: boolean };

export async function api<T = any>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const { access } = useStore.getState();
  const headers: Record<string, string> = {};
  if (opts.auth !== false && access) headers.Authorization = `Bearer ${access}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, messageFrom(null, 0));
  }
  if (res.status === 401 && opts.auth !== false && retry) {
    refreshing ??= refreshTokens().finally(() => (refreshing = null));
    if (await refreshing) return api<T>(path, opts, false);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, messageFrom(body, res.status));
  return body as T;
}

export type AgentEvent =
  | { type: 'step'; agent: string; label: string; tool?: string }
  | { type: 'result'; data: any }
  | { type: 'error'; message: string };

/** Streams agent steps (Server-Sent Events) so the mascot can act each one out. Returns a cancel function. */
export function streamDraft(body: { text: string; group_id?: string | null; source?: 'text' | 'voice' }, onEvent: (e: AgentEvent) => void) {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let finished = false;
  const pump = () => {
    const chunk = xhr.responseText.slice(seen);
    const end = chunk.lastIndexOf('\n\n');
    if (end < 0) return;
    seen += end + 2;
    for (const block of chunk.slice(0, end).split('\n\n')) {
      if (!block.startsWith('data: ')) continue;
      try {
        const e = JSON.parse(block.slice(6)) as AgentEvent;
        if (e.type !== 'step') finished = true;
        onEvent(e);
      } catch {}
    }
  };
  xhr.open('POST', `${API_URL}/agent/draft/stream`);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Authorization', `Bearer ${useStore.getState().access}`);
  xhr.onprogress = pump;
  xhr.onload = () => {
    pump();
    if (!finished) {
      let msg = 'Something went wrong. Please try again.';
      try {
        msg = messageFrom(JSON.parse(xhr.responseText), xhr.status);
      } catch {}
      onEvent({ type: 'error', message: msg });
    }
  };
  xhr.onerror = () => onEvent({ type: 'error', message: messageFrom(null, 0) });
  xhr.send(JSON.stringify(body));
  return () => xhr.abort();
}

// ---- shapes returned by the API ----
export type Member = { id: string; name: string; upi_id: string | null; verified: boolean; active: boolean; is_self: boolean };
export type Group = { id: string; name: string; emoji: string; kind: string; members: Member[]; my_balance_paise: number; total_spent_paise: number; created_at: string };
export type Item = { name: string; amount_paise: number; member_ids: string[] };
export type Expense = { id: string; group_id: string; description: string; category: string; amount_paise: number; split_type: string; note: string | null; created_via: string; spent_on: string; created_at: string; payers: Record<string, number>; shares: Record<string, number>; items: Item[]; currency?: string; original_minor?: number | null; fx_rate?: number | null };
export type Transfer = { from_member: string; to_member: string; amount_paise: number; upi_link: string | null; over_upi_limit: boolean };
export type Balances = { net: Record<string, number>; transfers: Transfer[]; all_settled: boolean };
export type Message = { id: string; group_id: string; sender_member: string | null; body: string; kind: 'text' | 'split_card' | 'settle_card' | 'system'; ref_id: string | null; created_at: string };
export type Reminder = { id: string; kind: string; ref_id: string; due_at: string; message: string; status: string };
export type Summary = { you_owe_paise: number; you_are_owed_paise: number; groups: { id: string; name: string; emoji: string; balance_paise: number }[]; month_spend_paise: number; month_by_category: Record<string, number>; subscriptions_monthly_paise: number };
export type Draft = { kind: string; draft_id?: string; group_id?: string; description: string; amount_paise: number | null; category: string; payers: Record<string, number | null>; split_type: string; member_ids: string[]; items: Item[] | null; questions: { field: string; question: string; name?: string; options_paise?: number[] }[]; ready: boolean; source: 'ai' | 'rules'; error?: string; tax_paise?: number; tip_paise?: number; discount_paise?: number };
export type SafetyFlag = { code: string; level: 'caution' | 'block'; title: string; detail: string };

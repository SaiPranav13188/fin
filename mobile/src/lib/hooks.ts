import { QueryClient, useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { API_URL, Balances, Expense, Group, Message, Reminder, Summary, api } from './api';
import { useStore } from './store';

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false } },
});

export const refreshAll = () => queryClient.invalidateQueries();

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api('/auth/me') });
export const useGroups = () => useQuery({ queryKey: ['groups'], queryFn: () => api<Group[]>('/groups') });
export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: () => api<Summary>('/me/summary') });
export const useReminders = () => useQuery({ queryKey: ['reminders'], queryFn: () => api<Reminder[]>('/reminders') });
export const useGroup = (id?: string) => useQuery({ queryKey: ['group', id], queryFn: () => api<Group>(`/groups/${id}`), enabled: !!id });
export const useExpenses = (id?: string) => useQuery({ queryKey: ['expenses', id], queryFn: () => api<Expense[]>(`/groups/${id}/expenses`), enabled: !!id });
export const useBalances = (id?: string) => useQuery({ queryKey: ['balances', id], queryFn: () => api<Balances>(`/groups/${id}/balances`), enabled: !!id });
export const useMessages = (id?: string) => useQuery({ queryKey: ['messages', id], queryFn: () => api<Message[]>(`/groups/${id}/messages`), enabled: !!id });

/** Live updates for a group over WebSocket. Reconnects with backoff; falls back silently if offline. */
export function useGroupLive(id?: string) {
  const access = useStore((s) => s.access);
  useEffect(() => {
    if (!id || !access) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/groups/${id}/ws?token=${encodeURIComponent(access)}`);
      ws.onopen = () => (tries = 0);
      ws.onmessage = () => {
        for (const key of ['group', 'expenses', 'balances', 'messages']) queryClient.invalidateQueries({ queryKey: [key, id] });
        queryClient.invalidateQueries({ queryKey: ['summary'] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      };
      ws.onclose = () => {
        if (!closed) timer = setTimeout(connect, Math.min(15000, 1000 * 2 ** tries++));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [id, access]);
}

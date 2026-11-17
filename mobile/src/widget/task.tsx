/** Runs in the background when Android asks the widget to refresh (every 30 minutes, and when added). */
import * as SecureStore from 'expo-secure-store';
import React from 'react';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { BalanceWidget, WidgetData } from './BalanceWidget';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8000';
const now = () => new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

async function summary(token: string) {
  const r = await fetch(`${API_URL}/me/summary`, { headers: { Authorization: `Bearer ${token}` } });
  return r.ok ? r.json() : r.status;
}

/** Fetches the balance with the saved login. Refreshes the access token once if it has expired. */
export async function loadWidgetData(): Promise<WidgetData> {
  let access = await SecureStore.getItemAsync('fin.access');
  const refresh = await SecureStore.getItemAsync('fin.refresh');
  if (!access) return { signedIn: false, owePaise: 0, owedPaise: 0, updated: now() };
  try {
    let s = await summary(access);
    if (s === 401 && refresh) {
      const r = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refresh }) });
      if (r.ok) {
        const t = await r.json();
        await SecureStore.setItemAsync('fin.access', t.access_token);
        await SecureStore.setItemAsync('fin.refresh', t.refresh_token);
        access = t.access_token as string;
        s = await summary(access);
      }
    }
    if (typeof s === 'number') return { signedIn: s !== 401, owePaise: 0, owedPaise: 0, updated: now(), offline: s !== 401 };
    const data = { signedIn: true, owePaise: s.you_owe_paise, owedPaise: s.you_are_owed_paise, updated: now() };
    await SecureStore.setItemAsync('fin.widget', JSON.stringify(data));
    return data;
  } catch {
    const last = await SecureStore.getItemAsync('fin.widget');
    return last ? { ...JSON.parse(last), offline: true } : { signedIn: true, owePaise: 0, owedPaise: 0, updated: now(), offline: true };
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
  props.renderWidget(<BalanceWidget data={await loadWidgetData()} />);
}

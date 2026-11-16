import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

/** Tokens live in the Android Keystore via SecureStore. Web (dev preview only) uses memory + localStorage. */
const kv = {
  async get(key: string) {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string | null) {
    if (Platform.OS === 'web') {
      if (value === null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
      return;
    }
    if (value === null) await SecureStore.deleteItemAsync(key);
    else await SecureStore.setItemAsync(key, value);
  },
};

export type Settings = { haptics: boolean; sound: boolean; reduceMotion: boolean; onboarded: boolean; lang: 'en' | 'hi' | 'te' };
const defaultSettings: Settings = { haptics: true, sound: false, reduceMotion: false, onboarded: false, lang: 'en' };

type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'info' };

type State = {
  ready: boolean;
  access: string | null;
  refresh: string | null;
  settings: Settings;
  toast: Toast | null;
  hydrate: () => Promise<void>;
  setTokens: (access: string | null, refresh: string | null) => Promise<void>;
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  showToast: (text: string, tone?: Toast['tone']) => void;
  clearToast: () => void;
};

export const useStore = create<State>((set, get) => ({
  ready: false,
  access: null,
  refresh: null,
  settings: defaultSettings,
  toast: null,
  async hydrate() {
    const [access, refresh, raw] = await Promise.all([kv.get('fin.access'), kv.get('fin.refresh'), kv.get('fin.settings')]);
    let settings = defaultSettings;
    try {
      if (raw) settings = { ...defaultSettings, ...JSON.parse(raw) };
    } catch {}
    set({ access, refresh, settings, ready: true });
  },
  async setTokens(access, refresh) {
    set({ access, refresh });
    await Promise.all([kv.set('fin.access', access), kv.set('fin.refresh', refresh)]);
  },
  setSetting(key, value) {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    kv.set('fin.settings', JSON.stringify(settings));
  },
  showToast(text, tone = 'info') {
    set({ toast: { id: Date.now(), text, tone } });
  },
  clearToast() {
    set({ toast: null });
  },
}));

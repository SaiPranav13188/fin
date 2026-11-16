import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

/** Tokens live in the Android Keystore via SecureStore. Web (dev preview only) uses memory + localStorage. */
export const kv = {
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

export type Outfit = 'none' | 'cap' | 'party' | 'scarf';
export type Settings = { haptics: boolean; sound: boolean; reduceMotion: boolean; onboarded: boolean; lang: 'en' | 'hi' | 'te'; outfit: Outfit; earned: string[]; billsPaid: number };
const defaultSettings: Settings = { haptics: true, sound: false, reduceMotion: false, onboarded: false, lang: 'en', outfit: 'none', earned: [], billsPaid: 0 };

type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'info' };
export type Moment = { key: string; title: string; sub: string; unlocks?: Outfit };

type State = {
  ready: boolean;
  access: string | null;
  refresh: string | null;
  settings: Settings;
  toast: Toast | null;
  moment: Moment | null;
  pickedUpi: string | null;
  /** Shows a celebration card the first time each moment is earned. */
  earn: (m: Moment) => void;
  closeMoment: () => void;
  setPickedUpi: (v: string | null) => void;
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
  moment: null,
  pickedUpi: null,
  earn(m) {
    const { settings } = get();
    if (settings.earned.includes(m.key)) return;
    get().setSetting('earned', [...settings.earned, m.key]);
    set({ moment: m });
  },
  closeMoment() {
    set({ moment: null });
  },
  setPickedUpi(v) {
    set({ pickedUpi: v });
  },
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

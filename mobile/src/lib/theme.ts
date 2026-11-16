import { Easing } from 'react-native-reanimated';

export const colors = {
  bg: '#FFF7FB',
  card: '#FFFFFF',
  ink: '#2A1B3D',
  inkSoft: '#6E5F85',
  inkFaint: '#B4A8C6',
  line: '#F0E6F5',
  pink: '#FF5FA2',
  pinkSoft: '#FFE4F1',
  purple: '#7B4DFF',
  purpleSoft: '#EEE7FF',
  grad: ['#FF6FB1', '#9B5CFF'] as const,
  gradSoft: ['#FFE9F4', '#EFE6FF'] as const,
  mint: '#19C08A',
  mintSoft: '#DDF8EE',
  amber: '#FFB020',
  amberSoft: '#FFF2D6',
  coral: '#FF7A6B',
  coralSoft: '#FFE7E3',
  coin: '#FFC83D',
  coinDark: '#F0A019',
  dim: 'rgba(42,27,61,0.45)',
};

/** Slice / avatar colours. Chosen to stay distinct next to each other. */
export const palette = ['#FF6FB1', '#7B4DFF', '#19C08A', '#FFB020', '#3BA7FF', '#FF7A6B', '#B36BFF', '#12B5B0'];
export const colorFor = (i: number) => palette[i % palette.length];

/** Motion tokens. Every animation uses one of these instead of ad-hoc numbers. */
export const spring = {
  gentle: { damping: 20, stiffness: 140, mass: 1 },
  snappy: { damping: 18, stiffness: 320, mass: 0.8 },
  bouncy: { damping: 9, stiffness: 180, mass: 0.9 },
  jelly: { damping: 5, stiffness: 220, mass: 0.6 },
} as const;

export const timing = {
  fast: { duration: 160, easing: Easing.out(Easing.cubic) },
  base: { duration: 280, easing: Easing.out(Easing.cubic) },
  slow: { duration: 520, easing: Easing.inOut(Easing.cubic) },
} as const;

export const STAGGER = 36;

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semi: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extra: 'PlusJakartaSans_800ExtraBold',
};

export const radius = { sm: 12, md: 18, lg: 26, xl: 34, pill: 999 };

export const shadow = {
  shadowColor: '#7B4DFF',
  shadowOpacity: 0.14,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 5,
};

export const CATEGORY: Record<string, { emoji: string; label: string; color: string }> = {
  food: { emoji: '🍕', label: 'Food', color: '#FF6FB1' },
  groceries: { emoji: '🛒', label: 'Groceries', color: '#19C08A' },
  travel: { emoji: '🚕', label: 'Travel', color: '#3BA7FF' },
  rent: { emoji: '🏠', label: 'Rent', color: '#7B4DFF' },
  bills: { emoji: '💡', label: 'Bills', color: '#FFB020' },
  shopping: { emoji: '🛍️', label: 'Shopping', color: '#B36BFF' },
  fun: { emoji: '🎬', label: 'Fun', color: '#FF7A6B' },
  health: { emoji: '💊', label: 'Health', color: '#12B5B0' },
  other: { emoji: '✨', label: 'Other', color: '#B4A8C6' },
};

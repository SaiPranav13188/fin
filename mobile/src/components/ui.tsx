/** Fin's design system: text, buttons, cards, avatars, sheets, toasts, rolling numbers. */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect } from 'react';
import {
  ActivityIndicator, Dimensions, Modal, Pressable, Share, StyleProp, StyleSheet, Text, TextInput,
  TextInputProps, TextProps, TextStyle, View, ViewStyle,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { useStore } from '@/lib/store';
import { STAGGER, colorFor, colors, font, radius, shadow, spring } from '@/lib/theme';
import { haptic, initials } from '@/lib/util';

const { height: H } = Dimensions.get('window');

// ---------- text ----------
type TProps = TextProps & { v?: 'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'small' | 'tiny'; color?: string; w?: keyof typeof font; center?: boolean };
const VARIANT: Record<NonNullable<TProps['v']>, TextStyle> = {
  hero: { fontSize: 44, lineHeight: 50, fontFamily: font.extra, letterSpacing: -1 },
  h1: { fontSize: 28, lineHeight: 34, fontFamily: font.extra, letterSpacing: -0.5 },
  h2: { fontSize: 21, lineHeight: 27, fontFamily: font.bold, letterSpacing: -0.3 },
  h3: { fontSize: 16.5, lineHeight: 22, fontFamily: font.bold },
  body: { fontSize: 15, lineHeight: 21, fontFamily: font.medium },
  small: { fontSize: 13, lineHeight: 18, fontFamily: font.medium },
  tiny: { fontSize: 11, lineHeight: 14, fontFamily: font.bold, letterSpacing: 0.5, textTransform: 'uppercase' },
};
export function T({ v = 'body', color = colors.ink, w, center, style, ...rest }: TProps) {
  return <Text {...rest} style={[VARIANT[v], { color }, w && { fontFamily: font[w] }, center && { textAlign: 'center' }, style]} />;
}

// ---------- pressable with a springy press ----------
const APressable = Animated.createAnimatedComponent(Pressable);
type PressProps = { onPress?: () => void; onLongPress?: () => void; style?: StyleProp<ViewStyle>; children: React.ReactNode; disabled?: boolean; scaleTo?: number; label?: string; hit?: number };
export function Press({ onPress, onLongPress, style, children, disabled, scaleTo = 0.95, label, hit = 6 }: PressProps) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={hit}
      disabled={disabled}
      onPressIn={() => (s.value = withSpring(scaleTo, spring.snappy))}
      onPressOut={() => (s.value = withSpring(1, spring.bouncy))}
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      onLongPress={onLongPress}
      style={[style, a, disabled && { opacity: 0.45 }]}>
      {children}
    </APressable>
  );
}

type BtnProps = { title: string; onPress?: () => void; kind?: 'primary' | 'soft' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean; icon?: string; style?: StyleProp<ViewStyle>; small?: boolean };
export function Btn({ title, onPress, kind = 'primary', loading, disabled, icon, style, small }: BtnProps) {
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? colors.coral : colors.purple;
  const inner = (
    <View style={[styles.btnInner, small && { height: 42, paddingHorizontal: 16 }]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <>
          {icon ? <Text style={{ fontSize: small ? 15 : 18 }}>{icon}</Text> : null}
          <T v={small ? 'small' : 'h3'} color={fg} w="bold">{title}</T>
        </>
      )}
    </View>
  );
  return (
    <Press onPress={onPress} disabled={disabled || loading} style={[{ borderRadius: radius.pill }, kind === 'primary' && shadow, style]} label={title}>
      {kind === 'primary' ? (
        <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.pill }}>{inner}</LinearGradient>
      ) : (
        <View style={{ borderRadius: radius.pill, backgroundColor: kind === 'soft' ? colors.purpleSoft : kind === 'danger' ? colors.coralSoft : 'transparent' }}>{inner}</View>
      )}
    </Press>
  );
}

export function Card({ children, style, index = 0 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; index?: number }) {
  const reduce = useStore((s) => s.settings.reduceMotion);
  return (
    <Animated.View entering={reduce ? FadeIn : FadeInDown.delay(index * STAGGER).springify().damping(16)} style={[styles.card, style]}>
      {children}
    </Animated.View>
  );
}

export function Chip({ label, active, onPress, emoji }: { label: string; active?: boolean; onPress?: () => void; emoji?: string }) {
  return (
    <Press onPress={onPress} style={[styles.chip, active && { backgroundColor: colors.purple, borderColor: colors.purple }]} label={label}>
      {emoji ? <Text style={{ fontSize: 14 }}>{emoji}</Text> : null}
      <T v="small" w="semi" color={active ? '#fff' : colors.ink}>{label}</T>
    </Press>
  );
}

// ---------- avatar with a status ring (solid = paid, dashed = pending) ----------
export function Avatar({ name, index = 0, size = 44, ring, selected, wiggleKey }: { name: string; index?: number; size?: number; ring?: 'paid' | 'pending'; selected?: boolean; wiggleKey?: number }) {
  const rot = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (wiggleKey) rot.value = withSequence(withTiming(-12, { duration: 60 }), withRepeat(withTiming(12, { duration: 110 }), 4, true), withTiming(0, { duration: 60 }));
  }, [wiggleKey]);
  useEffect(() => {
    pop.value = withSequence(withTiming(selected ? 1.14 : 0.94, { duration: 90 }), withSpring(1, spring.bouncy));
  }, [selected]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }, { scale: pop.value }] }));
  const c = colorFor(index);
  return (
    <Animated.View style={[{ width: size + 8, height: size + 8, alignItems: 'center', justifyContent: 'center' }, a]}>
      {ring || selected ? (
        <View style={{ position: 'absolute', width: size + 8, height: size + 8, borderRadius: size, borderWidth: 2.5, borderColor: ring === 'paid' ? colors.mint : selected ? colors.purple : colors.amber, borderStyle: ring === 'pending' ? 'dashed' : 'solid' }} />
      ) : null}
      <View style={{ width: size, height: size, borderRadius: size, backgroundColor: c + '2B', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: font.extra, fontSize: size * 0.36, color: c }}>{initials(name)}</Text>
      </View>
      {ring === 'paid' ? (
        <View style={[styles.tick, { right: -1, bottom: -1 }]}><Text style={{ color: '#fff', fontSize: 9, fontFamily: font.extra }}>✓</Text></View>
      ) : null}
    </Animated.View>
  );
}

export function Field(props: TextInputProps & { label?: string; error?: string | null }) {
  const [focus, setFocus] = React.useState(false);
  return (
    <View style={{ gap: 6 }}>
      {props.label ? <T v="small" w="semi" color={colors.inkSoft}>{props.label}</T> : null}
      <TextInput
        placeholderTextColor={colors.inkFaint}
        {...props}
        onFocus={(e) => { setFocus(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); props.onBlur?.(e); }}
        style={[styles.field, focus && { borderColor: colors.purple, backgroundColor: '#fff' }, props.error ? { borderColor: colors.coral } : null, props.style]}
      />
      {props.error ? <T v="small" color={colors.coral}>{props.error}</T> : null}
    </View>
  );
}

// ---------- screen scaffold ----------
export function Screen({ children, title, back = true, right, pad = true, edges = ['top'] }: { children: React.ReactNode; title?: string; back?: boolean; right?: React.ReactNode; pad?: boolean; edges?: ('top' | 'bottom')[] }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={edges}>
      {title !== undefined ? (
        <View style={styles.header}>
          {back ? (
            <Press onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} style={styles.iconBtn} label="Back">
              <Text style={{ fontSize: 20, color: colors.ink, fontFamily: font.bold }}>‹</Text>
            </Press>
          ) : <View style={{ width: 40 }} />}
          <T v="h3" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>{title}</T>
          <View style={{ minWidth: 40, alignItems: 'flex-end' }}>{right}</View>
        </View>
      ) : null}
      <View style={[{ flex: 1 }, pad && { paddingHorizontal: 20 }]}>{children}</View>
    </SafeAreaView>
  );
}

// ---------- bottom sheet: content-sized, springy, drag down to dismiss ----------
export function Sheet({ visible, onClose, children, title }: { visible: boolean; onClose: () => void; children: React.ReactNode; title?: string }) {
  const insets = useSafeAreaInsets();
  const y = useSharedValue(H);
  useEffect(() => {
    y.value = visible ? withSpring(0, spring.gentle) : withTiming(H, { duration: 220 });
  }, [visible]);
  const pan = Gesture.Pan()
    .onUpdate((e) => { y.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) {
        y.value = withTiming(H, { duration: 200 });
        scheduleOnRN(onClose);
      } else y.value = withSpring(0, spring.snappy);
    });
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const dim = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, H * 0.6], [1, 0], 'clamp') }));
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim }, dim]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }, sheet]}>
          <GestureDetector gesture={pan}>
            <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 12 }}>
              <View style={styles.grabber} />
              {title ? <T v="h2" style={{ marginTop: 14 }}>{title}</T> : null}
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- toast ----------
export function ToastHost() {
  const toast = useStore((s) => s.toast);
  const clear = useStore((s) => s.clearToast);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clear, 3200);
    return () => clearTimeout(t);
  }, [toast?.id]);
  if (!toast) return null;
  const bg = toast.tone === 'ok' ? colors.mint : toast.tone === 'warn' ? colors.coral : colors.ink;
  return (
    <Animated.View key={toast.id} entering={FadeInDown.springify().damping(14)} exiting={FadeOut} pointerEvents="none"
      style={[styles.toast, { top: insets.top + 10, backgroundColor: bg }]}>
      <T v="small" w="semi" color="#fff" center>{toast.text}</T>
    </Animated.View>
  );
}

// ---------- rolling number (odometer) ----------
function Digit({ d, size, color }: { d: number; size: number; color: string }) {
  const h = Math.round(size * 1.18);
  const y = useSharedValue(-d * h);
  useEffect(() => {
    y.value = withSpring(-d * h, spring.gentle);
  }, [d, h]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: h, width: size * 0.67, overflow: 'hidden' }}>
      <Animated.View style={a}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <Text key={n} style={{ height: h, lineHeight: h, fontSize: size, fontFamily: font.extra, color, textAlign: 'center' }}>{n}</Text>
        ))}
      </Animated.View>
    </View>
  );
}
export function RollingNumber({ text, size = 34, color = colors.ink }: { text: string; size?: number; color?: string }) {
  const h = Math.round(size * 1.18);
  const chars = text.split('');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }} accessibilityLabel={text}>
      {chars.map((ch, i) =>
        /\d/.test(ch) ? <Digit key={chars.length - i} d={Number(ch)} size={size} color={color} /> : (
          <Text key={`c${chars.length - i}`} style={{ height: h, lineHeight: h, fontSize: size, fontFamily: font.extra, color }}>{ch}</Text>
        ),
      )}
    </View>
  );
}

// ---------- loading shimmer ----------
export function Skeleton({ h = 64, w = '100%' as number | `${number}%`, r = radius.md }: { h?: number; w?: number | `${number}%`; r?: number }) {
  const o = useSharedValue(0.45);
  useEffect(() => {
    o.value = withRepeat(withTiming(1, { duration: 700 }), -1, true);
  }, []);
  const a = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ height: h, width: w, borderRadius: r, backgroundColor: colors.line }, a]} />;
}

// ---------- typing dots ----------
export function Dots({ color = colors.purple }: { color?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 5 }}>
      {[0, 1, 2].map((i) => <Dot key={i} i={i} color={color} />)}
    </View>
  );
}
function Dot({ i, color }: { i: number; color: string }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(i * 140, withRepeat(withSequence(withTiming(-5, { duration: 280 }), withTiming(0, { duration: 280 })), -1));
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }, a]} />;
}

export function Empty({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <Animated.View entering={FadeIn.delay(120)} style={{ alignItems: 'center', gap: 8, paddingVertical: 28 }}>
      {children}
      <T v="h3" center>{title}</T>
      {sub ? <T v="small" color={colors.inkSoft} center style={{ maxWidth: 270 }}>{sub}</T> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btnInner: { height: 56, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18, ...shadow },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 38, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.line },
  tick: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: colors.mint, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#fff' },
  field: { height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#FBF6FD', paddingHorizontal: 16, fontFamily: font.semi, fontSize: 15.5, color: colors.ink },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, height: 54, gap: 8 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.08 },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 20, maxHeight: H * 0.9 },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.line },
  toast: { position: 'absolute', alignSelf: 'center', left: 24, right: 24, paddingVertical: 12, paddingHorizontal: 18, borderRadius: radius.pill, zIndex: 100, ...shadow },
});


// ---------- moments: a celebration card, shown once per achievement, with a share button ----------
export function MomentHost({ mascot, confetti }: { mascot: React.ReactNode; confetti: (fire: number) => React.ReactNode }) {
  const moment = useStore((s) => s.moment);
  const close = useStore((s) => s.closeMoment);
  const setSetting = useStore((s) => s.setSetting);
  const [fire, setFire] = React.useState(0);
  useEffect(() => {
    if (moment) {
      setFire(Date.now());
      haptic.success();
    }
  }, [moment?.key]);
  if (!moment) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.dim, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {confetti(fire)}
        <Animated.View entering={FadeInDown.springify().damping(11)} style={[styles.card, { alignItems: 'center', gap: 10, alignSelf: 'stretch', paddingVertical: 28 }]}>
          {mascot}
          <T v="tiny" color={colors.pink}>New moment</T>
          <T v="h1" center>{moment.title}</T>
          <T color={colors.inkSoft} center>{moment.sub}</T>
          {moment.unlocks ? <T v="small" w="bold" color={colors.purple} center>🎁 You unlocked a new outfit for Fin</T> : null}
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 10 }}>
            {moment.unlocks ? <Btn title="Wear it now" onPress={() => { setSetting('outfit', moment.unlocks!); close(); }} /> : null}
            <Btn title="Share" kind="soft" icon="📣" onPress={() => Share.share({ message: `${moment.title} ${moment.sub} (on Fin)` }).catch(() => {})} />
            <Btn title="Nice!" kind="ghost" onPress={close} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

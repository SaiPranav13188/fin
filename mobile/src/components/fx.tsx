/** Motion pieces: physics confetti and coins, the live pizza chart, the calculator keypad, swipe-to-pay. */
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, SharedValue, interpolate, interpolateColor, useAnimatedProps, useAnimatedReaction, useAnimatedStyle, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { useStore } from '@/lib/store';
import { colorFor, colors, font, palette, radius, shadow, spring } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { Mascot } from './Mascot';
import { Press, T } from './ui';

const { width: W, height: H } = Dimensions.get('window');

// ---------------- Confetti: real ballistic physics with a floor bounce, all on the UI thread ----------------
type Piece = { x0: number; vx: number; vy: number; rot: number; color: string; w: number; h: number; coin: boolean };

function ConfettiPiece({ p, t, floor }: { p: Piece; t: SharedValue<number>; floor: number }) {
  const style = useAnimatedStyle(() => {
    const g = 2600;
    const time = t.value * 2.6; // seconds
    let y = p.vy * time + 0.5 * g * time * time;
    // bounce: once past the floor, reflect with energy loss
    if (y > floor) {
      const tHit = (-p.vy + Math.sqrt(p.vy * p.vy + 2 * g * floor)) / g;
      const vHit = p.vy + g * tHit;
      const t2 = time - tHit;
      y = floor - (vHit * 0.38 * t2 - 0.5 * g * t2 * t2);
      if (y > floor) y = floor;
    }
    return {
      opacity: interpolate(t.value, [0, 0.75, 1], [1, 1, 0]),
      transform: [
        { translateX: p.x0 + p.vx * time * (1 - 0.18 * time) },
        { translateY: y },
        { rotate: `${p.rot * time * 2}deg` },
        { rotateX: `${p.rot * time * 3}deg` },
      ],
    };
  });
  return <Animated.View style={[{ position: 'absolute', width: p.w, height: p.h, borderRadius: p.coin ? p.w : 2, backgroundColor: p.color }, style]} />;
}

/** Bursts from (originX, originY). `fire` is any value that changes to trigger a new burst. */
export function Confetti({ fire, originY = H * 0.42, coins = false, count = 34 }: { fire: unknown; originY?: number; coins?: boolean; count?: number }) {
  const reduce = useStore((s) => s.settings.reduceMotion);
  const t = useSharedValue(1);
  const pieces = useMemo<Piece[]>(
    () => Array.from({ length: count }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.1;
      const speed = 700 + Math.random() * 900;
      const coin = coins && i % 3 === 0;
      return {
        x0: W / 2 - 5, vx: Math.cos(angle) * speed * 0.7, vy: Math.sin(angle) * speed, rot: (Math.random() - 0.5) * 500,
        color: coin ? colors.coin : palette[i % palette.length], w: coin ? 13 : 7 + Math.random() * 6, h: coin ? 13 : 10 + Math.random() * 8, coin,
      };
    }),
    [fire],
  );
  useEffect(() => {
    if (!fire || reduce) return;
    t.value = 0;
    t.value = withTiming(1, { duration: 2600, easing: Easing.linear });
  }, [fire]);
  if (!fire || reduce) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { top: originY, zIndex: 50 }]}>
      {pieces.map((p, i) => <ConfettiPiece key={i} p={p} t={t} floor={H - originY - 24} />)}
    </View>
  );
}

// ---------------- Pizza chart: slices re-slice live with springs, and burst apart on "Sliced!" ----------------
const APath = Animated.createAnimatedComponent(Path);

function Slice({ start, end, color, r, burst }: { start: number; end: number; color: string; r: number; burst: SharedValue<number> }) {
  const a0 = useSharedValue(start);
  const a1 = useSharedValue(end);
  useEffect(() => {
    a0.value = withSpring(start, spring.bouncy);
    a1.value = withSpring(end, spring.bouncy);
  }, [start, end]);
  const props = useAnimatedProps(() => {
    const s = a0.value;
    const e = Math.max(a1.value, s + 0.0001);
    const mid = (s + e) / 2;
    const off = burst.value * r * 0.34;
    const cx = r + 14 + Math.cos(mid) * off;
    const cy = r + 14 + Math.sin(mid) * off;
    const rr = r * (1 - burst.value * 0.06);
    const x0 = cx + rr * Math.cos(s), y0 = cy + rr * Math.sin(s);
    const x1 = cx + rr * Math.cos(e), y1 = cy + rr * Math.sin(e);
    const large = e - s > Math.PI ? 1 : 0;
    if (e - s >= Math.PI * 2 - 0.001) {
      return { d: `M ${cx - rr} ${cy} A ${rr} ${rr} 0 1 1 ${cx + rr} ${cy} A ${rr} ${rr} 0 1 1 ${cx - rr} ${cy} Z` };
    }
    return { d: `M ${cx} ${cy} L ${x0} ${y0} A ${rr} ${rr} 0 ${large} 1 ${x1} ${y1} Z` };
  });
  return <APath animatedProps={props} fill={color} stroke="#FFF7E0" strokeWidth={3} strokeLinejoin="round" />;
}

export function PizzaChart({ values, size = 190, burst }: { values: number[]; size?: number; burst: SharedValue<number> }) {
  const r = size / 2;
  const total = values.reduce((a, b) => a + Math.max(b, 0), 0);
  let acc = -Math.PI / 2;
  const slices = values.map((v, i) => {
    const span = total > 0 ? (Math.max(v, 0) / total) * Math.PI * 2 : 0;
    const s = { start: acc, end: acc + span, i };
    acc += span;
    return s;
  });
  return (
    <Svg width={size + 28} height={size + 28}>
      <Circle cx={r + 14} cy={r + 14} r={r + 6} fill="#F2C66D" opacity={total > 0 ? 0.35 : 0.2} />
      {total <= 0 ? <Circle cx={r + 14} cy={r + 14} r={r} fill={colors.line} /> : null}
      {slices.map((s) => <Slice key={s.i} start={s.start} end={s.end} color={colorFor(s.i)} r={r} burst={burst} />)}
      {/* pepperoni, for flavour */}
      {total > 0 ? [[0.3, 0.5], [0.62, 0.3], [0.68, 0.66], [0.4, 0.75], [0.5, 0.48]].map(([x, y], i) => (
        <Circle key={i} cx={14 + size * x} cy={14 + size * y} r={size * 0.035} fill="rgba(255,255,255,0.4)" />
      )) : null}
    </Svg>
  );
}

// ---------------- Keypad with a calculator row and a live "= ₹100" ----------------
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const press = (k: string) => {
    haptic.tick();
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (value.length >= 18) return;
    const lastNum = value.split(/[+\-×÷]/).pop() ?? '';
    if (k === '.' && lastNum.includes('.')) return;
    if (/[+\-×÷]/.test(k)) {
      if (!value) return;
      if (/[+\-×÷]$/.test(value)) return onChange(value.slice(0, -1) + k);
    } else if (lastNum.includes('.') && lastNum.split('.')[1].length >= 2) return;
    onChange(value + k);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {['+', '-', '×', '÷'].map((op) => (
          <Press key={op} onPress={() => press(op)} style={[styles.key, { height: 42, backgroundColor: colors.purpleSoft }]} label={op}>
            <Text style={{ fontFamily: font.extra, fontSize: 20, color: colors.purple }}>{op === '-' ? '−' : op}</Text>
          </Press>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {KEYS.map((k) => (
          <Press key={k} onPress={() => press(k)} onLongPress={k === '⌫' ? () => onChange('') : undefined} style={[styles.gridKey, { width: (W - 40 - 16) / 3 }]} scaleTo={0.9} label={k === '⌫' ? 'Delete' : k}>
            <Text style={{ fontFamily: font.bold, fontSize: 24, color: colors.ink }}>{k}</Text>
          </Press>
        ))}
      </View>
    </View>
  );
}

// ---------------- Swipe to pay: Fin is the thumb ----------------
const TRACK_H = 68;
export function SwipeToPay({ label, onDone, disabled }: { label: string; onDone: () => void; disabled?: boolean }) {
  const width = W - 40;
  const max = width - TRACK_H;
  const x = useSharedValue(0);
  const vel = useSharedValue(0);
  const done = useSharedValue(0);
  const nudge = useSharedValue(0);
  const stage = useSharedValue(0);
  const [mood, setMood] = React.useState<'idle' | 'excited' | 'cheer'>('idle');

  // idle nudge: "psst, swipe me"
  useEffect(() => {
    nudge.value = withDelay(1400, withRepeat(withSequence(withSpring(12, spring.bouncy), withSpring(0, spring.bouncy), withDelay(2200, withTiming(0, { duration: 1 }))), -1));
  }, []);

  // rising haptics as the thumb crosses thresholds, and excitement past 82%
  useAnimatedReaction(
    () => (done.value ? 4 : Math.floor((x.value / max) * 4)),
    (now, prev) => {
      if (prev === null || now === prev) return;
      if (now > prev && now < 4) scheduleOnRN(now >= 3 ? haptic.bump : haptic.tap);
      stage.value = now;
    },
  );
  useAnimatedReaction(
    () => x.value / max > 0.82,
    (hot, was) => {
      if (hot !== was && !done.value) scheduleOnRN(setMood, hot ? 'excited' : 'idle');
    },
  );

  const finish = () => {
    setMood('cheer');
    haptic.success();
    setTimeout(onDone, 420);
  };
  const pan = Gesture.Pan()
    .enabled(!disabled)
    .onBegin(() => { nudge.value = withTiming(0, { duration: 80 }); })
    .onUpdate((e) => {
      if (done.value) return;
      x.value = Math.max(0, Math.min(max, e.translationX));
      vel.value = e.velocityX;
    })
    .onEnd(() => {
      if (done.value) return;
      vel.value = withSpring(0, spring.gentle);
      if (x.value > max * 0.86) {
        done.value = 1;
        x.value = withSpring(max, spring.snappy);
        scheduleOnRN(finish);
      } else {
        x.value = withSpring(0, spring.bouncy); // released early: springs back
      }
    });

  const thumb = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value + nudge.value },
      { rotate: `${interpolate(vel.value, [-1500, 0, 1500], [-16, 0, 16], 'clamp') + (x.value / max) * 360}deg` }, // curls into a ball and rolls
    ],
  }));
  const trail = useAnimatedStyle(() => ({ width: x.value + TRACK_H }));
  const text = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, max * 0.5], [1, 0], 'clamp') }));
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(x.value, [0, max], [colors.purpleSoft, '#F9D9EC']) }));

  return (
    <Animated.View style={[styles.track, { width }, track, disabled && { opacity: 0.5 }]} accessibilityRole="adjustable" accessibilityLabel={label}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: TRACK_H, overflow: 'hidden' }, trail]}>
        <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, width }} />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: TRACK_H, right: 16, alignItems: 'center' }, text]}>
        <T v="h3" color={colors.purple}>{label}  ››</T>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.thumb, thumb]}>
          <View style={{ marginTop: -6 }}><Mascot size={50} mood={mood} /></View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// ---------------- Scan beam (QR / receipt) ----------------
export function ScanBeam({ height, active }: { height: number; active: boolean }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = active ? withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }), -1, true) : withTiming(0);
  }, [active]);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value * (height - 6) }], opacity: active ? 1 : 0 }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, height: 60 }, a]}>
      <LinearGradient colors={['rgba(255,111,177,0)', 'rgba(255,111,177,0.45)']} style={{ flex: 1 }} />
      <View style={{ height: 3, backgroundColor: colors.pink, borderRadius: 2 }} />
    </Animated.View>
  );
}

// ---------------- Progress bar ("2 of 4 settled") ----------------
export function Progress({ value }: { value: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withSpring(Math.max(0, Math.min(1, value)), spring.gentle);
  }, [value]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' }}>
      <Animated.View style={[{ height: 8, borderRadius: 4, backgroundColor: value >= 1 ? colors.mint : colors.pink }, a]} />
    </View>
  );
}

const styles = StyleSheet.create({
  key: { flex: 1, height: 58, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.06, elevation: 1 },
  gridKey: { height: 58, borderRadius: radius.md, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.06, elevation: 1 },
  track: { height: TRACK_H, borderRadius: TRACK_H, justifyContent: 'center' },
  thumb: { width: TRACK_H - 8, height: TRACK_H - 8, margin: 4, borderRadius: TRACK_H, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
});

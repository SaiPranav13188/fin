/** Your month, as a story: tap to move on, auto-advances, share at the end. */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, SharedValue, FadeIn, FadeInDown, FadeInUp, ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence,
  withSpring, withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Confetti } from '@/components/fx';
import { Mascot, Mood } from '@/components/Mascot';
import { Avatar, Btn, RollingNumber, Skeleton, T } from '@/components/ui';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { CATEGORY, colors, font, radius, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

type Wrapped = {
  month: string; month_name: string; total_paise: number; prev_total_paise: number; change_pct: number | null; expense_count: number;
  groups_active: number; paid_back_paise: number; has_data: boolean; busiest_day: string | null;
  by_category: { category: string; paise: number; prev_paise: number; change_pct: number | null }[];
  biggest: { description: string; paise: number; group: string; category: string } | null;
  top_buddy: { name: string; count: number } | null;
};

const SLIDE_MS = 5200;
const THEMES: [string, string][] = [['#FF6FB1', '#9B5CFF'], ['#7B4DFF', '#3BA7FF'], ['#FF7A6B', '#FFB020'], ['#19C08A', '#3BA7FF'], ['#9B5CFF', '#FF6FB1']];

/** Counts up from zero so the number feels earned. */
function useCountUp(target: number, run: boolean, ms = 1100) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!run) return setV(0);
    const start = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [target, run]);
  return v;
}

function Bar({ pct, color, delay = 0, h = 14 }: { pct: number; color: string; delay?: number; h?: number }) {
  const w = useSharedValue(0);
  useEffect(() => {
    w.value = withDelay(delay, withSpring(Math.max(0.03, Math.min(1, pct)), spring.gentle));
  }, [pct]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return <View style={{ height: h, borderRadius: h / 2, backgroundColor: 'rgba(255,255,255,0.25)' }}><Animated.View style={[{ height: h, borderRadius: h / 2, backgroundColor: color }, a]} /></View>;
}

function Floaty({ children, style }: { children: React.ReactNode; style?: object }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withSequence(withTiming(-10, { duration: 1100, easing: Easing.inOut(Easing.quad) }), withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.quad) })), -1);
  }, []);
  const a = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

export default function WrappedScreen() {
  const q = useQuery({ queryKey: ['wrapped'], queryFn: () => api<Wrapped>('/me/wrapped') });
  const w = q.data;
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const progress = useSharedValue(0);
  const slides = w?.has_data ? 5 : 1;

  const go = (n: number) => {
    if (n < 0) return;
    if (n >= slides) return;
    haptic.tick();
    setI(n);
  };
  // Each slide fills its progress bar, then moves on. The last one stays.
  useEffect(() => {
    if (!w?.has_data) return;
    progress.value = 0;
    if (paused || i >= slides - 1) return;
    progress.value = withTiming(1, { duration: SLIDE_MS, easing: Easing.linear }, (done) => {
      if (done) scheduleOnRN(go, i + 1);
    });
  }, [i, paused, w?.has_data]);

  const total = useCountUp(w?.total_paise ?? 0, i === 1);
  const share = async () => {
    if (!w) return;
    const top = w.by_category[0];
    await Share.share({ message: `My ${w.month_name} on Fin: I spent ${rupees(w.total_paise)}${top ? `, mostly on ${CATEGORY[top.category]?.label ?? top.category}` : ''}${w.top_buddy ? `, and split the most with ${w.top_buddy.name}` : ''}. 🪙` }).catch(() => {});
  };

  const theme = THEMES[Math.min(i, THEMES.length - 1)];
  const top = w?.by_category[0];
  const topCat = top ? CATEGORY[top.category] ?? CATEGORY.other : null;
  const mood: Mood = i === 0 ? 'excited' : i === 1 ? (w && w.change_pct !== null && w.change_pct > 15 ? 'worried' : 'happy') : i === 4 ? 'cheer' : 'idle';

  return (
    <View style={{ flex: 1, backgroundColor: theme[0] }}>
      <LinearGradient colors={theme} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={{ flex: 1 }}>
        <Confetti fire={i === 4 && w?.has_data ? i : 0} coins />
        {/* story progress */}
        <View style={{ flexDirection: 'row', gap: 5, paddingHorizontal: 16, paddingTop: 6 }}>
          {Array.from({ length: slides }, (_, k) => <Segment key={k} state={k < i ? 'done' : k === i ? 'live' : 'todo'} progress={progress} last={k === slides - 1} />)}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 }}>
          <T v="tiny" color="rgba(255,255,255,0.85)">Fin Wrapped</T>
          <Pressable onPress={() => router.back()} hitSlop={14} accessibilityLabel="Close"><Text style={{ color: '#fff', fontSize: 24, fontFamily: font.bold }}>✕</Text></Pressable>
        </View>

        <View style={{ flex: 1 }}>
          {q.isLoading ? (
            <View style={{ padding: 28, gap: 14, marginTop: 60 }}><Skeleton h={60} /><Skeleton h={140} /></View>
          ) : !w?.has_data ? (
            <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 28 }}>
              <Mascot size={150} mood="sleepy" />
              <T v="h1" color="#fff" center>Nothing to wrap up yet</T>
              <T color="rgba(255,255,255,0.85)" center>Add a few expenses this month and come back. Fin will turn them into your story.</T>
              <Btn title="Back" kind="soft" onPress={() => router.back()} />
            </Animated.View>
          ) : (
            <View key={i} style={{ flex: 1, padding: 28, justifyContent: 'center', gap: 18 }}>
              {i === 0 ? (
                <>
                  <Animated.View entering={ZoomIn.springify().damping(9)} style={{ alignItems: 'center' }}><Mascot size={170} mood={mood} /></Animated.View>
                  <Animated.View entering={FadeInUp.delay(300).springify()}><T v="tiny" color="rgba(255,255,255,0.85)" center>Your month on Fin</T></Animated.View>
                  <Animated.View entering={FadeInUp.delay(450).springify().damping(12)}><Text style={styles.hero}>{w.month_name}</Text></Animated.View>
                  <Animated.View entering={FadeIn.delay(900)}><T color="rgba(255,255,255,0.9)" center>{w.expense_count} expense{w.expense_count === 1 ? '' : 's'} across {w.groups_active} group{w.groups_active === 1 ? '' : 's'}. Ready?</T></Animated.View>
                </>
              ) : null}

              {i === 1 ? (
                <>
                  <Animated.View entering={FadeInDown.springify()}><T v="tiny" color="rgba(255,255,255,0.85)" center>Your share this month</T></Animated.View>
                  <View style={{ alignItems: 'center' }}><RollingNumber text={rupees(total)} size={52} color="#fff" /></View>
                  {w.change_pct !== null ? (
                    <Animated.View entering={FadeInUp.delay(1300).springify()} style={styles.pill}>
                      <T w="bold" color="#fff" center>{w.change_pct === 0 ? 'Same as last month' : `${w.change_pct > 0 ? '▲' : '▼'} ${Math.abs(w.change_pct)}% ${w.change_pct > 0 ? 'more' : 'less'} than last month`}</T>
                    </Animated.View>
                  ) : <Animated.View entering={FadeIn.delay(1300)}><T color="rgba(255,255,255,0.9)" center>Your first month on Fin 🎉</T></Animated.View>}
                  {w.prev_total_paise > 0 ? (
                    <Animated.View entering={FadeIn.delay(900)} style={{ gap: 8, marginTop: 6 }}>
                      <T v="small" color="rgba(255,255,255,0.85)">This month</T>
                      <Bar pct={w.total_paise / Math.max(w.total_paise, w.prev_total_paise)} color="#fff" delay={1000} />
                      <T v="small" color="rgba(255,255,255,0.85)">Last month · {rupees(w.prev_total_paise)}</T>
                      <Bar pct={w.prev_total_paise / Math.max(w.total_paise, w.prev_total_paise)} color="rgba(255,255,255,0.55)" delay={1200} />
                    </Animated.View>
                  ) : null}
                </>
              ) : null}

              {i === 2 && topCat && top ? (
                <>
                  <Animated.View entering={FadeInDown.springify()}><T v="tiny" color="rgba(255,255,255,0.85)" center>Where it went</T></Animated.View>
                  <Floaty style={{ alignItems: 'center' }}><Animated.Text entering={ZoomIn.delay(200).springify().damping(7)} style={{ fontSize: 96 }}>{topCat.emoji}</Animated.Text></Floaty>
                  <Animated.View entering={FadeInUp.delay(400).springify()}><T v="h1" color="#fff" center>{topCat.label} took the crown</T></Animated.View>
                  <Animated.View entering={FadeIn.delay(600)}><T color="rgba(255,255,255,0.9)" center>{rupees(top.paise)} · {Math.round((top.paise / Math.max(w.total_paise, 1)) * 100)}% of your month{top.change_pct !== null && Math.abs(top.change_pct) >= 5 ? `. That's ${Math.abs(top.change_pct)}% ${top.change_pct > 0 ? 'more' : 'less'} than last month.` : '.'}</T></Animated.View>
                  <View style={{ gap: 10, marginTop: 6 }}>
                    {w.by_category.slice(0, 4).map((c, k) => (
                      <Animated.View key={c.category} entering={FadeInDown.delay(700 + k * 120)} style={{ gap: 4 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" w="bold" color="#fff">{(CATEGORY[c.category] ?? CATEGORY.other).emoji} {(CATEGORY[c.category] ?? CATEGORY.other).label}</T><T v="small" w="bold" color="#fff">{rupees(c.paise)}</T></View>
                        <Bar pct={c.paise / top.paise} color="#fff" delay={900 + k * 140} h={10} />
                      </Animated.View>
                    ))}
                  </View>
                </>
              ) : null}

              {i === 3 ? (
                <>
                  <Animated.View entering={FadeInDown.springify()}><T v="tiny" color="rgba(255,255,255,0.85)" center>Moments</T></Animated.View>
                  {w.biggest ? (
                    <Animated.View entering={ZoomIn.delay(200).springify().damping(10)} style={styles.card}>
                      <T v="tiny" color={colors.inkFaint}>Biggest expense</T>
                      <T v="h2">{(CATEGORY[w.biggest.category] ?? CATEGORY.other).emoji} {w.biggest.description}</T>
                      <T v="h1" color={colors.purple}>{rupees(w.biggest.paise)}</T>
                      <T v="small" color={colors.inkSoft}>in {w.biggest.group}</T>
                    </Animated.View>
                  ) : null}
                  {w.top_buddy ? (
                    <Animated.View entering={ZoomIn.delay(500).springify().damping(10)} style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                      <Avatar name={w.top_buddy.name} index={1} size={52} />
                      <View style={{ flex: 1 }}><T v="tiny" color={colors.inkFaint}>Your split buddy</T><T v="h2">{w.top_buddy.name}</T><T v="small" color={colors.inkSoft}>{w.top_buddy.count} shared expenses</T></View>
                    </Animated.View>
                  ) : null}
                  {w.busiest_day ? (
                    <Animated.View entering={FadeInUp.delay(900).springify()}><T color="#fff" center w="semi">📅 You spend the most on {w.busiest_day}s</T></Animated.View>
                  ) : null}
                </>
              ) : null}

              {i === 4 ? (
                <>
                  <Animated.View entering={ZoomIn.springify().damping(8)} style={{ alignItems: 'center' }}><Mascot size={160} mood="cheer" /></Animated.View>
                  <Animated.View entering={FadeInUp.delay(300).springify()}><T v="h1" color="#fff" center>{w.change_pct !== null && w.change_pct < 0 ? 'Nicely done!' : 'That was your month'}</T></Animated.View>
                  <Animated.View entering={FadeIn.delay(600)}>
                    <T color="rgba(255,255,255,0.92)" center>
                      {w.paid_back_paise > 0 ? `You paid friends back ${rupees(w.paid_back_paise)} through Fin. ` : ''}
                      {coach(w)}
                    </T>
                  </Animated.View>
                  <Animated.View entering={FadeInUp.delay(900).springify()} style={{ gap: 10, marginTop: 8 }}>
                    <Btn title="Share my month" icon="📣" onPress={share} />
                    <Btn title="Done" kind="ghost" onPress={() => router.back()} />
                  </Animated.View>
                </>
              ) : null}
            </View>
          )}
          {/* tap left to go back, right to go forward, hold to pause */}
          {w?.has_data ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              <View style={{ flex: 1, flexDirection: 'row' }} pointerEvents="box-none">
                <Pressable style={{ flex: 1 }} onPress={() => go(i - 1)} onPressIn={() => setPaused(true)} onPressOut={() => setPaused(false)} accessibilityLabel="Previous" />
                <Pressable style={{ flex: 2 }} onPress={() => go(i + 1)} onPressIn={() => setPaused(true)} onPressOut={() => setPaused(false)} accessibilityLabel="Next" />
              </View>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

/** One line of advice, from the numbers. Deliberately gentle. */
function coach(w: Wrapped): string {
  const top = w.by_category[0];
  const rising = w.by_category.filter((c) => c.change_pct !== null && c.change_pct >= 30 && c.paise >= 50000).sort((a, b) => (b.change_pct ?? 0) - (a.change_pct ?? 0))[0];
  if (rising) return `${(CATEGORY[rising.category] ?? CATEGORY.other).label} jumped ${rising.change_pct}% from last month. Worth a glance next month.`;
  if (w.change_pct !== null && w.change_pct < -10) return `You spent ${Math.abs(w.change_pct)}% less than last month. Keep it up!`;
  if (top) return `${(CATEGORY[top.category] ?? CATEGORY.other).label} is your biggest category. See you next month!`;
  return 'See you next month!';
}

function Segment({ state, progress, last }: { state: 'done' | 'live' | 'todo'; progress: SharedValue<number>; last: boolean }) {
  const a = useAnimatedStyle(() => ({ width: state === 'done' ? '100%' : state === 'live' ? (last ? '100%' : `${progress.value * 100}%`) : '0%' }));
  return <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden' }}><Animated.View style={[{ height: 4, backgroundColor: '#fff' }, a]} /></View>;
}

const styles = StyleSheet.create({
  hero: { fontFamily: font.extra, fontSize: 64, lineHeight: 70, color: '#fff', textAlign: 'center', letterSpacing: -2 },
  pill: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.22)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 18, gap: 2 },
});

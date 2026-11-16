import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn, FadeInDown, FadeOut, LinearTransition, interpolate, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { Mascot, Mood } from '@/components/Mascot';
import { Avatar, Card, Empty, Press, RollingNumber, Skeleton, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { queryClient, refreshAll, useGroups, useMe, useReminders, useSummary } from '@/lib/hooks';
import { flushQueue, useQueue } from '@/lib/offline';
import { useStore } from '@/lib/store';
import { colors, font, radius, shadow, spring } from '@/lib/theme';
import { useTilt } from '@/lib/tilt';
import { haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

const ACTIONS = [
  { key: 'split', emoji: '🍕', label: 'Split', go: '/add-expense' },
  { key: 'scan', emoji: '🧾', label: 'Scan bill', go: '/scan' },
  { key: 'ask', emoji: '✨', label: 'Ask Fin', go: '/assistant' },
  { key: 'qr', emoji: '📷', label: 'Pay QR', go: '/qr' },
  { key: 'settle', emoji: '🤝', label: 'Settle', go: '/settle' },
] as const;

function DockAction({ i, open, emoji, label, onPress }: { i: number; open: boolean; emoji: string; label: string; onPress: () => void }) {
  // Fan out on a semicircle above the mascot.
  const angle = Math.PI - (Math.PI / (ACTIONS.length - 1)) * i;
  const p = useSharedValue(0);
  React.useEffect(() => {
    p.value = open ? withDelay(i * 45, withSpring(1, spring.bouncy)) : withTiming(0, { duration: 140 });
  }, [open]);
  const a = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: Math.cos(angle) * 128 * p.value }, { translateY: -Math.sin(angle) * 118 * p.value - 30 * p.value }, { scale: interpolate(p.value, [0, 1], [0.3, 1]) }],
  }));
  return (
    <Animated.View style={[{ position: 'absolute', alignItems: 'center', gap: 6 }, a]} pointerEvents={open ? 'auto' : 'none'}>
      <Press onPress={onPress} style={styles.action} scaleTo={0.88} label={label}>
        <Text style={{ fontSize: 26 }}>{emoji}</Text>
      </Press>
      <T v="small" w="bold" color="#fff">{t(label)}</T>
    </Animated.View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const summary = useSummary();
  const groups = useGroups();
  const reminders = useReminders();
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [peek, setPeek] = useState<Mood | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const tilt = useTilt();
  const showToast = useStore((s) => s.showToast);
  const waiting = useQueue((s) => s.items.length);

  const owed = summary.data?.you_are_owed_paise ?? 0;
  const owe = summary.data?.you_owe_paise ?? 0;
  const net = owed - owe;
  const hour = new Date().getHours();
  const dueSoon = (reminders.data ?? []).some((r) => r.kind !== 'split');
  // Fin's mood comes from real data: worried when a bill is due, happy when you're owed, sleepy at night.
  const dockMood: Mood = open ? 'excited' : hour >= 23 || hour < 6 ? 'sleepy' : dueSoon ? 'worried' : net > 0 ? 'happy' : 'sleepy';

  const cardTilt = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${tilt.x.value * 5}deg` }, { rotateX: `${-tilt.y.value * 4}deg` }],
  }));
  const shine = useAnimatedStyle(() => ({ transform: [{ translateX: tilt.x.value * 60 }, { rotate: '20deg' }] }));

  const reveal = async () => {
    if (revealed) return setRevealed(false);
    haptic.tap();
    try {
      const can = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
      if (can) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Show your balance' });
        if (!r.success) return;
      }
    } catch {}
    // Fin peeks over the card, glances at the number, then covers its eyes.
    setPeek('excited');
    setRevealed(true);
    setTimeout(() => setPeek('covering'), 900);
    setTimeout(() => setPeek(null), 3200);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    haptic.tap();
    await refreshAll();
    setRefreshing(false);
  }, []);

  const act = async (r: { id: string }, action: 'done' | 'dismiss') => {
    try {
      await api(`/reminders/${r.id}/${action}`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: ['reminders'] });
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t("Try again"), 'warn');
    }
  };

  const go = (path: string) => {
    setOpen(false);
    const first = groups.data?.[0];
    if (!first && path !== '/assistant' && path !== '/qr') return router.push('/group/new');
    router.push(path as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 190, gap: 18 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.pink} colors={[colors.pink, colors.purple]} />}>
        <Animated.View entering={FadeIn} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <T v="small" color={colors.inkSoft}>{hour < 12 ? t("Good morning") : hour < 17 ? t("Good afternoon") : t("Good evening")}</T>
            <T v="h1">{me.data?.name?.split(' ')[0] ?? ' '}</T>
          </View>
          <Press onPress={() => router.push('/profile')} label="Profile"><Avatar name={me.data?.name ?? '?'} index={1} size={46} /></Press>
        </Animated.View>

        {waiting ? (
          <Press onPress={() => flushQueue(refreshAll)} style={{ backgroundColor: colors.amberSoft, borderRadius: radius.pill, paddingVertical: 10, paddingHorizontal: 16, alignSelf: 'center' }} label="Sync now">
            <T v="small" w="bold">⏳ {waiting === 1 ? '1 expense is' : `${waiting} expenses are`} waiting to sync · tap to retry</T>
          </Press>
        ) : null}

        {/* balance card with tilt parallax */}
        <View>
          {peek ? (
            <Animated.View entering={FadeInDown.springify().damping(11)} exiting={FadeOut} style={{ position: 'absolute', right: 84, top: -60, zIndex: 0 }}>
              <Mascot size={84} mood={peek} speech={peek === 'covering' ? t("Not peeking, promise 🙈") : undefined} />
            </Animated.View>
          ) : null}
          <Animated.View style={[{ borderRadius: radius.xl, ...shadow, shadowOpacity: 0.3 }, cardTilt]}>
            <Press onPress={reveal} scaleTo={0.98} label={revealed ? 'Hide balance' : 'Show balance'}>
              <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balance}>
                <Animated.View style={[styles.shine, shine]} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <T v="tiny" color="rgba(255,255,255,0.85)">{net >= 0 ? t("Overall, you're owed") : t("Overall, you owe")}</T>
                  <T v="small" color="rgba(255,255,255,0.9)" w="bold">{revealed ? '🙈 Hide' : '👆 Tap to see'}</T>
                </View>
                {summary.isLoading ? <View style={{ height: 52 }} /> : revealed ? (
                  <RollingNumber text={rupees(Math.abs(net))} size={42} color="#fff" />
                ) : (
                  <Text style={{ fontFamily: font.extra, fontSize: 42, color: '#fff', letterSpacing: 4, height: 50 }}>₹ • • • •</Text>
                )}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                  <View style={styles.pill}><T v="small" w="bold" color="#fff">↓ {revealed ? rupees(owed) : '•••'} to get</T></View>
                  <View style={styles.pill}><T v="small" w="bold" color="#fff">↑ {revealed ? rupees(owe) : '•••'} to pay</T></View>
                </View>
              </LinearGradient>
            </Press>
          </Animated.View>
        </View>

        {/* reminders strip: collapses away when empty */}
        {(reminders.data?.length ?? 0) > 0 ? (
          <Animated.View entering={FadeInDown.springify()} exiting={FadeOut} layout={LinearTransition.springify()} style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="h3">{t("Coming up")}</T>
              <Press onPress={() => router.push('/reminders')}><T v="small" w="bold" color={colors.purple}>{t("See all")}</T></Press>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}>
              {reminders.data!.map((r, i) => (
                <Animated.View key={r.id} entering={FadeInDown.delay(i * 50).springify()} exiting={FadeOut} layout={LinearTransition.springify()} style={styles.reminder}>
                  <Text style={{ fontSize: 22 }}>{r.kind === 'subscription' ? '🔁' : r.kind === 'split' ? '💸' : '📅'}</Text>
                  <T v="small" w="semi" numberOfLines={3} style={{ flex: 1 }}>{r.message}</T>
                  <View style={{ flexDirection: 'row', gap: 12 }}>
                    <Press onPress={() => act(r, 'done')}><T v="small" w="bold" color={colors.mint}>{t("Done")}</T></Press>
                    <Press onPress={() => act(r, 'dismiss')}><T v="small" w="bold" color={colors.inkFaint}>{t("Later")}</T></Press>
                  </View>
                </Animated.View>
              ))}
            </ScrollView>
          </Animated.View>
        ) : null}

        <Animated.View layout={LinearTransition.springify()} style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <T v="h3">{t("Your groups")}</T>
            <Press onPress={() => router.push('/group/new')} style={styles.newBtn} label={t("New group")}><T v="small" w="bold" color={colors.purple}>{t("＋ New")}</T></Press>
          </View>
          {groups.isLoading ? [0, 1, 2].map((i) => <Skeleton key={i} h={76} />) : groups.isError ? (
            <Empty title={t("Can't reach Fin")} sub={t("Check your internet and pull down to try again.")}><Mascot size={90} mood="worried" prop="umbrella" /></Empty>
          ) : groups.data!.length === 0 ? (
            <Empty title={t("No groups yet")} sub={t("Make one for your flat, a trip or your squad.")}><Mascot size={90} mood="idle" /></Empty>
          ) : groups.data!.map((g, i) => (
            <Card key={g.id} index={i} style={{ padding: 0 }}>
              <Press onPress={() => router.push(`/group/${g.id}`)} scaleTo={0.97} style={styles.groupRow} label={g.name}>
                <View style={styles.emoji}><Text style={{ fontSize: 24 }}>{g.emoji}</Text></View>
                <View style={{ flex: 1 }}>
                  <T v="h3" numberOfLines={1}>{g.name}</T>
                  <T v="small" color={colors.inkSoft}>{g.members.length} people</T>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {g.my_balance_paise === 0 ? <T v="small" w="bold" color={colors.mint}>{t("Square ✓")}</T> : (
                    <>
                      <T v="tiny" color={colors.inkFaint}>{g.my_balance_paise > 0 ? t("you get") : t("you owe")}</T>
                      <T v="h3" color={g.my_balance_paise > 0 ? colors.mint : colors.coral}>{rupees(Math.abs(g.my_balance_paise))}</T>
                    </>
                  )}
                </View>
              </Press>
            </Card>
          ))}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Press onPress={() => router.push('/insights')} style={[styles.tile, { backgroundColor: colors.purpleSoft }]}><Text style={{ fontSize: 24 }}>📊</Text><T v="small" w="bold">{t("Insights")}</T></Press>
            <Press onPress={() => router.push('/reminders')} style={[styles.tile, { backgroundColor: colors.amberSoft }]}><Text style={{ fontSize: 24 }}>📅</Text><T v="small" w="bold">{t("Bills & subs")}</T></Press>
          </View>
        </Animated.View>
      </ScrollView>

      {/* dim + blur behind the fanned-out actions */}
      {open ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(140)} style={StyleSheet.absoluteFill}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim }]} onPress={() => setOpen(false)} accessibilityLabel="Close menu" />
        </Animated.View>
      ) : null}

      {/* the dock: Fin sleeps at the bottom edge; tap to wake */}
      <View style={[styles.dock, { bottom: insets.bottom + 8 }]} pointerEvents="box-none">
        {ACTIONS.map((a, i) => <DockAction key={a.key} i={i} open={open} emoji={a.emoji} label={a.label} onPress={() => go(a.go)} />)}
        <Press onPress={() => { haptic.bump(); setOpen(!open); }} scaleTo={0.9} label="Open actions">
          <Mascot size={104} mood={dockMood} lookX={tilt.x} lookY={tilt.y} hopKey={open ? 1 : 0} />
        </Press>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  balance: { borderRadius: radius.xl, padding: 22, gap: 8, overflow: 'hidden' },
  shine: { position: 'absolute', top: -40, left: 60, width: 70, height: 300, backgroundColor: 'rgba(255,255,255,0.13)' },
  pill: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  reminder: { width: 210, backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, gap: 8, ...shadow, shadowOpacity: 0.08 },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  emoji: { width: 50, height: 50, borderRadius: 18, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center' },
  newBtn: { backgroundColor: colors.purpleSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  tile: { flex: 1, borderRadius: radius.lg, padding: 16, gap: 6 },
  dock: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'flex-end' },
  action: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow },
});

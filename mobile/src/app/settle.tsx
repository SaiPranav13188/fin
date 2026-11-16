/** Settle up: plan -> safety check -> swipe to pay -> your UPI app -> "Did it go through?" -> calm result. */
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, ZoomIn, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withRepeat,
  withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { Mascot } from '@/components/Mascot';
import { Confetti, SwipeToPay } from '@/components/fx';
import { Avatar, Btn, Card, Chip, Empty, Press, RollingNumber, Screen, Skeleton, T } from '@/components/ui';
import { ApiError, SafetyFlag, api } from '@/lib/api';
import { refreshAll, useGroup, useGroups } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { colors, radius, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

const { width: W } = Dimensions.get('window');
type Step = { from_member: string; to_member: string; amount_paise: number; upi_link: string | null; over_upi_limit: boolean; from_name: string; to_name: string; mine: boolean; needs_upi_id: boolean };
type Phase = 'plan' | 'check' | 'pay' | 'processing' | 'ask' | 'success' | 'pending' | 'failed';
const CALM = ['Breathe in… breathe out…', 'Banks are slow sometimes ☕', 'Carrying your coins carefully…', 'Almost there…'];
const APath = Animated.createAnimatedComponent(Path);

/** Fin carries a coin along a dotted arc from You to your friend. The trail is the progress bar. */
function Processing({ from, to }: { from: string; to: string }) {
  const prog = useSharedValue(0);
  const [line, setLine] = useState(0);
  const width = W - 80;
  useEffect(() => {
    prog.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.quad) }), -1, false);
    const i = setInterval(() => setLine((l) => (l + 1) % CALM.length), 1900);
    return () => clearInterval(i);
  }, []);
  const walker = useAnimatedStyle(() => {
    const x = prog.value * width;
    const y = -Math.sin(prog.value * Math.PI) * 70;
    return { transform: [{ translateX: x - 32 }, { translateY: y - 62 }, { rotate: `${Math.sin(prog.value * Math.PI * 10) * 6}deg` }] };
  });
  const arc = `M 0 80 Q ${width / 2} ${80 - 140} ${width} 80`;
  const trail = useAnimatedProps(() => ({ strokeDashoffset: (1 - prog.value) * (width * 1.25) }));
  return (
    <Animated.View entering={FadeIn} style={{ alignItems: 'center', gap: 26, paddingTop: 50 }}>
      <View style={{ width, height: 130 }}>
        <Svg width={width} height={90} style={{ position: 'absolute', top: 10 }}>
          <Path d={arc} stroke={colors.line} strokeWidth={4} strokeDasharray="2 10" strokeLinecap="round" fill="none" />
          <APath d={arc} stroke={colors.pink} strokeWidth={4} strokeLinecap="round" fill="none" strokeDasharray={`${width * 1.25}`} animatedProps={trail} />
        </Svg>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 90 }, walker]}><Mascot size={64} mood="happy" prop="coin" /></Animated.View>
        <View style={{ position: 'absolute', left: -22, top: 78 }}><Avatar name={from} index={0} size={40} /></View>
        <View style={{ position: 'absolute', right: -22, top: 78 }}><Avatar name={to} index={1} size={40} /></View>
      </View>
      <Animated.View key={line} entering={FadeInDown} exiting={FadeOut}><T v="h3" color={colors.inkSoft} center>{t(CALM[line])}</T></Animated.View>
    </Animated.View>
  );
}

export default function Settle() {
  const params = useLocalSearchParams<{ group?: string }>();
  const groups = useGroups();
  const [groupId, setGroupId] = useState(params.group);
  useEffect(() => {
    if (!groupId && groups.data?.length) setGroupId((groups.data.find((g) => g.my_balance_paise !== 0) ?? groups.data[0]).id);
  }, [groups.data]);
  const group = useGroup(groupId);
  const [plan, setPlan] = useState<{ steps: Step[]; summary: string } | null>(null);
  const [phase, setPhase] = useState<Phase>('plan');
  const [cur, setCur] = useState<Step | null>(null);
  const [flags, setFlags] = useState<SafetyFlag[]>([]);
  const [busy, setBusy] = useState(false);
  const [boom, setBoom] = useState(0);
  const [waited, setWaited] = useState(0);
  const leftApp = useRef(false);
  const showToast = useStore((s) => s.showToast);
  const float = useSharedValue(0);

  const load = async () => {
    if (!groupId) return;
    try {
      setPlan(await api('/agent/settle-plan', { body: { group_id: groupId } }));
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not load', 'warn');
    }
  };
  useEffect(() => { setPlan(null); load(); }, [groupId]);

  // When the user comes back from their UPI app, play the walk, then ask.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && phase === 'processing') leftApp.current = true;
      if (s === 'active' && phase === 'processing' && leftApp.current) setTimeout(() => setPhase('ask'), 1600);
    });
    return () => sub.remove();
  }, [phase]);
  // pending: a live "banks usually take 30 seconds" timer
  useEffect(() => {
    if (phase !== 'pending') return;
    setWaited(0);
    const i = setInterval(() => setWaited((w) => w + 1), 1000);
    return () => clearInterval(i);
  }, [phase]);

  const start = async (s: Step) => {
    setCur(s);
    setBusy(true);
    try {
      const r = await api('/agent/safety-check', { body: { group_id: groupId, to_member: s.to_member, amount_paise: s.amount_paise } });
      setFlags(r.flags);
      if (r.flags.length) { haptic.warn(); setPhase('check'); } else setPhase('pay');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not check this payment', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const openUpi = async () => {
    if (!cur?.upi_link) return;
    leftApp.current = false;
    setPhase('processing');
    try {
      await Linking.openURL(cur.upi_link);
    } catch {
      setPhase('failed'); // no UPI app installed
      return;
    }
    setTimeout(() => setPhase((p) => (p === 'processing' && !leftApp.current ? 'ask' : p)), 6000);
  };

  const record = async (s: Step, method: 'upi' | 'cash') => {
    setBusy(true);
    try {
      await api(`/groups/${groupId}/settlements`, { body: { from_member: s.from_member, to_member: s.to_member, amount_paise: s.amount_paise, method } });
      setCur(s);
      setPhase('success');
      setBoom(Date.now());
      haptic.success();
      float.value = 0;
      float.value = withDelay(350, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
      refreshAll();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not record that', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const floatStyle = useAnimatedStyle(() => ({ opacity: float.value < 0.9 ? float.value * 1.4 : (1 - float.value) * 10, transform: [{ translateY: -float.value * 70 }, { scale: 0.8 + float.value * 0.4 }] }));
  const backToPlan = () => { setPhase('plan'); setCur(null); setPlan(null); load(); };

  const title = phase === 'plan' ? t("Settle up") : phase === 'success' ? '' : cur ? `Pay ${cur.to_name}` : '';
  return (
    <Screen title={title}>
      <Confetti fire={boom} coins />
      {phase === 'plan' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          {(groups.data?.length ?? 0) > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {groups.data!.map((g) => <Chip key={g.id} label={g.name} emoji={g.emoji} active={g.id === groupId} onPress={() => setGroupId(g.id)} />)}
            </ScrollView>
          ) : null}
          {!plan ? <><Skeleton h={90} /><Skeleton h={90} /></> : plan.steps.length === 0 ? (
            <Empty title={t("All settled 🎉")} sub={t("Nobody owes anybody in this group.")}><Mascot size={130} mood="cheer" /></Empty>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Mascot size={62} mood="thinking" prop="calculator" />
                <T color={colors.inkSoft} style={{ flex: 1 }}>{plan.summary}</T>
              </View>
              {plan.steps.map((s, i) => (
                <Card key={i} index={i} style={{ gap: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Avatar name={s.from_name} index={i} size={40} />
                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <T v="h2">{rupees(s.amount_paise)}</T>
                      <T v="small" color={colors.inkSoft}>{s.mine ? t("You") : s.from_name.split(' ')[0]} → {s.to_name === group.data?.members.find((m) => m.is_self)?.name ? t("You") : s.to_name.split(' ')[0]}</T>
                    </View>
                    <Avatar name={s.to_name} index={i + 3} size={40} />
                  </View>
                  {s.mine ? (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Btn small title={t("Paid in cash")} kind="soft" onPress={() => record(s, 'cash')} style={{ flex: 1 }} />
                      <Btn small title={t("Pay with UPI")} onPress={() => start(s)} loading={busy && cur === s} style={{ flex: 1 }} />
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <Btn small title={t("Got it in cash")} kind="soft" onPress={() => record(s, 'cash')} style={{ flex: 1 }} />
                      <Btn small title={t("Remind")} icon="💌" kind="soft" style={{ flex: 1 }}
                        onPress={() => router.push({ pathname: '/assistant', params: { group: groupId, nudge: s.from_member } })} />
                    </View>
                  )}
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      ) : null}

      {phase === 'check' && cur ? (
        <Animated.View entering={FadeInDown.springify()} style={{ flex: 1, gap: 14, paddingTop: 44 }}>
          <View style={{ alignItems: 'center' }}><Mascot size={110} mood="thinking" prop="magnifier" speech={t("One quick check first")} /></View>
          {flags.map((f, i) => (
            <Animated.View key={f.code} entering={FadeInDown.delay(i * 80).springify()} style={[styles.flag, { backgroundColor: f.level === 'block' ? colors.coralSoft : colors.amberSoft }]}>
              <Text style={{ fontSize: 22 }}>{f.level === 'block' ? '✋' : '🛡️'}</Text>
              <View style={{ flex: 1 }}><T v="h3">{f.title}</T><T v="small" color={colors.inkSoft}>{f.detail}</T></View>
            </Animated.View>
          ))}
          <View style={{ flex: 1 }} />
          {flags.some((f) => f.level === 'block') ? (
            <Btn title={t("Mark as paid in cash instead")} kind="soft" onPress={() => record(cur, 'cash')} loading={busy} />
          ) : <Btn title={t("Looks right, continue")} onPress={() => setPhase('pay')} />}
          <Btn title={t("Go back")} kind="ghost" onPress={backToPlan} />
        </Animated.View>
      ) : null}

      {phase === 'pay' && cur ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', paddingBottom: 30 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Animated.View entering={ZoomIn.springify().damping(10)}><Avatar name={cur.to_name} index={4} size={84} /></Animated.View>
            <T v="h2">{cur.to_name}</T>
            <T v="small" color={colors.inkSoft}>{group.data?.members.find((m) => m.id === cur.to_member)?.upi_id}</T>
            <RollingNumber text={rupees(cur.amount_paise)} size={52} />
            <T v="small" color={colors.inkFaint} center style={{ maxWidth: 260 }}>{t("This opens your UPI app with everything filled in. You enter your PIN there, never in Fin.")}</T>
          </View>
          <SwipeToPay label={t("Swipe to pay")} onDone={openUpi} />
        </Animated.View>
      ) : null}

      {phase === 'processing' && cur ? <Processing from="You" to={cur.to_name} /> : null}

      {phase === 'ask' && cur ? (
        <Animated.View entering={FadeInDown.springify()} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Mascot size={130} mood="idle" speech={t("Did it go through?")} />
          <T v="h2" center>{rupees(cur.amount_paise)} to {cur.to_name}</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
            <Btn title={t("Yes, it's paid")} icon="✓" onPress={() => record(cur, 'upi')} loading={busy} />
            <Btn title={t("Still pending")} kind="soft" onPress={() => setPhase('pending')} />
            <Btn title={t("It failed")} kind="ghost" onPress={() => { haptic.warn(); setPhase('failed'); }} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'pending' && cur ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Mascot size={140} mood="idle" prop="tea" />
          <T v="h2" center>{t("Sipping tea while we wait")}</T>
          <T color={colors.inkSoft} center style={{ maxWidth: 280 }}>{t("Banks usually take about 30 seconds. Your money is safe either way.")}</T>
          <View style={styles.timer}><T v="h3" color={colors.purple}>{waited < 30 ? `${30 - waited}s` : 'Any moment now…'}</T></View>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
            <Btn title={t("It went through")} icon="✓" onPress={() => record(cur, 'upi')} loading={busy} />
            <Btn title={t("I'll check later")} kind="ghost" onPress={backToPlan} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'failed' && cur ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Mascot size={140} mood="worried" prop="umbrella" />
          <T v="h2" center>{t("That one didn't go through")}</T>
          <T color={colors.inkSoft} center style={{ maxWidth: 290 }}>{t("No money left your account unless your bank says so. This can happen if the UPI app closed, the bank was busy, or no UPI app is installed.")}</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
            <Btn title={t("Try again")} onPress={() => setPhase('pay')} />
            <Btn title={t("Mark as paid in cash")} kind="soft" onPress={() => record(cur, 'cash')} loading={busy} />
            <Btn title={t("Not now")} kind="ghost" onPress={backToPlan} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'success' && cur ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <View>
            <Animated.View style={[{ position: 'absolute', alignSelf: 'center', top: -10, zIndex: 2 }, floatStyle]}><T v="h2" color={colors.mint}>+{rupees(cur.amount_paise)}</T></Animated.View>
            <Animated.View entering={ZoomIn.springify().damping(8)}><Avatar name={cur.to_name} index={4} size={76} ring="paid" /></Animated.View>
          </View>
          <Mascot size={150} mood="cheer" />
          <T v="h1" center>{t("Paid!")}</T>
          <T color={colors.inkSoft} center>{rupees(cur.amount_paise)} to {cur.to_name} is recorded.</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 20 }}>
            <Btn title={t("Done")} onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
            <Btn title={t("Settle another")} kind="ghost" onPress={backToPlan} />
          </View>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flag: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: radius.lg, alignItems: 'center' },
  timer: { backgroundColor: colors.purpleSoft, paddingHorizontal: 18, paddingVertical: 8, borderRadius: radius.pill },
});

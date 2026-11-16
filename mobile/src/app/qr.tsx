/** Scan any UPI QR and pay it through your own UPI app. Also used to pick up a friend's UPI ID. */
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Linking from 'expo-linking';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Confetti, Keypad, ScanBeam, SwipeToPay } from '@/components/fx';
import { Mascot } from '@/components/Mascot';
import { Avatar, Btn, RollingNumber, Screen, T } from '@/components/ui';
import { sfx } from '@/lib/sfx';
import { useStore } from '@/lib/store';
import { Payee, UPI_MAX_PAISE, buildLink, parseUpi } from '@/lib/upi';
import { colors, font, radius, shadow, spring } from '@/lib/theme';
import { evalAmount, haptic, rupees } from '@/lib/util';

type Phase = 'scan' | 'amount' | 'pay' | 'ask' | 'done' | 'failed';

export default function QrPay() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const picking = mode === 'pick';
  const [permission, requestPermission] = useCameraPermissions();
  const [phase, setPhase] = useState<Phase>('scan');
  const [payee, setPayee] = useState<Payee | null>(null);
  const [expr, setExpr] = useState('');
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState(false);
  const [boom, setBoom] = useState(0);
  const locked = useRef(false);
  const left = useRef(false);
  const focus = useSharedValue(0);
  const setPickedUpi = useStore((s) => s.setPickedUpi);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [permission?.status]);

  // Back from the UPI app: ask whether it went through.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && phase === 'pay') left.current = true;
      if (s === 'active' && phase === 'pay' && left.current) setPhase('ask');
    });
    return () => sub.remove();
  }, [phase]);

  const accept = (raw: string) => {
    if (locked.current) return;
    const p = parseUpi(raw);
    if (!p) {
      setBad(true);
      setTimeout(() => setBad(false), 1800);
      return;
    }
    locked.current = true;
    haptic.thunk();
    sfx.coin();
    focus.value = withSpring(1, spring.bouncy); // the viewfinder snaps into focus
    if (picking) {
      setPickedUpi(p.pa);
      setTimeout(() => router.back(), 450);
      return;
    }
    setPayee(p);
    setTimeout(() => setPhase(p.fixedPaise ? 'pay' : 'amount'), 450);
  };

  const paise = payee?.fixedPaise ?? evalAmount(expr) ?? 0;
  const tooMuch = paise > UPI_MAX_PAISE;

  const open = async () => {
    if (!payee) return;
    left.current = false;
    try {
      await Linking.openURL(buildLink(payee, paise));
    } catch {
      setPhase('failed'); // no UPI app on this phone
      return;
    }
    setTimeout(() => setPhase((ph) => (ph === 'pay' && !left.current ? 'ask' : ph)), 6000);
  };

  const rescan = () => {
    locked.current = false;
    focus.value = withTiming(0);
    setPayee(null);
    setExpr('');
    setPhase('scan');
  };
  const frame = useAnimatedStyle(() => ({ transform: [{ scale: 1 - focus.value * 0.08 }], borderColor: focus.value > 0.5 ? colors.mint : colors.pink }));

  return (
    <Screen title={picking ? "Scan a friend's QR" : phase === 'scan' ? 'Scan & pay' : payee ? `Pay ${payee.name}` : ''}>
      <Confetti fire={boom} coins />
      {phase === 'scan' ? (
        <View style={{ flex: 1, gap: 14, paddingBottom: 20 }}>
          <Animated.View style={[styles.finder, frame]}>
            {Platform.OS !== 'web' && permission?.granted ? (
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(r) => accept(r.data)} />
            ) : (
              <View style={{ alignItems: 'center', gap: 8, padding: 24 }}>
                <Text style={{ fontSize: 46 }}>📷</Text>
                <T color={colors.inkSoft} center>{Platform.OS === 'web' ? 'The camera scanner works in the phone app.' : 'Fin needs the camera to scan a QR.'}</T>
                {Platform.OS !== 'web' && permission && !permission.granted ? (
                  <Btn small title="Allow camera" onPress={() => (permission.canAskAgain ? requestPermission() : Linking.openSettings())} />
                ) : null}
              </View>
            )}
            <ScanBeam height={300} active={!locked.current} />
          </Animated.View>
          <View style={{ alignItems: 'center' }}>
            <Mascot size={78} mood={bad ? 'worried' : 'idle'} prop="magnifier" speech={bad ? "That isn't a UPI QR" : picking ? 'Point at their UPI QR' : 'Point at any UPI QR'} />
          </View>
          <View style={{ flex: 1 }} />
          <T v="small" color={colors.inkSoft} center>Or type a UPI ID</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={typed} onChangeText={setTyped} placeholder="name@okhdfcbank" placeholderTextColor={colors.inkFaint} autoCapitalize="none" autoCorrect={false}
              style={styles.input} onSubmitEditing={() => accept(typed)} returnKeyType="go" />
            <Btn small title="Go" kind="soft" onPress={() => accept(typed)} disabled={!typed.trim()} />
          </View>
        </View>
      ) : null}

      {phase === 'amount' && payee ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, justifyContent: 'space-between', paddingBottom: 16 }}>
          <View style={{ alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Animated.View entering={ZoomIn.springify().damping(10)}><Avatar name={payee.name} index={4} size={64} /></Animated.View>
            <T v="h3">{payee.name}</T>
            <T v="small" color={colors.inkSoft}>{payee.pa}</T>
            <Text style={{ fontFamily: font.extra, fontSize: 50, color: expr ? colors.ink : colors.inkFaint, letterSpacing: -1 }} numberOfLines={1} adjustsFontSizeToFit>
              {/[+\-×÷]/.test(expr) ? `${expr.replace(/-/g, '−')} = ${rupees(paise)}` : `₹${expr || '0'}`}
            </Text>
            {tooMuch ? <T v="small" w="bold" color={colors.coral}>UPI allows up to {rupees(UPI_MAX_PAISE)} per payment</T> : null}
          </View>
          <View style={{ gap: 12 }}>
            <Keypad value={expr} onChange={setExpr} />
            <Btn title="Next" onPress={() => setPhase('pay')} disabled={!paise || tooMuch} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'pay' && payee ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', paddingBottom: 30 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Avatar name={payee.name} index={4} size={84} />
            <T v="h2">{payee.name}</T>
            <T v="small" color={colors.inkSoft}>{payee.pa}</T>
            <RollingNumber text={rupees(paise)} size={50} />
            <Animated.View entering={FadeInDown.delay(200)} style={styles.note}>
              <Text style={{ fontSize: 20 }}>🛡️</Text>
              <T v="small" style={{ flex: 1 }}>Check the name in your UPI app before you pay. You never need to scan a QR or enter your PIN to receive money.</T>
            </Animated.View>
          </View>
          <SwipeToPay label="Swipe to pay" onDone={open} />
          <Btn title="Scan a different QR" kind="ghost" onPress={rescan} />
        </Animated.View>
      ) : null}

      {phase === 'ask' && payee ? (
        <Animated.View entering={FadeInDown.springify()} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Mascot size={130} mood="idle" speech="Did it go through?" />
          <T v="h2" center>{rupees(paise)} to {payee.name}</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
            <Btn title="Yes, it's paid" icon="✓" onPress={() => { setPhase('done'); setBoom(Date.now()); haptic.success(); sfx.success(); }} />
            <Btn title="It failed" kind="soft" onPress={() => { haptic.warn(); setPhase('failed'); }} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'failed' && payee ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <Mascot size={140} mood="worried" prop="umbrella" />
          <T v="h2" center>That one didn't go through</T>
          <T color={colors.inkSoft} center style={{ maxWidth: 300 }}>No money left your account unless your bank says so. Some UPI apps refuse payments started from another app. If it keeps failing, open your UPI app and scan the QR there.</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 14 }}>
            <Btn title="Try again" onPress={() => setPhase('pay')} />
            <Btn title="Not now" kind="ghost" onPress={() => router.back()} />
          </View>
        </Animated.View>
      ) : null}

      {phase === 'done' && payee ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Mascot size={150} mood="cheer" />
          <T v="h1" center>Paid!</T>
          <T color={colors.inkSoft} center>{rupees(paise)} to {payee.name}</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 20 }}>
            <Btn title="Split this with a group" icon="🍕" onPress={() => router.replace({ pathname: '/add-expense', params: { draft: JSON.stringify({ amount_paise: paise, description: payee.name, category: 'other', payers: {}, member_ids: [] }) } })} />
            <Btn title="Done" kind="soft" onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))} />
          </View>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  finder: { height: 300, borderRadius: radius.xl, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 3, ...shadow, shadowOpacity: 0.1 },
  input: { flex: 1, height: 46, borderRadius: 23, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 15, color: colors.ink, borderWidth: 1.5, borderColor: colors.line },
  note: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: 12, marginTop: 10, maxWidth: 320 },
});

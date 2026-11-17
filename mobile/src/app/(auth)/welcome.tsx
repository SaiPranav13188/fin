/** Interactive onboarding: three things you actually do (poke the mascot, slice a pizza, swipe to pay). */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, FadeOut, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Mascot, Mood } from '@/components/Mascot';
import { Confetti, PizzaChart, SwipeToPay } from '@/components/fx';
import { Avatar, Btn, Press, T } from '@/components/ui';
import { startDemo } from '@/lib/demo';
import { useStore } from '@/lib/store';
import { colors, spring } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { t } from '@/lib/i18n';

const FRIENDS = ['You', 'Rahul', 'Priya', 'Arjun'];

export default function Welcome() {
  const onboarded = useStore((s) => s.settings.onboarded);
  const setSetting = useStore((s) => s.setSetting);
  const [step, setStep] = useState(onboarded ? 3 : 0);
  const [mood, setMood] = useState<Mood>('sleepy');
  const [slices, setSlices] = useState(1);
  const [paid, setPaid] = useState(0);
  const [demoBusy, setDemoBusy] = useState(false);
  const lookX = useSharedValue(0);
  const lookY = useSharedValue(0);
  const burst = useSharedValue(0);

  // Fin's eyes follow your finger anywhere on the screen.
  const follow = Gesture.Pan()
    .onUpdate((e) => {
      lookX.value = (e.absoluteX - 195) / 150;
      lookY.value = (e.absoluteY - 300) / 220;
    })
    .onEnd(() => {
      lookX.value = withSpring(0, spring.gentle);
      lookY.value = withSpring(0, spring.gentle);
    });

  const next = () => {
    haptic.bump();
    setStep((s) => s + 1);
    setMood('happy');
  };
  const finish = () => {
    setSetting('onboarded', true);
    router.push('/login');
  };

  const tryDemo = async () => {
    setDemoBusy(true);
    try {
      await startDemo();
      haptic.success();
    } catch (e: any) {
      useStore.getState().showToast(e?.message ?? 'Could not start the demo. Please try again.', 'warn');
    } finally {
      setDemoBusy(false);
    }
  };

  const addSlice = () => {
    if (slices >= 4) {
      burst.value = withSequence(withSpring(1, spring.bouncy), withTiming(1, { duration: 500 }), withSpring(0, spring.gentle));
      haptic.success();
      setMood('cheer');
      setTimeout(next, 1100);
      return;
    }
    haptic.tap();
    setSlices(slices + 1);
  };

  return (
    <GestureDetector gesture={follow}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Confetti fire={paid} coins />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 20, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i <= step ? colors.pink : colors.line }} />
            ))}
          </View>
          {step < 3 ? <Press onPress={finish} label={t("Skip")}><T v="small" w="bold" color={colors.inkSoft}>{t("Skip")}</T></Press> : null}
        </View>

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, gap: 22 }}>
          {step === 0 ? (
            <Animated.View key="s0" entering={FadeIn} exiting={FadeOut} style={{ alignItems: 'center', gap: 22 }}>
              <Press onPress={() => { setMood('excited'); setTimeout(next, 700); }} scaleTo={0.9} label="Wake Fin">
                <Mascot size={170} mood={mood} lookX={lookX} lookY={lookY} speech={mood === 'sleepy' ? t("zzz… tap me!") : 'Oh! Hello!'} />
              </Press>
              <T v="h1" center>{t("Meet Fin")}</T>
              <T color={colors.inkSoft} center>{t("Your tiny money buddy. Tap to wake it up. Drag your finger and watch its eyes.")}</T>
            </Animated.View>
          ) : step === 1 ? (
            <Animated.View key="s1" entering={FadeInDown.springify()} exiting={FadeOut} style={{ alignItems: 'center', gap: 16 }}>
              <Press onPress={addSlice} scaleTo={0.96} label="Slice the pizza">
                <PizzaChart values={Array.from({ length: slices }, () => 1)} size={200} burst={burst} />
              </Press>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {FRIENDS.slice(0, slices).map((n, i) => <Animated.View key={n} entering={FadeInDown.springify().damping(10)}><Avatar name={n} index={i} size={40} /></Animated.View>)}
              </View>
              <T v="h1" center>{t("Slice any bill")}</T>
              <T color={colors.inkSoft} center>{slices < 4 ? 'Tap the pizza to add a friend.' : 'Now tap once more to slice it!'}</T>
            </Animated.View>
          ) : step === 2 ? (
            <Animated.View key="s2" entering={FadeInDown.springify()} exiting={FadeOut} style={{ alignItems: 'center', gap: 22, width: '100%' }}>
              <Mascot size={120} mood={paid ? 'cheer' : 'happy'} prop="coin" lookX={lookX} lookY={lookY} />
              <T v="h1" center>{t("Swipe to settle")}</T>
              <T color={colors.inkSoft} center>{t("Fin opens your own UPI app with everything filled in. Fin never holds your money.")}</T>
              <SwipeToPay label={t("Try a swipe")} onDone={() => { setPaid(Date.now()); setTimeout(next, 1300); }} />
            </Animated.View>
          ) : (
            <Animated.View key="s3" entering={FadeInDown.springify()} style={{ alignItems: 'center', gap: 16, width: '100%' }}>
              <Mascot size={160} mood="proud" lookX={lookX} lookY={lookY} speech={t("Let's split something!")} />
              <T v="hero" center>Fin</T>
              <T color={colors.inkSoft} center>{t("Tell Fin what happened. It splits the bill, reminds your friends and helps you settle up.")}</T>
              <View style={{ height: 8 }} />
              <Btn title={t("Get started")} onPress={finish} style={{ alignSelf: 'stretch' }} />
              <Btn title={t("Try the demo, no sign-up")} kind="soft" icon="✨" onPress={tryDemo} loading={demoBusy} style={{ alignSelf: 'stretch' }} />
              <Btn title={t("I already have an account")} kind="ghost" onPress={() => router.push({ pathname: '/login', params: { mode: 'login' } })} />
            </Animated.View>
          )}
        </View>
        {step === 0 ? null : <View style={{ height: 40 }} />}
      </SafeAreaView>
    </GestureDetector>
  );
}

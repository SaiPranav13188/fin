/** "Pay me" QR: any UPI app can scan it, so friends don't need Fin. Animates in like a ticket being printed. */
import React, { useEffect } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Mascot } from '@/components/Mascot';
import { Btn, Sheet, T } from '@/components/ui';
import { colors, radius, shadow, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

type Props = { visible: boolean; onClose: () => void; link: string | null; title: string; amountPaise?: number; sub?: string };

export function RequestQr({ visible, onClose, link, title, amountPaise, sub }: Props) {
  const pop = useSharedValue(0);
  const beam = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    if (!visible) return void (pop.value = 0);
    haptic.bump();
    pop.value = withSpring(1, spring.bouncy);
    beam.value = withDelay(500, withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }));
    glow.value = withDelay(1600, withRepeat(withSequence(withTiming(1, { duration: 1200 }), withTiming(0, { duration: 1200 })), -1));
  }, [visible]);
  const card = useAnimatedStyle(() => ({ opacity: pop.value, transform: [{ scale: 0.6 + pop.value * 0.4 }, { rotate: `${(1 - pop.value) * -8}deg` }, { translateY: (1 - pop.value) * 40 }] }));
  const sweep = useAnimatedStyle(() => ({ opacity: beam.value < 1 ? 1 : 0, transform: [{ translateY: beam.value * 214 }] }));
  const ring = useAnimatedStyle(() => ({ opacity: 0.25 + glow.value * 0.5, transform: [{ scale: 1 + glow.value * 0.03 }] }));
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ alignItems: 'center', gap: 12 }}>
        {link ? (
          <>
            <Animated.View style={[styles.frame, card]}>
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, ring]} />
              <QRCode value={link} size={200} color={colors.ink} backgroundColor="#fff" ecl="M" />
              <Animated.View pointerEvents="none" style={[styles.beam, sweep]} />
            </Animated.View>
            {amountPaise ? <Animated.View entering={FadeInDown.delay(500).springify()}><T v="h1">{rupees(amountPaise)}</T></Animated.View> : null}
            <Animated.View entering={FadeInDown.delay(650)}><T v="small" color={colors.inkSoft} center>{sub ?? t("Ask them to scan this with GPay, PhonePe, Paytm or any UPI app.")}</T></Animated.View>
            <Btn title={t("Share this payment link")} kind="soft" icon="🔗" onPress={() => Share.share({ message: `Pay me${amountPaise ? ` ${rupees(amountPaise)}` : ''} with any UPI app: ${link}` }).catch(() => {})} style={{ alignSelf: 'stretch' }} />
          </>
        ) : (
          <>
            <Mascot size={96} mood="thinking" />
            <T color={colors.inkSoft} center>Add your UPI ID in your profile first, so friends know where to send the money.</T>
          </>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  frame: { width: 240, height: 240, borderRadius: radius.lg, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.2 },
  ring: { borderRadius: radius.lg, borderWidth: 3, borderColor: colors.pink },
  beam: { position: 'absolute', left: 18, right: 18, top: 10, height: 3, borderRadius: 2, backgroundColor: colors.pink },
});

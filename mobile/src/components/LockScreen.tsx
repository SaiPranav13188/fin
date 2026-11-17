/** Biometric app lock. Covers the app until the fingerprint or face check passes. */
import * as LocalAuthentication from 'expo-local-authentication';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { Mascot, Mood } from '@/components/Mascot';
import { Btn, T } from '@/components/ui';
import { useStore } from '@/lib/store';
import { colors, radius } from '@/lib/theme';
import { haptic } from '@/lib/util';

const AWAY_MS = 20_000; // lock again after the app has been in the background this long

export function LockHost() {
  const enabled = useStore((s) => s.settings.lock);
  const signedIn = useStore((s) => !!s.access);
  const [locked, setLocked] = useState(true);
  const [mood, setMood] = useState<Mood>('sleepy');
  const [failed, setFailed] = useState(false);
  const leftAt = useRef(0);
  const pulse = useSharedValue(0);
  const shake = useSharedValue(0);
  const active = enabled && signedIn && Platform.OS !== 'web';

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0, { duration: 1100 })), -1);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') leftAt.current = Date.now();
      else if (leftAt.current && Date.now() - leftAt.current > AWAY_MS) {
        setLocked(true);
        setMood('sleepy');
      }
    });
    return () => sub.remove();
  }, []);

  const unlock = useCallback(async () => {
    setFailed(false);
    setMood('thinking');
    try {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Fin', fallbackLabel: 'Use phone PIN' });
      if (r.success) {
        haptic.success();
        setMood('cheer');
        setTimeout(() => setLocked(false), 450);
      } else {
        haptic.warn();
        setMood('worried');
        setFailed(true);
        shake.value = withSequence(withTiming(-10, { duration: 60 }), withTiming(10, { duration: 60 }), withTiming(-6, { duration: 60 }), withTiming(0, { duration: 60 }));
      }
    } catch {
      setLocked(false); // never trap the user outside their own app if the sensor fails
    }
  }, []);

  useEffect(() => {
    if (active && locked) unlock();
  }, [active, locked]);

  const ring = useAnimatedStyle(() => ({ opacity: 0.2 + pulse.value * 0.5, transform: [{ scale: 1 + pulse.value * 0.18 }] }));
  const body = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  if (!active || !locked) return null;
  return (
    <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(350)} style={[StyleSheet.absoluteFill, { zIndex: 999 }]}>
      <LinearGradient colors={['#FF6FB1', '#9B5CFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <Animated.View style={[{ alignItems: 'center', gap: 18 }, body]}>
          <View style={{ width: 220, height: 220, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={[styles.ring, ring]} />
            <Animated.View entering={ZoomIn.springify().damping(9)}><Mascot size={150} mood={mood} speech={failed ? "That wasn't you? Try again" : mood === 'cheer' ? 'Welcome back!' : undefined} /></Animated.View>
          </View>
          <T v="h1" color="#fff" center>Fin is locked</T>
          <T color="rgba(255,255,255,0.9)" center>Your balances are hidden until you unlock.</T>
          <Btn title="Unlock" kind="soft" icon="🔒" onPress={unlock} />
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  ring: { position: 'absolute', width: 190, height: 190, borderRadius: radius.pill, borderWidth: 4, borderColor: '#fff' },
});

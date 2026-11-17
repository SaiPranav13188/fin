import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Confetti } from '@/components/fx';
import { Mascot } from '@/components/Mascot';
import { LockHost } from '@/components/LockScreen';
import { MomentHost, ToastHost } from '@/components/ui';
import * as Sentry from '@sentry/react-native';

import '@/lib/sentry';
import { queryClient, refreshAll } from '@/lib/hooks';
import { startQueueSync } from '@/lib/offline';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

/** Something shared to Fin from another app (a receipt screenshot, a statement PDF, copied payment text) opens Import. */
function ShareHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  const access = useStore((s) => s.access);
  const router = useRouter();
  useEffect(() => {
    if (!hasShareIntent || !access) return;
    const f = shareIntent.files?.[0];
    if (f) router.push({ pathname: '/import', params: { uri: f.path, name: f.fileName, mime: f.mimeType } });
    else if (shareIntent.text) router.push({ pathname: '/import', params: { text: shareIntent.text.slice(0, 4000) } });
    resetShareIntent();
  }, [hasShareIntent, access]);
  return null;
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  });
  const { ready, access, hydrate } = useStore();
  const lang = useStore((s) => s.settings.lang);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    hydrate();
    // Respect the phone's "remove animations" setting from the first launch.
    AccessibilityInfo.isReduceMotionEnabled().then((on) => on && useStore.getState().setSetting('reduceMotion', true));
  }, []);

  useEffect(() => {
    if (!ready || !fontsLoaded) return;
    SplashScreen.hideAsync().catch(() => {});
    const inAuth = segments[0] === '(auth)';
    if (!access && !inAuth) router.replace('/welcome');
    else if (access && (inAuth || (segments as string[]).length === 0)) router.replace('/home');
  }, [ready, fontsLoaded, access, segments[0]]);

  useEffect(() => {
    if (!access) queryClient.clear();
  }, [access]);

  // Send expenses that were added offline, once we are signed in and back online.
  useEffect(() => (access ? startQueueSync(refreshAll) : undefined), [access]);

  if (!ready || !fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardProvider>
      <SafeAreaProvider>
        <ShareIntentProvider options={{ resetOnBackground: true }}>
        <ShareHandler />
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {/* key: changing the language redraws every screen in the new language */}
          <Stack key={lang} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
            <Stack.Screen name="assistant" options={{ presentation: 'transparentModal', animation: 'fade' }} />
            <Stack.Screen name="settle" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="wrapped" options={{ animation: 'fade_from_bottom', presentation: 'fullScreenModal' }} />
            <Stack.Screen name="add-expense" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
          <ToastHost />
          <LockHost />
          <MomentHost mascot={<Mascot size={120} mood="cheer" />} confetti={(fire) => <Confetti fire={fire} coins />} />
        </QueryClientProvider>
        </ShareIntentProvider>
      </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// Catches errors thrown while drawing a screen too, and shows a safe fallback instead of a blank app.
export default Sentry.wrap(RootLayout);

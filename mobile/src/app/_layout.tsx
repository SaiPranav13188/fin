import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastHost } from '@/components/ui';
import { queryClient } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
  });
  const { ready, access, hydrate } = useStore();
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

  if (!ready || !fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
            <Stack.Screen name="assistant" options={{ presentation: 'transparentModal', animation: 'fade' }} />
            <Stack.Screen name="settle" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="add-expense" options={{ animation: 'slide_from_bottom' }} />
          </Stack>
          <ToastHost />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

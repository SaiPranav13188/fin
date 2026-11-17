import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { Mascot, Mood } from '@/components/Mascot';
import { Btn, Field, Press, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { t } from '@/lib/i18n';

export default function Login() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<'signup' | 'login'>(params.mode === 'login' ? 'login' : 'signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [upi, setUpi] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<'none' | 'text' | 'password'>('none');
  const setTokens = useStore((s) => s.setTokens);

  // Fin covers its eyes while you type your password.
  const mood: Mood = error ? 'worried' : focus === 'password' ? 'covering' : focus === 'text' ? 'happy' : 'idle';
  const speech = error ?? (focus === 'password' ? t("Not peeking, promise 🙈") : mode === 'signup' ? t("Nice to meet you!") : t("Welcome back!"));

  const submit = async () => {
    setError(null);
    if (mode === 'signup' && !name.trim()) return setError('What should I call you?');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('That email looks off.');
    if (password.length < 8) return setError('Password needs 8 or more characters.');
    setBusy(true);
    try {
      const body = mode === 'signup'
        ? { name: name.trim(), email: email.trim(), password, upi_id: upi.trim() || null }
        : { email: email.trim(), password };
      const t = await api(`/auth/${mode}`, { body, auth: false });
      haptic.success();
      await setTokens(t.access_token, t.refresh_token);
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40, gap: 14 }}>
          <View style={{ alignItems: 'center', height: 190, justifyContent: 'flex-end' }}>
            <Mascot size={112} mood={mood} speech={speech} />
          </View>
          <T v="h1" center>{mode === 'signup' ? t("Create your account") : t("Log in")}</T>
          <Animated.View layout={LinearTransition.springify().damping(16)} style={{ gap: 12, marginTop: 8 }}>
            {mode === 'signup' ? (
              <Animated.View entering={FadeInDown}>
                <Field label={t("Your name")} value={name} onChangeText={setName} placeholder="Sai" autoCapitalize="words" onFocus={() => setFocus('text')} onBlur={() => setFocus('none')} />
              </Animated.View>
            ) : null}
            <Field label={t("Email")} value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" onFocus={() => setFocus('text')} onBlur={() => setFocus('none')} />
            <Field label={t("Password")} value={password} onChangeText={setPassword} placeholder={t("8+ characters")} secureTextEntry autoComplete="password" onFocus={() => setFocus('password')} onBlur={() => setFocus('none')} />
            {mode === 'signup' ? (
              <Animated.View entering={FadeInDown}>
                <Field label={t("UPI ID (optional, so friends can pay you)")} value={upi} onChangeText={setUpi} placeholder="name@okhdfcbank" autoCapitalize="none" onFocus={() => setFocus('text')} onBlur={() => setFocus('none')} />
              </Animated.View>
            ) : null}
          </Animated.View>
          <Btn title={mode === 'signup' ? t("Create account") : t("Log in")} onPress={submit} loading={busy} style={{ marginTop: 10 }} />
          {mode === 'login' ? (
            <Press onPress={() => router.push({ pathname: '/forgot', params: { email } })} style={{ alignSelf: 'center', padding: 6 }}>
              <T v="small" w="bold" color={colors.inkSoft}>{t("Forgot password?")}</T>
            </Press>
          ) : null}
          <Press onPress={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError(null); }} style={{ alignSelf: 'center', padding: 10 }}>
            <T v="small" w="bold" color={colors.purple}>{mode === 'signup' ? t("I already have an account") : t("New here? Create an account")}</T>
          </Press>
          <T v="small" color={colors.inkFaint} center>{t("Fin never holds your money or asks for your UPI PIN.")}</T>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

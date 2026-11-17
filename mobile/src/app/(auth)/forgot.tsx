/** Forgot password: email a 6-digit code, then set a new password with it. */
import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Mascot } from '@/components/Mascot';
import { Btn, Field, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { t } from '@/lib/i18n';

export default function Forgot() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const setTokens = useStore((s) => s.setTokens);

  const send = async () => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('That email looks off.');
    setBusy(true);
    try {
      const r = await api('/auth/forgot', { body: { email: email.trim() }, auth: false });
      setNote(r.message);
      setStep('code');
      haptic.success();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) return setError('The code has 6 digits.');
    if (password.length < 8) return setError('Password needs 8 or more characters.');
    setBusy(true);
    try {
      const t = await api('/auth/reset', { body: { email: email.trim(), code: code.trim(), password }, auth: false });
      haptic.success();
      await setTokens(t.access_token, t.refresh_token); // signed in; the layout moves to Home
    } catch (e) {
      haptic.error();
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="">
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
          <View style={{ alignItems: 'center', height: 180, justifyContent: 'flex-end' }}>
            <Mascot size={104} mood={error ? 'worried' : step === 'code' ? 'happy' : 'thinking'} prop={step === 'code' ? 'letter' : 'none'}
              speech={error ?? (step === 'code' ? 'Check your inbox ✉️' : 'No worries, it happens!')} />
          </View>
          <T v="h1" center>{step === 'email' ? t("Forgot password?") : 'Enter your code'}</T>
          {step === 'email' ? (
            <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
              <T color={colors.inkSoft} center>{t("We'll email you a 6-digit code.")}</T>
              <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
              <Btn title={t("Send code")} onPress={send} loading={busy} />
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown} style={{ gap: 12 }}>
              <T color={colors.inkSoft} center>{note} It can take a minute. Check spam too.</T>
              <Field label="6-digit code" value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder="123456" keyboardType="number-pad" autoComplete="one-time-code" />
              <Field label="New password" value={password} onChangeText={setPassword} placeholder="8+ characters" secureTextEntry autoComplete="new-password" />
              <Btn title={t("Set new password")} onPress={reset} loading={busy} />
              <Btn title={t("Send a new code")} kind="ghost" onPress={send} />
            </Animated.View>
          )}
      </KeyboardAwareScrollView>
    </Screen>
  );
}

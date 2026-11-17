import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { Alert, Platform, ScrollView, Switch, View } from 'react-native';

import { RequestQr } from '@/components/RequestQr';

import { Mascot } from '@/components/Mascot';
import { Btn, Card, Chip, Field, Screen, T } from '@/components/ui';
import { API_URL, ApiError, api } from '@/lib/api';
import { queryClient, useMe } from '@/lib/hooks';
import { Settings, useStore } from '@/lib/store';
import { colors } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { t } from '@/lib/i18n';



export default function Profile() {
  const me = useMe();
  const { settings, setSetting, setTokens, refresh, showToast } = useStore();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState(false);
  useEffect(() => {
    if (me.data) { setName(me.data.name); setUpi(me.data.upi_id ?? ''); }
  }, [me.data]);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: patch });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      haptic.success();
      showToast('Saved', 'ok');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const toggleLock = async (on: boolean) => {
    if (!on) return setSetting('lock', false);
    try {
      if (Platform.OS === 'web' || !(await LocalAuthentication.hasHardwareAsync()) || !(await LocalAuthentication.isEnrolledAsync())) {
        return showToast('Set up a fingerprint, face or screen lock in your phone settings first', 'warn');
      }
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm it is you' });
      if (r.success) { setSetting('lock', true); haptic.success(); }
    } catch {
      showToast("Couldn't turn the lock on", 'warn');
    }
  };
  const myLink = me.data?.upi_id ? `upi://pay?pa=${me.data.upi_id}&pn=${encodeURIComponent(me.data.name)}&cu=INR` : null;
  const logout = async () => {
    if (refresh) api('/auth/logout', { body: { refresh_token: refresh }, auth: false }).catch(() => {});
    await setTokens(null, null);
  };
  const remove = () =>
    Alert.alert('Delete your account?', 'Your profile and login are deleted for good. Shared group history stays for your friends, without your name.', [
      { text: 'Keep my account', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await api('/auth/me', { method: 'DELETE' }); await setTokens(null, null); } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not delete', 'warn'); }
      } },
    ]);

  const toggle = (key: 'haptics' | 'reduceMotion' | 'sound' | 'lock', label: string, sub: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}><T w="bold">{label}</T><T v="small" color={colors.inkSoft}>{sub}</T></View>
      <Switch value={settings[key]} onValueChange={(v) => { if (key === 'lock') return toggleLock(v); setSetting(key, v); haptic.tick(); }} trackColor={{ true: colors.pink, false: colors.line }} thumbColor="#fff" />
    </View>
  );

  return (
    <Screen title={t("You")}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 50 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}><Mascot size={110} mood="happy" /></View>
        <Card style={{ gap: 12 }}>
          <Field label={t("Name")} value={name} onChangeText={setName} maxLength={80} />
          <Field label={t("Your UPI ID (friends pay you here)")} value={upi} onChangeText={setUpi} autoCapitalize="none" placeholder="name@okhdfcbank" />
          <T v="small" color={colors.inkSoft}>{me.data?.email}</T>
          <Btn title={t("Save")} kind="soft" loading={busy} onPress={() => save({ name: name.trim(), upi_id: upi.trim() || null })} />
        </Card>
        <Card index={1} style={{ gap: 12 }}>
          <T v="tiny" color={colors.inkFaint}>{t("App language")}</T>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['en', 'English'], ['hi', 'हिंदी'], ['te', 'తెలుగు']] as const).map(([k, l]) => (
              <Chip key={k} label={l} active={settings.lang === k} onPress={() => { setSetting('lang', k); save({ language: k }); }} />
            ))}
          </View>
        </Card>
        <Card index={2} style={{ gap: 16 }}>
          {toggle('haptics', t('Haptics'), t("Little taps as you swipe and pay"))}
          {toggle('lock', 'App lock', 'Ask for your fingerprint or face when Fin opens')}
          {toggle('sound', 'Sounds', 'A coin clink and a soft chime. Follows silent mode')}
          {toggle('reduceMotion', t("Reduce motion"), t("Swap big animations for simple fades"))}
        </Card>
        <Btn title="My payment QR" kind="soft" icon="📱" onPress={() => setQr(true)} />
        <RequestQr visible={qr} onClose={() => setQr(false)} link={myLink} title="Pay me" sub="Anyone can scan this with GPay, PhonePe, Paytm or any UPI app and type the amount." />
        <Card index={3} style={{ gap: 12 }}>
          <T v="tiny" color={colors.inkFaint}>Fin's outfit</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {([['none', 'None', null], ['cap', '🧢 Cap', 'first-split'], ['party', '🥳 Party hat', 'settled'], ['scarf', '🧣 Scarf', 'bills-3']] as const).map(([k, l, need]) => {
              const open = !need || settings.earned.some((e) => e.startsWith(need));
              return <Chip key={k} label={open ? l : `🔒 ${l}`} active={settings.outfit === k} onPress={() => (open ? setSetting('outfit', k) : showToast(need === 'first-split' ? 'Add your first expense to unlock this' : need === 'settled' ? 'Settle a whole group to unlock this' : 'Mark 3 bills as paid to unlock this', 'info'))} />;
            })}
          </View>
        </Card>
        <Btn title={t("Privacy policy")} kind="ghost" onPress={() => Linking.openURL(`${API_URL}/privacy`)} />
        <Btn title={t("Log out")} kind="soft" onPress={logout} />
        <Btn title={t("Delete my account")} kind="danger" onPress={remove} />
        <T v="small" color={colors.inkFaint} center>{t("Fin splits and tracks bills and opens your own UPI app. It does not hold money, offer loans or process payments.")}</T>
      </ScrollView>
    </Screen>
  );
}

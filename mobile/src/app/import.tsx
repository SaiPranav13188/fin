/** Import payments: a statement (CSV, PDF or screenshot) from GPay, PhonePe, Paytm or a bank -> a list to review -> added to your spending. */
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn } from 'react-native-reanimated';

import { Confetti } from '@/components/fx';
import { Mascot, Mood } from '@/components/Mascot';
import { Btn, Chip, Press, RollingNumber, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { refreshAll } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { CATEGORY, colors, radius, shadow } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

type Pay = { date: string; merchant: string; amount_paise: number; category: string; ref: string | null; duplicate: boolean };
type Result = { error?: string; payments?: Pay[]; credits_skipped?: number; truncated?: boolean; source?: 'rules' | 'ai'; app?: string | null };
type Step = 'consent' | 'pick' | 'reading' | 'review' | 'done';

const CATS = Object.keys(CATEGORY);
const READING = ['Opening your file…', 'Finding the payments…', 'Skipping money you received…', 'Checking every line…'];

export default function ImportScreen() {
  const params = useLocalSearchParams<{ uri?: string; name?: string; mime?: string; text?: string }>();
  const consented = useStore((s) => s.settings.statementConsent);
  const setSetting = useStore((s) => s.setSetting);
  const showToast = useStore((s) => s.showToast);
  const [step, setStep] = useState<Step>(consented ? 'pick' : 'consent');
  const [line, setLine] = useState(0);
  const [res, setRes] = useState<Result | null>(null);
  const [rows, setRows] = useState<(Pay & { on: boolean })[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; skipped: number } | null>(null);
  const [boom, setBoom] = useState(0);
  const started = useRef(false);

  // Something shared to Fin from another app starts the import straight away.
  useEffect(() => {
    if (started.current || !consented || (!params.uri && !params.text)) return;
    started.current = true;
    if (params.uri) send({ uri: params.uri.startsWith('file') || params.uri.startsWith('content') ? params.uri : `file://${params.uri}`, name: params.name ?? 'shared', type: params.mime ?? 'application/octet-stream' });
    else if (params.text) send({ text: params.text });
  }, [consented, params.uri, params.text]);

  useEffect(() => {
    if (step !== 'reading') return;
    const i = setInterval(() => setLine((l) => (l + 1) % READING.length), 1500);
    return () => clearInterval(i);
  }, [step]);

  const send = async (f: { uri?: string; name?: string; type?: string; text?: string }) => {
    setStep('reading');
    setRes(null);
    try {
      const form = new FormData();
      if (f.text) form.append('file', new Blob([f.text], { type: 'text/plain' }) as any, 'shared.txt');
      else form.append('file', { uri: f.uri, name: f.name ?? 'statement', type: f.type ?? 'application/octet-stream' } as any);
      const r: Result = await api('/agent/statement', { form });
      setRes(r);
      if (r.payments?.length) {
        setRows(r.payments.map((p) => ({ ...p, on: !p.duplicate })));
        haptic.success();
        setStep('review');
      } else {
        haptic.warn();
        setStep('pick');
      }
    } catch (e) {
      haptic.error();
      setRes({ error: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.' });
      setStep('pick');
    }
  };

  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['text/csv', 'text/comma-separated-values', 'application/pdf', 'image/*', 'text/plain', 'application/csv'], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    send({ uri: a.uri, name: a.name, type: a.mimeType ?? 'application/octet-stream' });
  };
  const pickPhoto = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (r.canceled || !r.assets[0]) return;
    const a = r.assets[0];
    send({ uri: a.uri, name: a.fileName ?? 'screenshot.jpg', type: a.mimeType ?? 'image/jpeg' });
  };

  const chosen = rows.filter((r) => r.on);
  const total = useMemo(() => chosen.reduce((a, r) => a + r.amount_paise, 0), [rows]);
  const toggle = (i: number) => { haptic.tick(); setRows((rs) => rs.map((r, k) => (k === i ? { ...r, on: !r.on } : r))); };
  const cycle = (i: number) => { haptic.tick(); setRows((rs) => rs.map((r, k) => (k === i ? { ...r, category: CATS[(CATS.indexOf(r.category) + 1) % CATS.length] } : r))); };

  const save = async () => {
    setBusy(true);
    try {
      const out = await api('/me/spend/bulk', { body: { items: chosen.map((r) => ({ date: r.date, merchant: r.merchant, amount_paise: r.amount_paise, category: r.category, ref: r.ref })) } });
      setDone({ added: out.added, skipped: out.skipped_duplicates });
      setBoom(Date.now());
      haptic.success();
      await refreshAll();
      setStep('done');
    } catch (e) {
      haptic.error();
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const mood: Mood = step === 'reading' ? 'thinking' : step === 'done' ? 'cheer' : res?.error ? 'worried' : 'idle';

  return (
    <Screen title="Import payments">
      <Confetti fire={boom} coins />

      {step === 'consent' ? (
        <Animated.View entering={FadeInDown.springify()} style={{ flex: 1, gap: 14, paddingBottom: 20 }}>
          <View style={{ alignItems: 'center' }}><Mascot size={110} mood="idle" prop="glasses" speech="Let's bring your payments in" /></View>
          <T v="h2">Before you import</T>
          <View style={styles.card}>
            <T w="semi">📄 CSV files are read on Fin's server by simple rules. No AI sees them.</T>
            <T w="semi">🤖 PDFs and screenshots are read by Google's Gemini AI. Fin's free AI plan means Google may use them to improve its products, so don't upload anything you'd mind sharing.</T>
            <T w="semi">🗑️ Fin never keeps your file. It keeps only the payments you choose to add.</T>
            <T w="semi">✋ Nothing is added until you review the list and tap Add.</T>
          </View>
          <View style={{ flex: 1 }} />
          <Btn title="I understand, continue" onPress={() => { setSetting('statementConsent', true); setStep('pick'); }} />
          <Btn title="Not now" kind="ghost" onPress={() => router.back()} />
        </Animated.View>
      ) : null}

      {step === 'pick' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 30 }}>
          <View style={{ alignItems: 'center' }}>
            <Mascot size={104} mood={mood} speech={res?.error ? 'Hmm, that one did not work' : res && !res.payments?.length ? 'I found no payments in that' : 'Bring your payments into Fin'} />
          </View>
          {res?.error ? <Animated.View entering={FadeIn} style={[styles.card, { backgroundColor: colors.coralSoft }]}><T w="semi">{res.error}</T></Animated.View> : null}
          <T color={colors.inkSoft}>Add what you paid in GPay, PhonePe, Paytm or your bank, so everything you spend shows up here.</T>
          <Btn title="Choose a statement file" icon="📄" onPress={pickFile} />
          <Btn title="Choose a screenshot" icon="🖼️" kind="soft" onPress={pickPhoto} />
          <View style={styles.card}>
            <T v="tiny" color={colors.inkFaint}>How to get a statement</T>
            <T w="semi">PhonePe: Profile → Statements → download</T>
            <T w="semi">Paytm: Balance & History → Passbook → download</T>
            <T w="semi">Google Pay and others: download your bank's statement as CSV or PDF</T>
            <T v="small" color={colors.inkSoft}>Menu names can differ a little. You can also share a payment receipt to Fin from any UPI app, using Android's Share button.</T>
          </View>
        </ScrollView>
      ) : null}

      {step === 'reading' ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <Mascot size={150} mood="thinking" prop="glasses" />
          <Animated.View key={line} entering={FadeInDown} exiting={FadeOut}><T v="h3" color={colors.inkSoft} center>{READING[line]}</T></Animated.View>
          <T v="small" color={colors.inkFaint} center>Long statements can take up to a minute.</T>
        </Animated.View>
      ) : null}

      {step === 'review' ? (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Mascot size={54} mood="happy" />
            <View style={{ flex: 1 }}>
              <T v="h3">{rows.length} payment{rows.length === 1 ? '' : 's'} found{res?.app ? ` in ${res.app}` : ''}</T>
              <T v="small" color={colors.inkSoft}>
                {res?.credits_skipped ? `${res.credits_skipped} received payment${res.credits_skipped === 1 ? '' : 's'} skipped. ` : ''}
                Untick anything that isn't yours. Tap an emoji to change its category.
              </T>
            </View>
          </View>
          {res?.truncated ? <T v="small" color={colors.coral} w="semi" style={{ marginBottom: 6 }}>Only the first 200 are shown. Import the rest as a second file.</T> : null}
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <Chip label="Select all" onPress={() => setRows((rs) => rs.map((r) => ({ ...r, on: true })))} />
            <Chip label="Clear" onPress={() => setRows((rs) => rs.map((r) => ({ ...r, on: false })))} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
            {rows.map((r, i) => (
              <Animated.View key={`${r.date}${r.merchant}${r.amount_paise}${i}`} entering={FadeInDown.delay(Math.min(i, 10) * 35).springify().damping(15)} layout={LinearTransition.springify()}
                style={[styles.row, !r.on && { opacity: 0.45 }]}>
                <Press onPress={() => cycle(i)} label="Change category"><Text style={{ fontSize: 26 }}>{(CATEGORY[r.category] ?? CATEGORY.other).emoji}</Text></Press>
                <Press onPress={() => toggle(i)} style={{ flex: 1 }} label={r.merchant}>
                  <T w="bold" numberOfLines={1}>{r.merchant}</T>
                  <T v="small" color={r.duplicate ? colors.amber : colors.inkSoft}>{new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}{r.duplicate ? ' · already added' : ''}</T>
                </Press>
                <T w="bold">{rupees(r.amount_paise)}</T>
                <Press onPress={() => toggle(i)} label={r.on ? 'Untick' : 'Tick'}>
                  <View style={[styles.box, r.on && { backgroundColor: colors.purple, borderColor: colors.purple }]}>{r.on ? <Text style={{ color: '#fff', fontSize: 13 }}>✓</Text> : null}</View>
                </Press>
              </Animated.View>
            ))}
          </ScrollView>
          <View style={styles.bar}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <T v="small" color={colors.inkSoft}>{chosen.length} selected</T>
              <RollingNumber text={rupees(total)} size={24} />
            </View>
            <Btn title={chosen.length ? `Add ${chosen.length} payment${chosen.length === 1 ? '' : 's'}` : 'Select payments to add'} onPress={save} loading={busy} disabled={!chosen.length} />
          </View>
        </View>
      ) : null}

      {step === 'done' && done ? (
        <Animated.View entering={FadeIn} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <Animated.View entering={ZoomIn.springify().damping(8)}><Mascot size={150} mood="cheer" /></Animated.View>
          <T v="h1" center>{done.added} payment{done.added === 1 ? '' : 's'} added</T>
          <T color={colors.inkSoft} center>{done.skipped ? `${done.skipped} were already in Fin, so I skipped them. ` : ''}They now count in what you spent this month.</T>
          <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 18 }}>
            <Btn title="See my spending" onPress={() => router.replace('/home')} />
            <Btn title="Import another file" kind="soft" onPress={() => { setRes(null); setRows([]); setStep('pick'); }} />
          </View>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, gap: 8, ...shadow, shadowOpacity: 0.08 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: radius.md, padding: 12 },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  bar: { paddingTop: 10, borderTopWidth: 1.5, borderTopColor: colors.line, backgroundColor: colors.bg, paddingBottom: 14 },
});

/** Bills & subscriptions: responsibilities (rent, EMI, loans) and subscriptions, with a live reminder preview. */
import { useQuery } from '@tanstack/react-query';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';

import { Chillar } from '@/components/Chillar';
import { Btn, Card, Chip, Empty, Field, Press, Screen, Sheet, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { queryClient } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { colors, radius } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

type Row = { id: string; label: string; amount_paise: number | null; due_date?: string; renews_on?: string; frequency: string; payee?: string | null };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const QUICK = [
  { label: 'Tomorrow', date: () => addDays(1) },
  { label: 'This weekend', date: () => addDays(((6 - new Date().getDay() + 7) % 7) || 7) },
  { label: 'In a week', date: () => addDays(7) },
  { label: '1st of next month', date: () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1); } },
];
const nice = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
const daysTo = (s: string) => Math.round((new Date(s + 'T00:00:00').getTime() - new Date(iso(new Date()) + 'T00:00:00').getTime()) / 86400000);

export default function Reminders() {
  const resp = useQuery({ queryKey: ['responsibilities'], queryFn: () => api<Row[]>('/responsibilities') });
  const subs = useQuery({ queryKey: ['subscriptions'], queryFn: () => api<Row[]>('/subscriptions') });
  const [sheet, setSheet] = useState<null | 'bill' | 'sub'>(null);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(iso(addDays(1)));
  const [busy, setBusy] = useState(false);
  const showToast = useStore((s) => s.showToast);

  const reload = () => ['responsibilities', 'subscriptions', 'reminders', 'summary'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
  const open = (kind: 'bill' | 'sub') => { setLabel(''); setAmount(''); setDate(iso(addDays(1))); setSheet(kind); };

  const save = async () => {
    const paise = Math.round(parseFloat(amount || '0') * 100);
    if (!label.trim()) return showToast('Give it a name', 'warn');
    if (sheet === 'sub' && !paise) return showToast('Enter the amount', 'warn');
    setBusy(true);
    try {
      if (sheet === 'bill') await api('/responsibilities', { body: { label: label.trim(), amount_paise: paise || null, due_date: date, frequency: 'monthly' } });
      else await api('/subscriptions', { body: { label: label.trim(), amount_paise: paise, renews_on: date, frequency: 'monthly' } });
      haptic.success();
      setSheet(null);
      reload();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const act = async (path: string, method: 'POST' | 'DELETE') => {
    haptic.bump();
    try { await api(path, { method }); reload(); } catch (e) { showToast(e instanceof ApiError ? e.message : 'Try again', 'warn'); }
  };

  const section = (title: string, rows: Row[] | undefined, base: string, emoji: string) => (
    <Animated.View layout={LinearTransition.springify()} style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="h3">{title}</T>
        <Press onPress={() => open(base === '/subscriptions' ? 'sub' : 'bill')}><T v="small" w="bold" color={colors.purple}>＋ Add</T></Press>
      </View>
      {(rows ?? []).map((r, i) => {
        const when = (r.due_date ?? r.renews_on)!;
        const n = daysTo(when);
        return (
          <Animated.View key={r.id} exiting={FadeOut} layout={LinearTransition.springify()}>
            <Card index={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
              <Text style={{ fontSize: 26 }}>{emoji}</Text>
              <View style={{ flex: 1 }}>
                <T w="bold">{r.label}</T>
                <T v="small" color={n <= 2 ? colors.coral : colors.inkSoft}>{n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : nice(when)} · monthly</T>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                {r.amount_paise ? <T v="h3">{rupees(r.amount_paise)}</T> : null}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Press onPress={() => act(`${base}/${r.id}/paid`, 'POST')}><T v="small" w="bold" color={colors.mint}>Paid ✓</T></Press>
                  <Press onPress={() => act(`${base}/${r.id}`, 'DELETE')}><T v="small" w="bold" color={colors.inkFaint}>Remove</T></Press>
                </View>
              </View>
            </Card>
          </Animated.View>
        );
      })}
    </Animated.View>
  );

  const empty = resp.data?.length === 0 && subs.data?.length === 0;
  const monthly = (subs.data ?? []).reduce((a, s) => a + (s.amount_paise ?? 0), 0);
  const preview = label.trim() ? `${label.trim()}${amount ? ` ₹${amount}` : ''} ${sheet === 'sub' ? 'renews' : 'is due'} ${daysTo(date) === 1 ? 'tomorrow' : `on ${nice(date)}`}. I'll remind you!` : "Tell me what to remember and I'll nudge you in time.";

  return (
    <Screen title="Bills & subscriptions">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 40 }}>
        {empty ? (
          <Empty title="Nothing to remember yet" sub="Add rent, an EMI, or Netflix and Chillar will remind you before it's due."><Chillar size={120} mood="idle" /></Empty>
        ) : null}
        {monthly ? <View style={{ backgroundColor: colors.purpleSoft, borderRadius: radius.lg, padding: 16 }}><T v="tiny" color={colors.inkSoft}>Subscriptions cost you</T><T v="h1">{rupees(monthly)} <T color={colors.inkSoft}>/ month</T></T></View> : null}
        {section('Bills & responsibilities', resp.data, '/responsibilities', '🏠')}
        {section('Subscriptions', subs.data, '/subscriptions', '🔁')}
      </ScrollView>
      <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={sheet === 'sub' ? 'New subscription' : 'New bill'}>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, minHeight: 84 }}>
            <Chillar size={56} mood={label ? 'happy' : 'idle'} />
            <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 18, borderBottomLeftRadius: 6, padding: 12 }}><T v="small" w="semi">{preview}</T></View>
          </View>
          <Field value={label} onChangeText={setLabel} placeholder={sheet === 'sub' ? 'Netflix, Spotify, gym…' : 'Rent, EMI, loan to Rahul…'} maxLength={60} />
          <Field value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} placeholder={sheet === 'sub' ? 'Amount (₹)' : 'Amount (₹, optional)'} keyboardType="decimal-pad" maxLength={9} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {QUICK.map((q) => <Chip key={q.label} label={q.label} active={iso(q.date()) === date} onPress={() => { haptic.tick(); setDate(iso(q.date())); }} />)}
          </ScrollView>
          {/* mini calendar: the next 14 days */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {Array.from({ length: 14 }, (_, i) => addDays(i)).map((d) => {
              const on = iso(d) === date;
              return (
                <Press key={iso(d)} onPress={() => { haptic.tick(); setDate(iso(d)); }} style={{ width: 46, paddingVertical: 8, borderRadius: 14, alignItems: 'center', backgroundColor: on ? colors.purple : '#fff' }}>
                  <T v="tiny" color={on ? '#fff' : colors.inkFaint}>{d.toLocaleDateString('en-IN', { weekday: 'short' }).slice(0, 2)}</T>
                  <T v="h3" color={on ? '#fff' : colors.ink}>{d.getDate()}</T>
                </Press>
              );
            })}
          </ScrollView>
          <Btn title="Remind me" onPress={save} loading={busy} />
        </View>
      </Sheet>
    </Screen>
  );
}

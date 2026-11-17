/** Add an expense: calculator keypad -> split sheet with a live pizza chart -> "Sliced!". Also used to edit an AI draft. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, {
  FadeIn, FadeInDown, FadeOut, LinearTransition, ZoomIn, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';

import { Mascot, Mood } from '@/components/Mascot';
import { Confetti, Keypad, PizzaChart } from '@/components/fx';
import { Avatar, Btn, Chip, Dots, Press, RollingNumber, Screen, T } from '@/components/ui';
import { ApiError, Draft, api } from '@/lib/api';
import { refreshAll, useExpenses, useGroup, useGroups } from '@/lib/hooks';
import { enqueueExpense } from '@/lib/offline';
import { sfx } from '@/lib/sfx';
import { useStore } from '@/lib/store';
import { CATEGORY, colorFor, colors, font, radius, shadow, spring } from '@/lib/theme';
import { allocate, evalAmount, haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

type SplitType = 'equal' | 'exact' | 'shares' | 'percent';
const TYPES: { key: SplitType; label: string }[] = [
  { key: 'equal', label: 'Equally' }, { key: 'exact', label: 'By amount' }, { key: 'shares', label: 'By shares' }, { key: 'percent', label: 'By %' },
];
const CURRENCY_LIST = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB', 'MYR', 'JPY', 'AUD', 'CAD', 'LKR', 'NPR', 'IDR', 'VND', 'CHF'];
const NO_DECIMALS = ['JPY', 'IDR', 'VND'];
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', THB: '฿', MYR: 'RM', JPY: '¥', AUD: 'A$', CAD: 'C$', LKR: 'Rs ', NPR: 'Rs ', IDR: 'Rp ', VND: '₫', CHF: 'CHF ' };
const FLAG: Record<string, string> = { INR: '🇮🇳', USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', AED: '🇦🇪', SGD: '🇸🇬', THB: '🇹🇭', MYR: '🇲🇾', JPY: '🇯🇵', AUD: '🇦🇺', CAD: '🇨🇦', LKR: '🇱🇰', NPR: '🇳🇵', IDR: '🇮🇩', VND: '🇻🇳', CHF: '🇨🇭' };
const KEYWORDS: Record<string, string> = { pizza: 'food', dinner: 'food', lunch: 'food', chai: 'food', swiggy: 'food', zomato: 'food', cab: 'travel', uber: 'travel', ola: 'travel', petrol: 'travel', rent: 'rent', wifi: 'bills', electricity: 'bills', grocer: 'groceries', blinkit: 'groceries', movie: 'fun', netflix: 'fun', amazon: 'shopping', medicine: 'health' };

export default function AddExpense() {
  const params = useLocalSearchParams<{ group?: string; draft?: string }>();
  const draft: Draft | null = useMemo(() => {
    try { return params.draft ? JSON.parse(params.draft) : null; } catch { return null; }
  }, [params.draft]);
  const groups = useGroups();
  const [groupId, setGroupId] = useState<string | undefined>(draft?.group_id ?? params.group);
  useEffect(() => {
    if (!groupId && groups.data?.[0]) setGroupId(groups.data[0].id);
  }, [groups.data]);
  const group = useGroup(groupId);
  const history = useExpenses(groupId);
  const members = (group.data?.members ?? []).filter((m) => m.active);
  const me = members.find((m) => m.is_self);
  const showToast = useStore((s) => s.showToast);

  const [step, setStep] = useState<'amount' | 'split'>(draft?.amount_paise ? 'split' : 'amount');
  const [expr, setExpr] = useState(draft?.amount_paise ? String(draft.amount_paise / 100) : '');
  const [desc, setDesc] = useState(draft?.description ?? '');
  const [noteOpen, setNoteOpen] = useState(!!draft?.description);
  const [category, setCategory] = useState(draft?.category ?? 'other');
  const [payer, setPayer] = useState<string | undefined>(draft ? Object.keys(draft.payers)[0] : undefined);
  const [picked, setPicked] = useState<string[] | null>(draft?.member_ids?.length ? draft.member_ids : null);
  // An AI draft can carry an uneven split ("Priya owes only 600"); keep it when the user taps Edit.
  const d: any = draft;
  const draftVals: Record<string, number> | null = d?.split_type === 'exact' ? Object.fromEntries(Object.entries(d.exact ?? {}).map(([k, v]) => [k, (v as number) / 100]))
    : d?.split_type === 'shares' ? d.weights : d?.split_type === 'percent' ? d.percents : null;
  const [type, setType] = useState<SplitType>(draftVals ? d.split_type : 'equal');
  const [vals, setVals] = useState<Record<string, string>>(draftVals ? Object.fromEntries(Object.entries(draftVals).map(([k, v]) => [k, String(v)])) : {});
  const [busy, setBusy] = useState(false);
  const [sliced, setSliced] = useState(0);
  const burst = useSharedValue(0);
  const shake = useSharedValue(0);

  // Paid abroad? The amount is typed in that currency and converted to rupees at today's rate.
  const [currency, setCurrency] = useState<string>((draft as any)?.currency ?? 'INR');
  const [fx, setFx] = useState<{ rate: number; date: string } | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);
  const [curPicker, setCurPicker] = useState(false);
  useEffect(() => {
    setFx(null);
    setFxError(null);
    if (currency === 'INR') return;
    api(`/fx/${currency}`).then((r) => setFx({ rate: r.rate, date: r.date })).catch((e) => setFxError(e instanceof ApiError ? e.message : 'No rate right now'));
  }, [currency]);
  const foreign = currency !== 'INR';
  const typed = evalAmount(expr) ?? 0; // in the chosen currency, x100
  const originalMinor = NO_DECIMALS.includes(currency) ? Math.round(typed / 100) : typed;
  const total = !foreign ? typed : fx ? Math.round((typed / 100) * fx.rate * 100) : 0;
  const hasOp = /[+\-×÷]/.test(expr);
  const selected = picked ?? members.map((m) => m.id);
  const payerId = payer ?? me?.id;

  // AI-style quick amounts: the amounts this group uses most.
  const quick = useMemo(() => {
    const counts = new Map<number, number>();
    (history.data ?? []).forEach((e) => counts.set(e.amount_paise, (counts.get(e.amount_paise) ?? 0) + 1));
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a]) => a);
    return top.length ? top : [10000, 50000, 100000];
  }, [history.data]);

  // Guess the category as the note is typed.
  useEffect(() => {
    const hit = Object.keys(KEYWORDS).find((k) => desc.toLowerCase().includes(k));
    if (hit) setCategory(KEYWORDS[hit]);
  }, [desc]);

  const num = (id: string) => parseFloat(vals[id] ?? '') || 0;
  const shares: Record<string, number> = useMemo(() => {
    if (!total) return {};
    if (type === 'equal') return Object.fromEntries(selected.map((id, i) => [id, allocate(total, selected.map(() => 1))[i]]));
    if (type === 'exact') return Object.fromEntries(selected.map((id) => [id, Math.round(num(id) * 100)]));
    const w = selected.map((id) => (type === 'shares' ? Math.round(num(id) || (vals[id] === undefined ? 1 : 0)) : Math.round(num(id) * 100)));
    const a = allocate(total, w);
    return Object.fromEntries(selected.map((id, i) => [id, a[i]]));
  }, [total, type, selected.join(), vals]);

  const sum = Object.values(shares).reduce((a, b) => a + b, 0);
  const pctSum = selected.reduce((a, id) => a + num(id), 0);
  const problem =
    !total ? 'Enter an amount'
    : selected.length === 0 ? 'Pick at least one person'
    : type === 'exact' && sum !== total ? `${rupees(Math.abs(total - sum))} ${sum < total ? 'left to assign' : 'too much'}`
    : type === 'percent' && Math.abs(pctSum - 100) > 0.01 ? `${Math.abs(100 - pctSum).toFixed(0)}% ${pctSum < 100 ? 'left' : 'too much'}`
    : type === 'shares' && sum === 0 ? 'Give someone a share'
    : null;
  // The judge sweats while the numbers don't add up, and beams when they do.
  const judge: Mood = sliced ? 'cheer' : problem && total ? 'worried' : total ? 'proud' : 'idle';

  const toggle = (id: string) => {
    haptic.tick();
    setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const save = async () => {
    if (problem || !groupId || !payerId) {
      haptic.warn();
      shake.value = withSequence(withTiming(-8, { duration: 50 }), withTiming(8, { duration: 50 }), withTiming(-6, { duration: 50 }), withTiming(0, { duration: 50 }));
      return;
    }
    setBusy(true);
    const body: any = { currency, original_minor: foreign ? originalMinor : undefined, description: desc.trim() || (category === 'other' ? 'Expense' : CATEGORY[category].label), amount_paise: total, category, split_type: type, payers: { [payerId]: total }, member_ids: selected };
    if (type === 'exact') body.exact = shares;
    if (type === 'shares') body.weights = Object.fromEntries(selected.map((id) => [id, Math.round(num(id) || (vals[id] === undefined ? 1 : 0))]).filter(([, v]) => (v as number) > 0));
    if (type === 'percent') body.percents = Object.fromEntries(selected.map((id) => [id, num(id)]).filter(([, v]) => (v as number) > 0));
    try {
      if (draft?.draft_id) await api('/agent/confirm', { body: { draft_id: draft.draft_id, expense: body } });
      else await api(`/groups/${groupId}/expenses`, { body });
      // "Sliced!": the pizza bursts apart.
      setSliced(Date.now());
      haptic.success();
      sfx.slice();
      useStore.getState().earn({ key: 'first-split', title: 'First split!', sub: 'You sliced your first bill.', unlocks: 'cap' });
      burst.value = withSequence(withSpring(1, spring.bouncy), withTiming(1, { duration: 700 }));
      await refreshAll();
      setTimeout(() => (router.canGoBack() ? router.back() : router.replace(`/group/${groupId}`)), 1250);
    } catch (e) {
      // No internet: keep a hand-made expense on the phone and send it later. (AI drafts need the server.)
      if (e instanceof ApiError && e.status === 0 && !draft?.draft_id) {
        enqueueExpense(groupId, body);
        haptic.bump();
        showToast("You're offline. Saved on your phone, and Fin will sync it when you're back.", 'info');
        setTimeout(() => (router.canGoBack() ? router.back() : router.replace('/home')), 600);
        return;
      }
      haptic.error();
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
      setBusy(false);
    }
  };

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  if (step === 'amount') {
    return (
      <Screen title={t("Add expense")}>
        <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between', paddingBottom: 16 }}>
          <View style={{ gap: 14 }}>
            {(groups.data?.length ?? 0) > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {groups.data!.map((g) => <Chip key={g.id} label={g.name} emoji={g.emoji} active={g.id === groupId} onPress={() => setGroupId(g.id)} />)}
              </ScrollView>
            ) : null}
            <View style={{ alignItems: 'center' }}>
              <Press onPress={() => setCurPicker(!curPicker)} style={styles.curBtn} label="Change currency">
                <T v="small" w="bold" color={colors.purple}>{FLAG[currency] ?? '🌐'} {currency} ▾</T>
              </Press>
            </View>
            {curPicker ? (
              <Animated.View entering={FadeInDown.springify()}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {CURRENCY_LIST.map((c) => <Chip key={c} label={c} emoji={FLAG[c]} active={c === currency} onPress={() => { haptic.tick(); setCurrency(c); setCurPicker(false); if (c !== 'INR' && type === 'exact') setType('equal'); }} />)}
                </ScrollView>
              </Animated.View>
            ) : null}
            <View style={{ alignItems: 'center', gap: 4, marginTop: 4 }}>
              <Text style={{ fontFamily: font.extra, fontSize: hasOp ? 30 : 54, color: expr ? colors.ink : colors.inkFaint, letterSpacing: -1 }} numberOfLines={1} adjustsFontSizeToFit>
                {hasOp ? expr.replace(/-/g, '−') : `${SYMBOL[currency] ?? currency + ' '}${expr || '0'}`}
              </Text>
              {foreign ? (
                <Animated.View entering={FadeInDown.springify()} style={{ alignItems: 'center' }}>
                  {fx ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><T v="h3" color={colors.purple}>≈</T><RollingNumber text={rupees(total)} size={24} color={colors.purple} /></View>
                      <T v="tiny" color={colors.inkFaint} style={{ textTransform: 'none', letterSpacing: 0 }}>1 {currency} = ₹{fx.rate.toFixed(2)} · rate of {fx.date}</T>
                    </>
                  ) : fxError ? <T v="small" color={colors.coral}>{fxError}</T> : <Dots />}
                </Animated.View>
              ) : null}
              {hasOp ? (
                <Animated.View entering={FadeInDown.springify()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <T v="h2" color={colors.purple}>=</T>
                  <RollingNumber text={rupees(total)} size={30} color={colors.purple} />
                </Animated.View>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
              {foreign ? null : quick.map((q) => <Chip key={q} label={rupees(q)} emoji="✨" onPress={() => { haptic.tap(); setExpr(String(q / 100)); }} />)}
            </View>
            {/* "Add a note" pill grows into an input; chips filter as you type */}
            <Animated.View layout={LinearTransition.springify().damping(15)} style={{ alignItems: 'center', gap: 10 }}>
              {noteOpen ? (
                <Animated.View entering={FadeIn} style={{ alignSelf: 'stretch', gap: 10 }}>
                  <TextInput autoFocus={!draft} value={desc} onChangeText={setDesc} placeholder={t("What was it for?")} placeholderTextColor={colors.inkFaint} maxLength={60} style={styles.note} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                    {Object.entries(CATEGORY).filter(([k, c]) => !desc || k === category || c.label.toLowerCase().includes(desc.toLowerCase())).map(([k, c]) => (
                      <Chip key={k} label={t(c.label)} emoji={c.emoji} active={k === category} onPress={() => setCategory(k)} />
                    ))}
                  </ScrollView>
                </Animated.View>
              ) : (
                <Press onPress={() => setNoteOpen(true)} style={styles.notePill}><T v="small" w="bold" color={colors.purple}>{t("＋ Add a note")}</T></Press>
              )}
            </Animated.View>
          </View>
          <View style={{ gap: 12 }}>
            <Keypad value={expr} onChange={setExpr} />
            <Btn title={t("Next: who's splitting?")} onPress={() => { if (!total) return haptic.warn(); setStep('split'); }} disabled={!total} />
          </View>
        </KeyboardAwareScrollView>
      </Screen>
    );
  }

  return (
    <Screen title={sliced ? t("Sliced!") : t("Split it")}>
      <Confetti fire={sliced} />
      <KeyboardAwareScrollView bottomOffset={24} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <PizzaChart values={members.map((m) => shares[m.id] ?? 0)} size={176} burst={burst} />
          <View style={{ position: 'absolute', right: 0, bottom: -6 }}>
            <Mascot size={74} mood={judge} speech={sliced ? t("Sliced!") : problem && total ? problem : undefined} />
          </View>
          <Press onPress={() => setStep('amount')} style={{ position: 'absolute', left: 0, top: 6 }} label="Change amount">
            <T v="tiny" color={colors.inkFaint}>{t("total")}</T>
            <T v="h2">{rupees(total)}</T>
            <T v="small" w="bold" color={colors.purple}>{t("Edit")}</T>
          </Press>
        </View>

        <View style={styles.block}>
          <T v="tiny" color={colors.inkFaint}>{t("Paid by")}</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {members.map((m, i) => (
              <Press key={m.id} onPress={() => { haptic.tick(); setPayer(m.id); }} label={m.name}>
                <View style={{ alignItems: 'center', width: 58 }}>
                  <Avatar name={m.name} index={i} size={40} selected={m.id === payerId} />
                  <T v="tiny" numberOfLines={1} style={{ textTransform: 'none', letterSpacing: 0 }} color={m.id === payerId ? colors.purple : colors.inkSoft}>{m.is_self ? t("You") : m.name.split(' ')[0]}</T>
                </View>
              </Press>
            ))}
          </ScrollView>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {TYPES.filter((ty) => !foreign || ty.key !== 'exact').map((ty) => <Chip key={ty.key} label={t(ty.label)} active={type === ty.key} onPress={() => { haptic.tap(); setType(ty.key); setVals({}); }} />)}
        </ScrollView>

        <Animated.View style={[styles.block, shakeStyle]} layout={LinearTransition.springify()}>
          {members.map((m, i) => {
            const on = selected.includes(m.id);
            return (
              <Animated.View key={m.id} layout={LinearTransition.springify()} style={styles.row}>
                <Press onPress={() => toggle(m.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }} label={`${m.name} ${on ? 'included' : 'left out'}`}>
                  <View style={{ opacity: on ? 1 : 0.35 }}><Avatar name={m.name} index={i} size={38} /></View>
                  <View style={{ flex: 1 }}>
                    <T w="semi" color={on ? colors.ink : colors.inkFaint} numberOfLines={1}>{m.is_self ? t("You") : m.name}</T>
                    {on && type !== 'equal' && type !== 'exact' ? <T v="small" color={colorFor(i)}>{rupees(shares[m.id] ?? 0)}</T> : null}
                  </View>
                </Press>
                {!on ? <T v="small" color={colors.inkFaint}>{t("skipped")}</T> : type === 'equal' ? (
                  <Animated.View entering={ZoomIn.springify()}><T v="h3" color={colorFor(i)}>{rupees(shares[m.id] ?? 0)}</T></Animated.View>
                ) : (
                  <View style={styles.mini}>
                    {type === 'exact' ? <T v="small" color={colors.inkFaint}>₹</T> : null}
                    <TextInput value={vals[m.id] ?? (type === 'shares' ? '1' : '')} onChangeText={(v) => setVals({ ...vals, [m.id]: v.replace(/[^0-9.]/g, '') })}
                      keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.inkFaint} style={styles.miniInput} maxLength={9} selectTextOnFocus />
                    {type === 'percent' ? <T v="small" color={colors.inkFaint}>%</T> : type === 'shares' ? <T v="small" color={colors.inkFaint}>×</T> : null}
                  </View>
                )}
              </Animated.View>
            );
          })}
        </Animated.View>

        {problem && total ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ alignItems: 'center' }}><T v="small" w="bold" color={colors.coral}>💧 {problem}</T></Animated.View>
        ) : null}
        <Btn title={sliced ? 'Sliced! 🍕' : `Split ${rupees(total)}`} onPress={save} loading={busy && !sliced} disabled={!!sliced} />
      </KeyboardAwareScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { height: 52, borderRadius: radius.pill, backgroundColor: '#fff', paddingHorizontal: 20, fontFamily: font.semi, fontSize: 15.5, color: colors.ink, borderWidth: 1.5, borderColor: colors.line, textAlign: 'center' },
  curBtn: { backgroundColor: colors.purpleSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  notePill: { backgroundColor: colors.purpleSoft, paddingHorizontal: 18, paddingVertical: 10, borderRadius: radius.pill },
  block: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, gap: 10, ...shadow, shadowOpacity: 0.07 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46 },
  mini: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FBF6FD', borderRadius: radius.sm, paddingHorizontal: 10, height: 42, borderWidth: 1.5, borderColor: colors.line },
  miniInput: { minWidth: 54, textAlign: 'right', fontFamily: font.bold, fontSize: 15.5, color: colors.ink, padding: 0 },
});

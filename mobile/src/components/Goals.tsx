/** Group savings goals ("Goa fund"): a ring fills as friends chip in. Fin tracks it; the keeper holds the money. */
import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInRight } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { Confetti } from '@/components/fx';
import { Mascot } from '@/components/Mascot';
import { Avatar, Btn, Chip, Field, Press, Sheet, T } from '@/components/ui';
import { ApiError, Member, api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { payWithUpi } from '@/lib/payapp';
import { sfx } from '@/lib/sfx';
import { useStore } from '@/lib/store';
import { colors, radius, shadow } from '@/lib/theme';
import { buildLink, parseUpi } from '@/lib/upi';
import { haptic, rupees } from '@/lib/util';

export type Goal = { id: string; name: string; emoji: string; target_paise: number; saved_paise: number; keeper_member: string; keeper_upi_link: string | null; due_on: string | null; by_member: Record<string, number>; reached: boolean };

const EMOJIS = ['🎯', '🏖️', '✈️', '🎂', '🎁', '🏠', '🎮', '🏕️', '🚗', '🎉'];

/** Eases a number from where it was to `target`. Plain JS frames, so it behaves the same on every platform. */
function useEased(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const from = React.useRef(0);
  useEffect(() => {
    const start = Date.now();
    const begin = from.current;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const now = begin + (target - begin) * eased;
      from.current = now;
      setV(now);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export function Ring({ value, size = 76, stroke = 9, children }: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const gid = 'ring' + React.useId().replace(/[^a-zA-Z0-9]/g, '');
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shown = useEased(Math.max(0, Math.min(1, value)));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={[StyleSheet.absoluteFill, { transform: [{ rotate: '-90deg' }] }]}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#FF6FB1" /><Stop offset="1" stopColor="#7B4DFF" /></LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.line} strokeWidth={stroke} fill="none" />
        {shown > 0.001 ? (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={value >= 1 ? colors.mint : `url(#${gid})`} strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - shown)} />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

export function GoalsStrip({ groupId, members }: { groupId: string; members: Member[] }) {
  const q = useQuery({ queryKey: ['goals', groupId], queryFn: () => api<Goal[]>(`/groups/${groupId}/goals`) });
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const goals = q.data ?? [];
  const open = goals.find((g) => g.id === openId) ?? null;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
        {goals.map((g, i) => (
          <Animated.View key={g.id} entering={FadeInRight.delay(i * 70).springify().damping(14)}>
            <Press onPress={() => setOpenId(g.id)} scaleTo={0.95} style={styles.goal} label={g.name}>
              <Ring value={g.saved_paise / g.target_paise} size={52} stroke={6}><Text style={{ fontSize: 20 }}>{g.emoji}</Text></Ring>
              <View style={{ maxWidth: 120 }}>
                <T w="bold" numberOfLines={1}>{g.name}</T>
                <T v="small" color={g.reached ? colors.mint : colors.inkSoft} numberOfLines={1}>{g.reached ? t('Goal reached 🎉') : `${rupees(g.saved_paise)} / ${rupees(g.target_paise)}`}</T>
              </View>
            </Press>
          </Animated.View>
        ))}
        <Press onPress={() => setCreating(true)} style={[styles.goal, { backgroundColor: colors.purpleSoft, shadowOpacity: 0 }]} label="New savings goal">
          <Text style={{ fontSize: 22 }}>🎯</Text>
          <T v="small" w="bold" color={colors.purple}>{goals.length ? t('＋ Goal') : t('＋ Savings goal')}</T>
        </Press>
      </ScrollView>
      <NewGoal visible={creating} onClose={() => setCreating(false)} groupId={groupId} onMade={() => q.refetch()} />
      <GoalSheet goal={open} onClose={() => setOpenId(null)} members={members} onChange={() => q.refetch()} />
    </View>
  );
}

function NewGoal({ visible, onClose, groupId, onMade }: { visible: boolean; onClose: () => void; groupId: string; onMade: () => void }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useStore((s) => s.showToast);
  const save = async () => {
    const paise = Math.round(parseFloat(amount || '0') * 100);
    if (!name.trim() || !paise) return showToast(t('Give it a name and a target'), 'warn');
    setBusy(true);
    try {
      await api(`/groups/${groupId}/goals`, { body: { name: name.trim(), emoji, target_paise: paise } });
      haptic.success();
      setName(''); setAmount(''); setEmoji('🎯');
      onMade();
      onClose();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('New savings goal')}>
      <View style={{ gap: 12 }}>
        <View style={{ alignItems: 'center' }}><Ring value={0.35} size={90}><Text style={{ fontSize: 34 }}>{emoji}</Text></Ring></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {EMOJIS.map((e) => <Chip key={e} label={e} active={e === emoji} onPress={() => { haptic.tick(); setEmoji(e); }} />)}
        </ScrollView>
        <Field value={name} onChangeText={setName} placeholder={t('Goa trip fund')} maxLength={60} />
        <Field value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} placeholder={t('Target amount (₹)')} keyboardType="decimal-pad" maxLength={10} />
        <T v="small" color={colors.inkSoft}>{t('You hold the money. Friends pay you, and Fin keeps track of who has chipped in.')}</T>
        <Btn title={t('Create goal')} onPress={save} loading={busy} />
      </View>
    </Sheet>
  );
}

function GoalSheet({ goal, onClose, members, onChange }: { goal: Goal | null; onClose: () => void; members: Member[]; onChange: () => void }) {
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [boom, setBoom] = useState(0);
  const showToast = useStore((s) => s.showToast);
  const me = members.find((m) => m.is_self);
  const keeper = members.find((m) => m.id === goal?.keeper_member);
  const iKeep = keeper?.id === me?.id;
  const left = goal ? Math.max(goal.target_paise - goal.saved_paise, 0) : 0;

  const add = async (paise: number) => {
    if (!goal || !paise) return;
    setBusy(true);
    try {
      const was = goal.reached;
      const r: Goal = await api(`/goals/${goal.id}/contributions`, { body: { amount_paise: paise } });
      haptic.success();
      sfx.coin();
      setAmount('');
      onChange();
      if (r.reached && !was) {
        setBoom(Date.now());
        sfx.success();
        useStore.getState().earn({ key: `goal-${goal.id}`, title: `${goal.emoji} ${goal.name} reached!`, sub: `Your group saved ${rupees(r.saved_paise)} together.` });
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
    } finally {
      setBusy(false);
    }
  };
  const payThenAdd = async () => {
    const paise = Math.round(parseFloat(amount || '0') * 100);
    const p = keeper?.upi_id ? parseUpi(keeper.upi_id) : null;
    if (!p || !paise) return;
    p.name = keeper!.name;
    p.params.push(['pn', keeper!.name], ['tn', `Fin ${goal!.name}`]);
    const status = await payWithUpi(buildLink(p, paise));
    if (status === 'success') return add(paise);
    if (status === 'failure') return showToast(t("The payment didn't go through"), 'warn');
    if (status === 'no_app') return showToast(t('No UPI app found on this phone'), 'warn');
    showToast(t('If you paid, tap “I’ve put this in” to record it'), 'info');
  };

  return (
    <Sheet visible={!!goal} onClose={onClose} title={goal ? `${goal.emoji} ${goal.name}` : ''}>
      <Confetti fire={boom} coins />
      {goal ? (
        <View style={{ gap: 12 }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Ring value={goal.saved_paise / goal.target_paise} size={140} stroke={14}>
              <View style={{ alignItems: 'center' }}>
                <T v="h2">{Math.min(100, Math.round((goal.saved_paise / goal.target_paise) * 100))}%</T>
                <T v="tiny" color={colors.inkFaint} style={{ textTransform: 'none', letterSpacing: 0 }}>{rupees(goal.saved_paise)}</T>
              </View>
            </Ring>
            <T color={colors.inkSoft}>{goal.reached ? t('Goal reached 🎉') : `${rupees(left)} ${t('to go')} · ${t('target')} ${rupees(goal.target_paise)}`}</T>
            <T v="small" color={colors.inkFaint}>{t('Money is held by')} {iKeep ? t('you') : keeper?.name ?? '—'}</T>
          </View>
          <View style={{ gap: 8 }}>
            {Object.entries(goal.by_member).sort((a, b) => b[1] - a[1]).map(([mid, amt], i) => {
              const m = members.find((x) => x.id === mid);
              return (
                <Animated.View key={mid} entering={FadeInDown.delay(i * 60)} style={styles.row}>
                  <Avatar name={m?.name ?? '?'} index={members.findIndex((x) => x.id === mid)} size={34} />
                  <T w="semi" style={{ flex: 1 }}>{m?.is_self ? t('You') : m?.name ?? 'Former member'}</T>
                  <T w="bold">{rupees(amt)}</T>
                </Animated.View>
              );
            })}
            {!Object.keys(goal.by_member).length ? <View style={{ alignItems: 'center' }}><Mascot size={70} mood="idle" speech={t('Be the first to chip in!')} /></View> : null}
          </View>
          {!goal.reached ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {[50000, 100000, 200000].filter((q) => q <= Math.max(left, 50000)).map((q) => <Chip key={q} label={rupees(q)} onPress={() => setAmount(String(q / 100))} />)}
                {left > 0 ? <Chip label={`${t('All of it')} ${rupees(left)}`} onPress={() => setAmount(String(left / 100))} /> : null}
              </View>
              <Field value={amount} onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ''))} placeholder={t('Amount (₹)')} keyboardType="decimal-pad" maxLength={10} />
              {!iKeep && keeper?.upi_id ? <Btn title={`${t('Pay')} ${keeper.name.split(' ')[0]} ${t('with UPI')}`} icon="⚡" onPress={payThenAdd} disabled={!amount} /> : null}
              <Btn title={t('I’ve put this in')} kind={!iKeep && keeper?.upi_id ? 'soft' : 'primary'} onPress={() => add(Math.round(parseFloat(amount || '0') * 100))} loading={busy} disabled={!amount} />
            </>
          ) : null}
          <Btn title={t('Delete goal')} kind="ghost" onPress={async () => { try { await api(`/goals/${goal.id}`, { method: 'DELETE' }); onChange(); onClose(); } catch {} }} />
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  goal: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 12, ...shadow, shadowOpacity: 0.08 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: radius.md, padding: 10 },
});

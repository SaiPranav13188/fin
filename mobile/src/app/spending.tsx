/** Your own payments outside groups: imported from statements or added by hand. Delete a wrong one here. */
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { Mascot } from '@/components/Mascot';
import { Btn, Empty, Press, Screen, Skeleton, T } from '@/components/ui';
import { ApiError, Expense, api } from '@/lib/api';
import { refreshAll } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { CATEGORY, colors, radius, shadow } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

export default function Spending() {
  const personal = useQuery({ queryKey: ['personal'], queryFn: () => api<{ group_id: string }>('/me/personal') });
  const gid = personal.data?.group_id;
  const list = useQuery({ queryKey: ['personal-expenses', gid], queryFn: () => api<Expense[]>(`/groups/${gid}/expenses?limit=200`), enabled: !!gid });
  const [gone, setGone] = useState<string[]>([]);
  const showToast = useStore((s) => s.showToast);
  const rows = (list.data ?? []).filter((e) => !gone.includes(e.id)).sort((a, b) => (a.spent_on < b.spent_on ? 1 : -1));

  const remove = async (e: Expense) => {
    haptic.thunk();
    setGone((g) => [...g, e.id]);
    try {
      await api(`/groups/${gid}/expenses/${e.id}`, { method: 'DELETE' });
      refreshAll();
    } catch (err) {
      setGone((g) => g.filter((x) => x !== e.id));
      showToast(err instanceof ApiError ? err.message : 'Could not delete', 'warn');
    }
  };

  // group by month
  const byMonth: Record<string, Expense[]> = {};
  rows.forEach((e) => (byMonth[e.spent_on.slice(0, 7)] ??= []).push(e));

  return (
    <Screen title="My payments">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn small title="Import" icon="📥" onPress={() => router.push('/import')} style={{ flex: 1 }} />
          <Btn small title="Add payment" icon="＋" kind="soft" onPress={() => gid && router.push({ pathname: '/add-expense', params: { group: gid } })} style={{ flex: 1 }} />
        </View>
        <T v="small" color={colors.inkSoft}>Payments you made outside your groups, like GPay, PhonePe, Paytm or card. They count in what you spent this month, and nobody else can see them.</T>
        {list.isLoading || personal.isLoading ? <><Skeleton h={64} /><Skeleton h={64} /></> : rows.length === 0 ? (
          <Empty title="No payments yet" sub="Import a statement or add a payment, and it shows up here."><Mascot size={100} mood="idle" /></Empty>
        ) : Object.entries(byMonth).map(([month, items]) => (
          <View key={month} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="tiny" color={colors.inkFaint}>{new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</T>
              <T v="tiny" color={colors.inkFaint}>{rupees(items.reduce((a, e) => a + e.amount_paise, 0))}</T>
            </View>
            {items.map((e, i) => (
              <Animated.View key={e.id} entering={FadeInDown.delay(Math.min(i, 8) * 30).springify().damping(15)} exiting={FadeOut} layout={LinearTransition.springify()}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: radius.md, padding: 12, ...shadow, shadowOpacity: 0.05 }}>
                <Text style={{ fontSize: 26 }}>{(CATEGORY[e.category] ?? CATEGORY.other).emoji}</Text>
                <View style={{ flex: 1 }}>
                  <T w="bold" numberOfLines={1}>{e.description}</T>
                  <T v="small" color={colors.inkSoft}>{new Date(e.spent_on + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{e.created_via === 'import' ? ' · imported' : ''}</T>
                </View>
                <T w="bold">{rupees(e.amount_paise)}</T>
                <Press onPress={() => remove(e)} label={`Delete ${e.description}`}><T w="bold" color={colors.coral}>✕</T></Press>
              </Animated.View>
            ))}
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

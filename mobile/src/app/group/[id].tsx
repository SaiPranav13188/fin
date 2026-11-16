import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeInDown, LinearTransition, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { Chillar } from '@/components/Chillar';
import { Confetti, PizzaChart, Progress } from '@/components/fx';
import { Avatar, Btn, Empty, Press, Screen, Sheet, Skeleton, T } from '@/components/ui';
import { ApiError, Expense, Member, Message, api } from '@/lib/api';
import { queryClient, useBalances, useExpenses, useGroup, useGroupLive, useMessages } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { CATEGORY, colors, font, radius, shadow, spring } from '@/lib/theme';
import { haptic, rupees, timeAgo } from '@/lib/util';

function SplitCard({ e, members, net, onDelete, onSettle, onNudge }: { e: Expense; members: Member[]; net: Record<string, number>; onDelete: () => void; onSettle: () => void; onNudge: (m: Member) => void }) {
  const x = useSharedValue(0);
  const crumple = useSharedValue(0);
  const burst = useSharedValue(0);
  const [wiggle, setWiggle] = useState<Record<string, number>>({});
  const idx = (id: string) => Math.max(0, members.findIndex((m) => m.id === id));
  const people = Object.keys(e.shares);
  const settled = people.filter((id) => e.payers[id] !== undefined || (net[id] ?? 0) >= 0);
  const payer = members.find((m) => m.id === Object.keys(e.payers)[0]);
  const cat = CATEGORY[e.category] ?? CATEGORY.other;

  const pan = Gesture.Pan()
    .activeOffsetX([-18, 18])
    .failOffsetY([-12, 12])
    .onUpdate((ev) => { x.value = ev.translationX * 0.8; })
    .onEnd(() => {
      if (x.value < -110) {
        crumple.value = withTiming(1, { duration: 320 }, () => scheduleOnRN(onDelete)); // crumple, then delete
      } else if (x.value > 110) {
        scheduleOnRN(onSettle);
        x.value = withSpring(0, spring.bouncy);
      } else x.value = withSpring(0, spring.bouncy);
    });
  const card = useAnimatedStyle(() => ({
    opacity: 1 - crumple.value,
    transform: [{ translateX: x.value }, { rotate: `${interpolate(x.value, [-200, 200], [-5, 5]) + crumple.value * 40}deg` }, { scale: 1 - crumple.value * 0.85 }],
  }));
  const left = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [20, 110], [0, 1], 'clamp') }));
  const right = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-110, -20], [1, 0], 'clamp') }));

  return (
    <View>
      <Animated.View style={[styles.hint, { left: 16 }, left]}><T v="small" w="bold" color={colors.mint}>🤝 Settle</T></Animated.View>
      <Animated.View style={[styles.hint, { right: 16 }, right]}><T v="small" w="bold" color={colors.coral}>Delete 🗑️</T></Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.split, card]}>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <View style={{ width: 62, height: 62, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ transform: [{ scale: 0.3 }] }}><PizzaChart values={people.map((id) => e.shares[id])} size={170} burst={burst} /></View>
            </View>
            <View style={{ flex: 1 }}>
              <T v="h3" numberOfLines={1}>{cat.emoji} {e.description}</T>
              <T v="small" color={colors.inkSoft} numberOfLines={1}>{payer?.is_self ? 'You' : payer?.name ?? 'Someone'} paid · {timeAgo(e.created_at)}{e.created_via !== 'manual' ? ' · ✨' : ''}</T>
            </View>
            <T v="h2">{rupees(e.amount_paise)}</T>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 }}>
            {people.map((id) => {
              const m = members.find((mm) => mm.id === id);
              if (!m) return null;
              const paid = settled.includes(id);
              return (
                <Press key={id} scaleTo={0.9} label={m.name}
                  onLongPress={paid || m.is_self ? undefined : () => { haptic.bump(); setWiggle({ ...wiggle, [id]: Date.now() }); onNudge(m); }}>
                  <View style={{ alignItems: 'center', width: 54 }}>
                    <Avatar name={m.name} index={idx(id)} size={34} ring={paid ? 'paid' : 'pending'} wiggleKey={wiggle[id]} />
                    <T v="tiny" color={colors.inkSoft} style={{ textTransform: 'none', letterSpacing: 0 }}>{rupees(e.shares[id])}</T>
                  </View>
                </Press>
              );
            })}
          </View>
          <View style={{ marginTop: 10, gap: 6 }}>
            <Progress value={settled.length / Math.max(people.length, 1)} />
            <T v="small" color={colors.inkSoft}>{settled.length === people.length ? 'All settled 🎉' : `${settled.length} of ${people.length} settled · long-press a face to nudge`}</T>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const group = useGroup(id);
  const expenses = useExpenses(id);
  const balances = useBalances(id);
  const messages = useMessages(id);
  useGroupLive(id);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [celebrate, setCelebrate] = useState(0);
  const wasSettled = useRef<boolean | null>(null);
  const showToast = useStore((s) => s.showToast);
  const list = useRef<FlatList<Message>>(null);

  const members = group.data?.members ?? [];
  const me = members.find((m) => m.is_self);
  const net = balances.data?.net ?? {};
  const byId = useMemo(() => Object.fromEntries((expenses.data ?? []).map((e) => [e.id, e])), [expenses.data]);
  const myNet = me ? net[me.id] ?? 0 : 0;

  // Confetti the moment the whole group becomes settled.
  React.useEffect(() => {
    if (!balances.data || !(expenses.data?.length)) return;
    if (wasSettled.current === false && balances.data.all_settled) {
      setCelebrate(Date.now());
      haptic.success();
    }
    wasSettled.current = balances.data.all_settled;
  }, [balances.data?.all_settled, expenses.data?.length]);

  const invalidate = () => ['group', 'expenses', 'balances', 'messages'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k, id] }));

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    // A message that looks like an expense goes to the assistant instead of the chat.
    if (/\d/.test(body) && /paid|split|spent|₹|rs|diya|diye|\bfor\b/i.test(body)) {
      return router.push({ pathname: '/assistant', params: { group: id, text: body } });
    }
    try {
      await api(`/groups/${id}/messages`, { body: { body } });
      invalidate();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Message not sent', 'warn');
      setText(body);
    }
  };

  const del = async (e: Expense) => {
    haptic.thunk();
    try {
      await api(`/groups/${id}/expenses/${e.id}`, { method: 'DELETE' });
      showToast(`Deleted “${e.description}”`, 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Could not delete', 'warn');
    }
    invalidate();
    queryClient.invalidateQueries({ queryKey: ['summary'] });
    queryClient.invalidateQueries({ queryKey: ['groups'] });
  };

  const invite = async () => {
    setMenu(false);
    try {
      const r = await api(`/groups/${id}/invite`, { method: 'POST' });
      await Share.share({ message: `Join “${group.data?.name}” on Fin so we can split bills: fin://join/${r.token}` });
    } catch {}
  };

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const mine = item.sender_member === me?.id;
    const sender = members.find((m) => m.id === item.sender_member);
    if (item.kind === 'split_card') {
      const e = byId[item.ref_id ?? ''];
      if (!e) return null;
      return (
        <Animated.View entering={FadeInDown.delay(Math.min(index, 6) * 30).springify().damping(16)} layout={LinearTransition.springify()}>
          <SplitCard e={e} members={members} net={net} onDelete={() => del(e)} onSettle={() => router.push({ pathname: '/settle', params: { group: id } })}
            onNudge={(m) => router.push({ pathname: '/assistant', params: { group: id, nudge: m.id } })} />
        </Animated.View>
      );
    }
    if (item.kind === 'settle_card') {
      return (
        <Animated.View entering={FadeInDown.springify()} style={styles.system}>
          <T v="small" w="semi" color={colors.mint}>✓ {mine ? 'You' : sender?.name ?? 'Someone'} recorded a payment</T>
        </Animated.View>
      );
    }
    return (
      <Animated.View entering={FadeInDown.springify().damping(16)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
        {!mine ? <T v="tiny" color={colors.inkFaint} style={{ marginLeft: 12, marginBottom: 2, textTransform: 'none' }}>{sender?.name}</T> : null}
        <View style={[styles.bubble, mine ? { backgroundColor: colors.purple, borderBottomRightRadius: 6 } : { backgroundColor: '#fff', borderBottomLeftRadius: 6 }]}>
          <T color={mine ? '#fff' : colors.ink}>{item.body}</T>
        </View>
      </Animated.View>
    );
  };

  return (
    <Screen title={group.data ? `${group.data.emoji} ${group.data.name}` : ''} pad={false} edges={['top']}
      right={<Press onPress={() => setMenu(true)} label="Group menu"><Text style={{ fontSize: 22, color: colors.ink, fontFamily: font.extra }}>⋯</Text></Press>}>
      <Confetti fire={celebrate} coins />
      <View style={styles.summary}>
        <View style={{ flex: 1 }}>
          <T v="tiny" color={colors.inkFaint}>{myNet === 0 ? 'in this group' : myNet > 0 ? 'you get back' : 'you owe'}</T>
          <T v="h2" color={myNet === 0 ? colors.mint : myNet > 0 ? colors.mint : colors.coral}>{myNet === 0 ? "You're square ✓" : rupees(Math.abs(myNet))}</T>
        </View>
        <Btn small title="Settle" kind="soft" icon="🤝" onPress={() => router.push({ pathname: '/settle', params: { group: id } })} disabled={balances.data?.all_settled ?? true} />
        <Btn small title="Add" icon="＋" onPress={() => router.push({ pathname: '/add-expense', params: { group: id } })} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        {messages.isLoading ? <View style={{ padding: 20, gap: 12 }}><Skeleton h={150} /><Skeleton h={150} /></View> : (
          <FlatList
            ref={list}
            data={messages.data ?? []}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Empty title="Nothing here yet" sub="Add the first expense, or just type “I paid 600 for pizza”."><Chillar size={110} mood="idle" /></Empty>
            }
          />
        )}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
          <Press onPress={() => router.push({ pathname: '/assistant', params: { group: id } })} style={styles.spark} label="Ask Fin"><Text style={{ fontSize: 20 }}>✨</Text></Press>
          <TextInput value={text} onChangeText={setText} placeholder="Message, or “I paid 600 for pizza”" placeholderTextColor={colors.inkFaint} style={styles.input} onSubmitEditing={send} returnKeyType="send" maxLength={500} />
          <Press onPress={send} style={[styles.spark, { backgroundColor: colors.purple }]} disabled={!text.trim()} label="Send"><Text style={{ fontSize: 18, color: '#fff', fontFamily: font.extra }}>↑</Text></Press>
        </View>
      </KeyboardAvoidingView>

      <Sheet visible={menu} onClose={() => setMenu(false)} title="Group">
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {members.map((m, i) => (
              <View key={m.id} style={{ alignItems: 'center', width: 66 }}>
                <Avatar name={m.name} index={i} size={42} />
                <T v="tiny" numberOfLines={1} style={{ textTransform: 'none', letterSpacing: 0 }}>{m.is_self ? 'You' : m.name}</T>
              </View>
            ))}
          </View>
          <Btn title="Invite with a link" kind="soft" icon="🔗" onPress={invite} />
          <Btn title="Scan a bill" kind="soft" icon="🧾" onPress={() => { setMenu(false); router.push({ pathname: '/scan', params: { group: id } }); }} />
          <Btn title="Export as CSV" kind="soft" icon="📄" onPress={async () => {
            setMenu(false);
            try {
              const rows = (expenses.data ?? []).map((e) => `${e.spent_on}, ${e.description}, ${rupees(e.amount_paise)}`).join('\n');
              await Share.share({ message: `${group.data?.name} expenses\n${rows}` });
            } catch {}
          }} />
        </View>
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, padding: 14, backgroundColor: '#fff', borderRadius: radius.lg, ...shadow, shadowOpacity: 0.08 },
  split: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 14, ...shadow, shadowOpacity: 0.1 },
  hint: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  system: { alignSelf: 'center', backgroundColor: colors.mintSoft, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: colors.bg },
  input: { flex: 1, height: 46, borderRadius: 23, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 15, color: colors.ink, borderWidth: 1.5, borderColor: colors.line },
  spark: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center' },
});

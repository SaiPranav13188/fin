/** Insights: this month's spending by category, plus questions answered from your own records. */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { Chillar } from '@/components/Chillar';
import { Card, Chip, Dots, Empty, Press, RollingNumber, Screen, Skeleton, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useSummary } from '@/lib/hooks';
import { CATEGORY, colors, font, radius, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

function Bar({ pct, color, i }: { pct: number; color: string; i: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withDelay(i * 70, withSpring(pct, spring.gentle)); }, [pct]);
  const a = useAnimatedStyle(() => ({ width: `${Math.max(w.value * 100, 3)}%` }));
  return <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.line }}><Animated.View style={[{ height: 12, borderRadius: 6, backgroundColor: color }, a]} /></View>;
}

const ASK = ['Who owes me the most?', 'How much did I spend on food this month?', 'What do I owe?', 'How much are my subscriptions?'];

export default function Insights() {
  const summary = useSummary();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ answer: string; source: string } | null>(null);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setQ(question);
    setBusy(true);
    setAnswer(null);
    try {
      setAnswer(await api('/agent/ask', { body: { question } }));
      haptic.bump();
    } catch (e) {
      setAnswer({ answer: e instanceof ApiError ? e.message : 'Try again in a moment.', source: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const cats = Object.entries(summary.data?.month_by_category ?? {}).sort((a, b) => b[1] - a[1]);
  const max = cats[0]?.[1] ?? 1;
  return (
    <Screen title="Insights">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Card>
          <T v="tiny" color={colors.inkFaint}>Your share this month</T>
          {summary.isLoading ? <Skeleton h={44} w={160} /> : <RollingNumber text={rupees(summary.data?.month_spend_paise ?? 0)} size={40} />}
          <View style={{ gap: 12, marginTop: 14 }}>
            {cats.length === 0 && !summary.isLoading ? <T v="small" color={colors.inkSoft}>No spending yet this month. Add an expense and it shows up here.</T> : null}
            {cats.map(([k, v], i) => {
              const c = CATEGORY[k] ?? CATEGORY.other;
              return (
                <Animated.View key={k} entering={FadeInDown.delay(i * 60)} style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" w="semi">{c.emoji} {c.label}</T><T v="small" w="bold">{rupees(v)}</T></View>
                  <Bar pct={v / max} color={c.color} i={i} />
                </Animated.View>
              );
            })}
          </View>
        </Card>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <Chillar size={70} mood={busy ? 'thinking' : answer ? 'happy' : 'idle'} prop={busy ? 'magnifier' : 'none'} />
          <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 20, borderBottomLeftRadius: 6, padding: 14, minHeight: 56, justifyContent: 'center' }}>
            {busy ? <Dots /> : <T w="semi">{answer?.answer ?? 'Ask me anything about your money.'}</T>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ASK.map((a) => <Chip key={a} label={a} onPress={() => ask(a)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={q} onChangeText={setQ} placeholder="Type a question" placeholderTextColor={colors.inkFaint} onSubmitEditing={() => ask(q)} returnKeyType="send" maxLength={300}
            style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 15, color: colors.ink, borderWidth: 1.5, borderColor: colors.line }} />
          <Press onPress={() => ask(q)} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' }} label="Ask">
            <Text style={{ color: '#fff', fontSize: 18, fontFamily: font.extra }}>↑</Text>
          </Press>
        </View>
        <T v="small" color={colors.inkFaint} center>Answers come only from your own records. Fin can read them, never change them.</T>
      </ScrollView>
    </Screen>
  );
}

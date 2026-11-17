/** Insights: this month's spending by category, plus questions answered from your own records. */
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { Mascot } from '@/components/Mascot';
import { Card, Chip, Dots, Empty, Press, RollingNumber, Screen, Skeleton, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSummary } from '@/lib/hooks';
import { CATEGORY, colors, font, radius, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

function Bar({ pct, color, i }: { pct: number; color: string; i: number }) {
  const w = useSharedValue(0);
  useEffect(() => { w.value = withDelay(i * 70, withSpring(pct, spring.gentle)); }, [pct]);
  const a = useAnimatedStyle(() => ({ width: `${Math.max(w.value * 100, 3)}%` }));
  return <View style={{ height: 12, borderRadius: 6, backgroundColor: colors.line }}><Animated.View style={[{ height: 12, borderRadius: 6, backgroundColor: color }, a]} /></View>;
}

const ASK = ['Who owes me the most?', 'How much did I spend on food this month?', 'What do I owe?', 'How much are my subscriptions?'];

type Wrap = { month_name: string; has_data: boolean; change_pct: number | null; total_paise: number; prev_total_paise: number;
  by_category: { category: string; paise: number; prev_paise: number; change_pct: number | null }[] };

/** Plain-language cards comparing this month with last month. Only real numbers, nothing guessed. */
function trendCards(w: Wrap): { emoji: string; text: string; tone: 'up' | 'down' | 'info' }[] {
  const out: { emoji: string; text: string; tone: 'up' | 'down' | 'info' }[] = [];
  if (w.change_pct !== null && Math.abs(w.change_pct) >= 5) {
    out.push({ emoji: w.change_pct > 0 ? '📈' : '📉', tone: w.change_pct > 0 ? 'up' : 'down',
      text: `You spent ${Math.abs(w.change_pct)}% ${w.change_pct > 0 ? 'more' : 'less'} than last month (${rupees(w.total_paise)} vs ${rupees(w.prev_total_paise)}).` });
  }
  for (const c of w.by_category) {
    if (out.length >= 4) break;
    const cat = CATEGORY[c.category] ?? CATEGORY.other;
    if (c.change_pct !== null && Math.abs(c.change_pct) >= 20 && Math.max(c.paise, c.prev_paise) >= 20000) {
      out.push({ emoji: cat.emoji, tone: c.change_pct > 0 ? 'up' : 'down', text: `${cat.label}: ${Math.abs(c.change_pct)}% ${c.change_pct > 0 ? 'more' : 'less'} than last month.` });
    } else if (c.change_pct === null && c.paise >= 20000) {
      out.push({ emoji: cat.emoji, tone: 'info', text: `New this month: ${rupees(c.paise)} on ${cat.label.toLowerCase()}.` });
    }
  }
  return out;
}

export default function Insights() {
  const summary = useSummary();
  const wrap = useQuery({ queryKey: ['wrapped'], queryFn: () => api<Wrap>('/me/wrapped') });
  const trends = wrap.data?.has_data ? trendCards(wrap.data) : [];
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
    <Screen title={t("Insights")}>
      <KeyboardAwareScrollView bottomOffset={24} showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {wrap.data?.has_data ? (
          <Press onPress={() => router.push('/wrapped')} scaleTo={0.97} label="Open your month wrapped">
            <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.lg, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontSize: 34 }}>✨</Text>
              <View style={{ flex: 1 }}><T v="h3" color="#fff">Your {wrap.data.month_name} wrapped</T><T v="small" color="rgba(255,255,255,0.9)">Your month as a story. Tap to play.</T></View>
              <Text style={{ fontSize: 22, color: '#fff' }}>›</Text>
            </LinearGradient>
          </Press>
        ) : null}
        <Press onPress={() => router.push('/spending')} label="Manage my payments"><T v="small" w="bold" color={colors.purple}>🧾 Manage payments I imported or added ›</T></Press>
        {trends.map((c, i) => (
          <Animated.View key={c.text} entering={FadeInDown.delay(i * 90).springify().damping(14)}
            style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 14, borderRadius: radius.md, backgroundColor: c.tone === 'up' ? colors.coralSoft : c.tone === 'down' ? colors.mintSoft : colors.purpleSoft }}>
            <Text style={{ fontSize: 24 }}>{c.emoji}</Text>
            <T w="semi" style={{ flex: 1 }}>{c.text}</T>
          </Animated.View>
        ))}
        <Card>
          <T v="tiny" color={colors.inkFaint}>{t("Your share this month")}</T>
          {summary.isLoading ? <Skeleton h={44} w={160} /> : <RollingNumber text={rupees(summary.data?.month_spend_paise ?? 0)} size={40} />}
          <View style={{ gap: 12, marginTop: 14 }}>
            {cats.length === 0 && !summary.isLoading ? <T v="small" color={colors.inkSoft}>{t("No spending yet this month. Add an expense and it shows up here.")}</T> : null}
            {cats.map(([k, v], i) => {
              const c = CATEGORY[k] ?? CATEGORY.other;
              return (
                <Animated.View key={k} entering={FadeInDown.delay(i * 60)} style={{ gap: 5 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T v="small" w="semi">{c.emoji} {t(c.label)}</T><T v="small" w="bold">{rupees(v)}</T></View>
                  <Bar pct={v / max} color={c.color} i={i} />
                </Animated.View>
              );
            })}
          </View>
        </Card>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <Mascot size={70} mood={busy ? 'thinking' : answer ? 'happy' : 'idle'} prop={busy ? 'magnifier' : 'none'} />
          <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 20, borderBottomLeftRadius: 6, padding: 14, minHeight: 56, justifyContent: 'center' }}>
            {busy ? <Dots /> : <T w="semi">{answer?.answer ?? t("Ask me anything about your money.")}</T>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ASK.map((a) => <Chip key={a} label={a} onPress={() => ask(a)} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={q} onChangeText={setQ} placeholder={t("Type a question")} placeholderTextColor={colors.inkFaint} onSubmitEditing={() => ask(q)} returnKeyType="send" maxLength={300}
            style={{ flex: 1, height: 48, borderRadius: 24, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 15, color: colors.ink, borderWidth: 1.5, borderColor: colors.line }} />
          <Press onPress={() => ask(q)} style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' }} label="Ask">
            <Text style={{ color: '#fff', fontSize: 18, fontFamily: font.extra }}>↑</Text>
          </Press>
        </View>
        <T v="small" color={colors.inkFaint} center>{t("Answers come only from your own records. Fin can read them, never change them.")}</T>
      </KeyboardAwareScrollView>
    </Screen>
  );
}

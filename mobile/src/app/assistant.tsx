/** Ask Fin: type or speak. Chillar acts out each agent step as it streams, then a draft card springs up. */
import { router, useLocalSearchParams } from 'expo-router';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn, FadeInDown, FadeOut, LinearTransition, SlideInDown, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chillar, Mood, Prop } from '@/components/Chillar';
import { Confetti } from '@/components/fx';
import { Avatar, Btn, Chip, Dots, Press, T } from '@/components/ui';
import { AgentEvent, ApiError, Draft, api, streamDraft } from '@/lib/api';
import { refreshAll, useGroup, useGroups } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { CATEGORY, colors, font, radius, shadow, spring } from '@/lib/theme';
import { haptic, rupees } from '@/lib/util';

/** What Chillar holds while each agent works, so the user can see who is doing what. */
const ACT: Record<string, { prop: Prop; mood: Mood }> = {
  orchestrator: { prop: 'none', mood: 'thinking' },
  expense_parser: { prop: 'glasses', mood: 'idle' },
  receipt_reader: { prop: 'glasses', mood: 'idle' },
  split_advisor: { prop: 'calculator', mood: 'thinking' },
  settle_planner: { prop: 'calculator', mood: 'thinking' },
  nudge_writer: { prop: 'letter', mood: 'happy' },
  insights: { prop: 'magnifier', mood: 'thinking' },
  safety_guard: { prop: 'magnifier', mood: 'worried' },
};
const EXAMPLES = ['I paid 1200 for pizza with Rahul', 'Who owes me the most?', 'Settle up', 'How much did I spend on food this month?'];

/** A field that wiggles when the agent is unsure about it. */
function Wiggle({ on, children }: { on: boolean; children: React.ReactNode }) {
  const r = useSharedValue(0);
  useEffect(() => {
    r.value = on ? withRepeat(withSequence(withTiming(-2.5, { duration: 90 }), withTiming(2.5, { duration: 90 })), 6, true) : withTiming(0);
  }, [on]);
  const a = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={[a, on && { backgroundColor: colors.amberSoft, borderRadius: 10, paddingHorizontal: 6 }]}>{children}</Animated.View>;
}

export default function Assistant() {
  const params = useLocalSearchParams<{ group?: string; text?: string; nudge?: string }>();
  const insets = useSafeAreaInsets();
  const groups = useGroups();
  const [groupId, setGroupId] = useState<string | undefined>(params.group);
  const group = useGroup(groupId);
  const members = group.data?.members ?? [];
  const [text, setText] = useState(params.text ?? '');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<{ agent: string; label: string } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [source, setSource] = useState<'text' | 'voice'>('text');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);
  const cancel = useRef<(() => void) | null>(null);
  const lastText = useRef('');
  const showToast = useStore((s) => s.showToast);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const run = (message: string, gid = groupId, via = source) => {
    const msg = message.trim();
    if (!msg || busy) return;
    lastText.current = msg;
    setBusy(true);
    setResult(null);
    setError(null);
    setStep({ agent: 'orchestrator', label: 'Thinking' });
    let queue = Promise.resolve();
    cancel.current = streamDraft({ text: msg, group_id: gid ?? null, source: via }, (e: AgentEvent) => {
      // Give each step a moment on screen so the mascot's acting is readable.
      queue = queue.then(() => new Promise<void>((resolve) => {
        if (e.type === 'step') {
          setStep({ agent: e.agent, label: e.label });
          haptic.tick();
          setTimeout(resolve, 520);
        } else {
          setBusy(false);
          setStep(null);
          if (e.type === 'error') { setError(e.message); haptic.error(); } else { setResult(e.data); haptic.bump(); }
          resolve();
        }
      }));
    });
  };

  const loadNudge = async (memberId: string, tone = 'polite', language = 'en') => {
    setBusy(true);
    setError(null);
    setStep({ agent: 'nudge_writer', label: 'Writing a friendly reminder' });
    try {
      const r = await api('/agent/nudge', { body: { group_id: groupId, member_id: memberId, tone, language } });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not write that');
    } finally {
      setBusy(false);
      setStep(null);
    }
  };

  useEffect(() => {
    if (params.nudge && groupId) loadNudge(params.nudge);
    else if (params.text) run(params.text);
    return () => cancel.current?.();
  }, []);

  // ---- voice: on-device speech-to-text, so no audio ever leaves the phone through Fin ----
  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results[0]?.transcript ?? '';
    setText(t);
    if (e.isFinal && t) { setListening(false); setSource('voice'); run(t, groupId, 'voice'); }
  });
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('error', () => { setListening(false); });
  const mic = async () => {
    if (listening) return ExpoSpeechRecognitionModule.stop();
    try {
      const p = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!p.granted) return showToast('Allow the microphone to speak an expense', 'warn');
      haptic.bump();
      setText('');
      setListening(true);
      ExpoSpeechRecognitionModule.start({ lang: 'en-IN', interimResults: true, continuous: false });
    } catch {
      setListening(false);
      showToast("Voice isn't available on this phone", 'warn');
    }
  };

  const confirmExpense = async (d: Draft) => {
    setSaving(true);
    try {
      const payers = Object.fromEntries(Object.entries(d.payers).map(([k, v]) => [k, v ?? d.amount_paise]));
      await api('/agent/confirm', { body: { draft_id: d.draft_id, expense: { description: d.description, amount_paise: d.amount_paise, category: d.category, split_type: d.split_type, payers, member_ids: d.member_ids, exact: (d as any).exact, weights: (d as any).weights, percents: (d as any).percents } } });
      haptic.success();
      setDone(Date.now());
      await refreshAll();
      setTimeout(close, 1100);
    } catch (e) {
      haptic.error();
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
      setSaving(false);
    }
  };

  const act = step ? ACT[step.agent] ?? ACT.orchestrator : null;
  const mood: Mood = done ? 'cheer' : error ? 'worried' : listening ? 'excited' : act ? act.mood : result?.kind === 'question' ? 'idle' : result ? 'happy' : 'idle';
  const speech = done ? 'Saved!' : error ? error : listening ? "I'm listening…" : step ? step.label : result?.kind === 'question' ? result.question : !result ? 'Tell me what happened' : undefined;
  const name = (id: string) => { const m = members.find((x) => x.id === id); return m ? (m.is_self ? 'You' : m.name.split(' ')[0]) : '?'; };
  const unsure = (field: string) => !!result?.questions?.some((q: any) => q.field === field);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Animated.View entering={FadeIn.duration(180)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.dim }]}>
        <Pressable style={{ flex: 1 }} onPress={close} accessibilityLabel="Close" />
      </Animated.View>
      <Confetti fire={done} />
      <Animated.View entering={SlideInDown.springify().damping(18)} style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <View style={{ alignItems: 'center', height: 150, justifyContent: 'flex-end' }}>
          <Chillar size={96} mood={mood} prop={act?.prop ?? 'none'} speech={speech} hopKey={step?.agent} />
        </View>
        {busy ? <View style={{ alignItems: 'center', marginTop: 8 }}><Dots /></View> : null}

        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, gap: 10 }}>
          {/* expense draft */}
          {result?.kind === 'expense' ? (
            <Animated.View entering={FadeInDown.springify().damping(13)} layout={LinearTransition.springify()} style={styles.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ fontSize: 30 }}>{CATEGORY[result.category]?.emoji ?? '✨'}</Text>
                <View style={{ flex: 1 }}>
                  <T v="h3">{result.description}</T>
                  <T v="small" color={colors.inkSoft}>Paid by {Object.keys(result.payers).map(name).join(' & ')}</T>
                </View>
                <Wiggle on={unsure('amount')}><T v="h1" color={result.amount_paise ? colors.ink : colors.amber}>{result.amount_paise ? rupees(result.amount_paise) : '₹ ?'}</T></Wiggle>
              </View>
              <Wiggle on={unsure('people')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                  {result.member_ids.map((id: string) => (
                    <View key={id} style={{ alignItems: 'center', width: 54 }}>
                      <Avatar name={members.find((m) => m.id === id)?.name ?? '?'} index={members.findIndex((m) => m.id === id)} size={34} />
                      <T v="tiny" style={{ textTransform: 'none', letterSpacing: 0 }} color={colors.inkSoft}>{name(id)}</T>
                    </View>
                  ))}
                </View>
              </Wiggle>
              {result.questions.map((q: any, i: number) => (
                <Animated.View key={i} entering={FadeInDown.delay(150 + i * 80)} style={styles.question}>
                  <T v="small" w="semi">🤔 {q.question}</T>
                  {q.name ? (
                    <Btn small title={`Add ${q.name} to the group`} kind="soft" style={{ marginTop: 8 }} onPress={async () => {
                      try {
                        await api(`/groups/${result.group_id}/members`, { body: { name: q.name } });
                        await refreshAll();
                        run(lastText.current, result.group_id);
                      } catch (e) { showToast(e instanceof ApiError ? e.message : 'Could not add them', 'warn'); }
                    }} />
                  ) : null}
                </Animated.View>
              ))}
              <T v="tiny" color={colors.inkFaint} style={{ marginTop: 8 }}>{result.source === 'ai' ? '✨ Drafted by AI' : '⚡ Quick draft'} · nothing is saved until you confirm</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Btn small title="Edit" kind="soft" style={{ flex: 1 }} onPress={() => router.replace({ pathname: '/add-expense', params: { draft: JSON.stringify(result) } })} />
                {result.ready ? <Btn small title={`Split ${rupees(result.amount_paise)}`} style={{ flex: 1.4 }} loading={saving} onPress={() => confirmExpense(result)} /> : null}
              </View>
            </Animated.View>
          ) : null}

          {/* which group? */}
          {result?.kind === 'question' && result.field === 'group' ? (
            <Animated.View entering={FadeInDown.springify()} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(groups.data ?? []).map((g) => <Chip key={g.id} label={g.name} emoji={g.emoji} onPress={() => { setGroupId(g.id); run(lastText.current, g.id); }} />)}
              {groups.data?.length === 0 ? <Btn small title="Make a group first" onPress={() => router.replace('/group/new')} /> : null}
            </Animated.View>
          ) : null}

          {/* settle plan */}
          {result?.kind === 'settle_plan' ? (
            <Animated.View entering={FadeInDown.springify().damping(13)} style={styles.card}>
              <T v="h3">{result.summary}</T>
              {result.steps.slice(0, 4).map((s: any, i: number) => (
                <T key={i} v="small" color={colors.inkSoft} style={{ marginTop: 4 }}>{s.mine ? 'You' : s.from_name} → {s.to_name}: {rupees(s.amount_paise)}</T>
              ))}
              {result.steps.length ? <Btn small title="Start settling" style={{ marginTop: 12 }} onPress={() => router.replace({ pathname: '/settle', params: { group: result.group_id } })} /> : null}
            </Animated.View>
          ) : null}

          {/* nudge: a live preview bubble, with tone and language chips */}
          {result?.kind === 'nudge' ? (
            <Animated.View entering={FadeInDown.springify().damping(13)} style={{ gap: 10 }}>
              {result.ready ? (
                <>
                  <View style={[styles.card, { backgroundColor: colors.purpleSoft, borderBottomLeftRadius: 6 }]}><T>{result.message}</T></View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {(['polite', 'funny', 'firm'] as const).map((t) => <Chip key={t} label={t[0].toUpperCase() + t.slice(1)} active={result.tone === t} onPress={() => loadNudge(result.member_id, t, result.language)} />)}
                    {([['en', 'English'], ['hinglish', 'Hinglish'], ['hi', 'हिंदी'], ['te', 'తెలుగు']] as const).map(([k, l]) => <Chip key={k} label={l} active={result.language === k} onPress={() => loadNudge(result.member_id, result.tone, k)} />)}
                  </ScrollView>
                  <Btn title={`Send to ${result.member_name.split(' ')[0]}`} icon="💌" onPress={async () => {
                    try {
                      const r = await Share.share({ message: result.pay_link ? `${result.message}\n\nPay here: ${result.pay_link}` : result.message });
                      if (r.action !== Share.dismissedAction) { api('/agent/confirm', { body: { draft_id: result.draft_id } }).catch(() => {}); close(); }
                    } catch {}
                  }} />
                </>
              ) : <View style={styles.card}><T>{result.error}</T></View>}
            </Animated.View>
          ) : null}

          {/* answer, with the records it used */}
          {result?.kind === 'answer' ? (
            <Animated.View entering={FadeInDown.springify().damping(13)} style={styles.card}>
              <T v="h3">{result.answer}</T>
              {result.records?.slice(-1).map((r: any, i: number) => r.rows.length ? (
                <View key={i} style={{ marginTop: 10, gap: 4 }}>
                  <T v="tiny" color={colors.inkFaint}>From your records</T>
                  {r.rows.slice(0, 5).map((row: any[], j: number) => (
                    <View key={j} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      {row.map((c, k) => <T key={k} v="small" color={colors.inkSoft}>{typeof c === 'number' ? rupees(Math.round(c * 100)) : String(c)}</T>)}
                    </View>
                  ))}
                </View>
              ) : null)}
            </Animated.View>
          ) : null}

          {!result && !busy && !error ? (
            <Animated.View entering={FadeIn.delay(200)} exiting={FadeOut} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {EXAMPLES.map((ex) => <Chip key={ex} label={ex} onPress={() => { setText(ex); run(ex); }} />)}
            </Animated.View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <Press onPress={mic} style={[styles.round, listening && { backgroundColor: colors.pink }]} label={listening ? 'Stop listening' : 'Speak'}>
            <Text style={{ fontSize: 20 }}>{listening ? '⏹' : '🎙️'}</Text>
          </Press>
          <TextInput value={text} onChangeText={(v) => { setText(v); setSource('text'); }} placeholder="I paid 2400 for dinner, Rahul skipped drinks" placeholderTextColor={colors.inkFaint}
            style={styles.input} onSubmitEditing={() => run(text)} returnKeyType="send" maxLength={600} autoFocus={!params.text && !params.nudge} />
          <Press onPress={() => run(text)} style={[styles.round, { backgroundColor: colors.purple }]} disabled={!text.trim() || busy} label="Send">
            <Text style={{ fontSize: 18, color: '#fff', fontFamily: font.extra }}>↑</Text>
          </Press>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 18, paddingTop: 6 },
  card: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 16, ...shadow, shadowOpacity: 0.1 },
  question: { backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: 10, marginTop: 8 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  input: { flex: 1, height: 48, borderRadius: 24, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 15, color: colors.ink, borderWidth: 1.5, borderColor: colors.line },
  round: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center' },
});

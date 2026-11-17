/** Receipt scan: snap a bill, watch the scan beam, then drag items onto friends (or just say "Rahul skipped drinks"). */
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeInDown, LinearTransition, ZoomIn, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Mascot, Mood, Prop } from '@/components/Mascot';
import { Confetti, ScanBeam } from '@/components/fx';
import { Avatar, Btn, Chip, Press, Screen, T } from '@/components/ui';
import { ApiError, Draft, Item, api, appendFile } from '@/lib/api';
import { refreshAll, useGroup, useGroups } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { colorFor, colors, font, radius, shadow, spring } from '@/lib/theme';
import { allocate, haptic, rupees } from '@/lib/util';
import { t } from '@/lib/i18n';

type Rect = { x: number; y: number; w: number; h: number };

function DragItem({ item, index, everyone, colorsFor, onDrop, onReset }: { item: Item; index: number; everyone: boolean; colorsFor: number[]; onDrop: (x: number, y: number) => void; onReset: () => void }) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  const pan = Gesture.Pan()
    .activateAfterLongPress(140)
    .onStart(() => { lift.value = withSpring(1, spring.snappy); scheduleOnRN(haptic.bump); })
    .onUpdate((e) => { tx.value = e.translationX; ty.value = e.translationY; })
    .onEnd((e) => {
      scheduleOnRN(onDrop, e.absoluteX, e.absoluteY);
      tx.value = withSpring(0, spring.bouncy);
      ty.value = withSpring(0, spring.bouncy);
      lift.value = withSpring(0, spring.gentle);
    });
  const a = useAnimatedStyle(() => ({
    zIndex: lift.value > 0 ? 20 : 0,
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lift.value * 0.08 }, { rotate: `${lift.value * -3}deg` }],
    shadowOpacity: 0.08 + lift.value * 0.25,
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View entering={ZoomIn.delay(index * 90).springify().damping(11)} style={[styles.item, a]}>
        <Press onPress={onReset} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} label={item.name}>
          <View style={{ flex: 1 }}>
            <T w="semi" numberOfLines={1}>{item.name}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
              {everyone ? <T v="small" color={colors.inkFaint}>{t("Everyone · hold and drag to a friend")}</T> : colorsFor.map((c) => <View key={c} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(c) }} />)}
            </View>
          </View>
          <T v="h3">{rupees(item.amount_paise)}</T>
        </Press>
      </Animated.View>
    </GestureDetector>
  );
}

export default function Scan() {
  const params = useLocalSearchParams<{ group?: string }>();
  const groups = useGroups();
  const [groupId, setGroupId] = useState(params.group);
  useEffect(() => { if (!groupId && groups.data?.[0]) setGroupId(groups.data[0].id); }, [groups.data]);
  const group = useGroup(groupId);
  const members = (group.data?.members ?? []).filter((m) => m.active);
  const me = members.find((m) => m.is_self);
  const [photo, setPhoto] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rule, setRule] = useState('');
  const [advice, setAdvice] = useState<string | null>(null);
  const [advising, setAdvising] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);
  const [hop, setHop] = useState<Record<string, number>>({});
  const rects = useRef<Record<string, Rect>>({});
  const refs = useRef<Record<string, any>>({});
  const showToast = useStore((s) => s.showToast);
  const all = members.map((m) => m.id);

  const pick = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : { granted: true };
    if (!perm.granted) return showToast('Allow the camera to scan a bill', 'warn');
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, allowsEditing: false };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets[0]) return;
    const asset = r.assets[0];
    setPhoto(asset.uri);
    setScanning(true);
    setError(null);
    setDraft(null);
    try {
      const form = new FormData();
      form.append('group_id', groupId!);
      await appendFile(form, 'image', { uri: asset.uri, name: 'bill.jpg', type: asset.mimeType ?? 'image/jpeg' });
      const d: Draft = await api('/agent/receipt', { form });
      if (d.error || !d.items?.length) { setError(d.error ?? "I couldn't read that bill."); haptic.warn(); } else { setDraft(d); setItems(d.items); haptic.success(); }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read the bill');
    } finally {
      setScanning(false);
    }
  };

  const measure = () => {
    for (const id of all) refs.current[id]?.measureInWindow?.((x: number, y: number, w: number, h: number) => { rects.current[id] = { x, y, w, h }; });
  };
  const drop = (i: number, x: number, y: number) => {
    const hit = all.find((id) => { const r = rects.current[id]; return r && x >= r.x - 8 && x <= r.x + r.w + 8 && y >= r.y - 12 && y <= r.y + r.h + 12; });
    if (!hit) return;
    haptic.thunk();
    setHop({ ...hop, [hit]: Date.now() });
    setItems((prev) => prev.map((it, k) => {
      if (k !== i) return it;
      const cur = it.member_ids.length ? it.member_ids : [];
      return { ...it, member_ids: cur.includes(hit) ? cur.filter((m) => m !== hit) : [...cur, hit] };
    }));
  };

  const applyRule = async () => {
    if (!rule.trim() || !groupId) return;
    setAdvising(true);
    setAdvice(null);
    try {
      const r = await api('/agent/split-advice', { body: { group_id: groupId, items, rule } });
      setItems(r.items.map((it: Item) => ({ ...it, member_ids: it.member_ids.length === all.length ? [] : it.member_ids })));
      setAdvice(r.question ?? r.explanation);
      if (!r.question) { setRule(''); haptic.success(); } else haptic.warn();
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t("Try again"), 'warn');
    } finally {
      setAdvising(false);
    }
  };

  // Same maths as the server: items split equally among who shares them, tax and tip in proportion.
  const total = draft?.amount_paise ?? 0;
  const perPerson = useMemo(() => {
    const out: Record<string, number> = Object.fromEntries(all.map((id) => [id, 0]));
    let sum = 0;
    for (const it of items) {
      const who = it.member_ids.length ? it.member_ids : all;
      allocate(it.amount_paise, who.map(() => 1)).forEach((a, k) => { out[who[k]] = (out[who[k]] ?? 0) + a; });
      sum += it.amount_paise;
    }
    const extra = total - sum;
    if (extra && sum > 0) allocate(Math.abs(extra), all.map((id) => out[id])).forEach((a, k) => { out[all[k]] += extra > 0 ? a : -a; });
    return out;
  }, [items, total, all.join()]);

  const save = async () => {
    if (!draft || !me) return;
    setSaving(true);
    try {
      await api('/agent/confirm', { body: { draft_id: draft.draft_id, expense: {
        description: draft.description, amount_paise: total, category: 'food', split_type: 'itemised', payers: { [me.id]: total },
        items: items.map((it) => ({ ...it, member_ids: it.member_ids.length ? it.member_ids : all })),
      } } });
      setDone(Date.now());
      haptic.success();
      await refreshAll();
      setTimeout(() => router.replace(`/group/${groupId}`), 1200);
    } catch (e) {
      haptic.error();
      showToast(e instanceof ApiError ? e.message : 'Could not save', 'warn');
      setSaving(false);
    }
  };

  const mood: Mood = done ? 'cheer' : error ? 'worried' : scanning ? 'idle' : advising ? 'thinking' : draft ? 'happy' : 'idle';
  const prop: Prop = scanning ? 'glasses' : advising ? 'calculator' : 'none';
  const conflict = draft?.questions.find((q) => q.options_paise);

  return (
    <Screen title={t("Scan a bill")}>
      <Confetti fire={done} />
      {!draft ? (
        <View style={{ flex: 1, gap: 16, paddingBottom: 24 }}>
          {(groups.data?.length ?? 0) > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8 }}>
              {groups.data!.map((g) => <Chip key={g.id} label={g.name} emoji={g.emoji} active={g.id === groupId} onPress={() => setGroupId(g.id)} />)}
            </ScrollView>
          ) : null}
          <View style={styles.viewfinder}>
            {photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={scanning ? 3 : 0} /> : (
              <View style={{ alignItems: 'center', gap: 8 }}><Text style={{ fontSize: 54 }}>🧾</Text><T color={colors.inkSoft} center>Snap a restaurant bill and{'\n'}Fin reads every item.</T></View>
            )}
            <ScanBeam height={360} active={scanning} />
            {['tl', 'tr', 'bl', 'br'].map((c) => <View key={c} style={[styles.corner, c[0] === 't' ? { top: 14 } : { bottom: 14 }, c[1] === 'l' ? { left: 14 } : { right: 14 }]} />)}
          </View>
          <View style={{ alignItems: 'center' }}>
            <Mascot size={90} mood={mood} prop={prop} speech={scanning ? t("Reading the bill…") : error ?? undefined} />
          </View>
          <View style={{ flex: 1 }} />
          <Btn title={t("Take a photo")} icon="📸" onPress={() => pick(true)} disabled={scanning || !groupId} />
          <Btn title={t("Choose from gallery")} kind="soft" onPress={() => pick(false)} disabled={scanning || !groupId} />
          <T v="small" color={colors.inkFaint} center>{t("The photo is read once and never stored.")}</T>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 16 }} keyboardShouldPersistTaps="handled" onScrollEndDrag={measure}>
            <Animated.View entering={FadeIn} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Mascot size={58} mood={mood} prop={prop} />
              <View style={{ flex: 1 }}>
                <T v="h3">{draft.description}</T>
                <T v="small" color={colors.inkSoft}>{items.length} items · total {rupees(total)}{draft.tax_paise ? ` · incl. ${rupees(draft.tax_paise + (draft.tip_paise ?? 0))} tax & tip` : ''}</T>
              </View>
            </Animated.View>
            {conflict ? (
              <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: 12, gap: 8 }}>
                <T v="small" w="semi">🤔 {conflict.question}</T>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {conflict.options_paise!.map((o) => <Chip key={o} label={rupees(o)} active={o === total} onPress={() => setDraft({ ...draft, amount_paise: o })} />)}
                </View>
              </View>
            ) : null}
            {items.map((it, i) => (
              <DragItem key={i} item={it} index={i} everyone={!it.member_ids.length} colorsFor={it.member_ids.map((id) => all.indexOf(id))}
                onDrop={(x, y) => drop(i, x, y)} onReset={() => { haptic.tick(); setItems(items.map((p, k) => (k === i ? { ...p, member_ids: [] } : p))); }} />
            ))}
            <Animated.View layout={LinearTransition.springify()} style={{ gap: 8, marginTop: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TextInput value={rule} onChangeText={setRule} placeholder={t("Or say it: “Rahul skipped drinks”")} placeholderTextColor={colors.inkFaint} style={styles.rule} onSubmitEditing={applyRule} returnKeyType="done" maxLength={200} />
                <Btn small title={t("Apply")} kind="soft" onPress={applyRule} loading={advising} />
              </View>
              {advice ? <Animated.View entering={FadeInDown}><T v="small" color={colors.purple} w="semi">✨ {advice}</T></Animated.View> : null}
            </Animated.View>
          </ScrollView>
          {/* drop targets */}
          <View style={styles.tray} onLayout={measure}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }} onScrollEndDrag={measure} onMomentumScrollEnd={measure}>
              {members.map((m, i) => (
                <View key={m.id} ref={(r) => { refs.current[m.id] = r; }} collapsable={false} style={{ alignItems: 'center', width: 66 }} onLayout={measure}>
                  <Avatar name={m.name} index={i} size={44} wiggleKey={hop[m.id]} />
                  <T v="tiny" numberOfLines={1} style={{ textTransform: 'none', letterSpacing: 0 }}>{m.is_self ? t("You") : m.name.split(' ')[0]}</T>
                  <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: colorFor(i) }}>{rupees(perPerson[m.id] ?? 0)}</Text>
                </View>
              ))}
            </ScrollView>
            <Btn title={done ? 'Sliced! 🍕' : `Split ${rupees(total)}`} onPress={save} loading={saving && !done} disabled={!!done} style={{ marginTop: 10 }} />
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: { height: 360, borderRadius: radius.xl, backgroundColor: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', ...shadow, shadowOpacity: 0.1 },
  corner: { position: 'absolute', width: 26, height: 26, borderColor: colors.pink, borderWidth: 3, borderRadius: 8, opacity: 0.8 },
  item: { backgroundColor: '#fff', borderRadius: radius.md, padding: 14, ...shadow, shadowOpacity: 0.08, elevation: 2 },
  rule: { flex: 1, height: 42, borderRadius: 21, backgroundColor: '#fff', paddingHorizontal: 16, fontFamily: font.medium, fontSize: 14, color: colors.ink, borderWidth: 1.5, borderColor: colors.line },
  tray: { paddingTop: 12, paddingBottom: 16, borderTopWidth: 1.5, borderTopColor: colors.line, backgroundColor: colors.bg },
});

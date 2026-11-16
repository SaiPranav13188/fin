/** Make a group: friends spring into seats around a table, and Fin holds a sign that flips as you type. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { ZoomIn, ZoomOut, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { Mascot } from '@/components/Mascot';
import { Avatar, Btn, Chip, Field, Press, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { refreshAll } from '@/lib/hooks';
import { useStore } from '@/lib/store';
import { colors, font, radius, shadow, spring } from '@/lib/theme';
import { haptic } from '@/lib/util';
import { t } from '@/lib/i18n';

const EMOJIS = ['🍕', '🏠', '🏖️', '🎉', '🚗', '🎬', '🏏', '🍻', '🎓', '💼'];
const FUN_NAMES = ['Paisa Vasool Gang', 'The Bill Busters', 'Chai Sutta Squad', 'Udhaar Club', 'Flat 302 Legends', 'Goa Plan (Finally)', 'Split Happens', 'Hisaab Barabar', 'Maggi at Midnight', 'No Free Lunch'];
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

type Friend = { name: string; upi_id: string | null };

export default function NewGroup() {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🍕');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [fname, setFname] = useState('');
  const [fupi, setFupi] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useStore((s) => s.showToast);
  const flip = useSharedValue(0);

  // The sign flips in 3D each time the name changes.
  useEffect(() => {
    flip.value = withSequence(withTiming(90, { duration: 90 }), withSpring(0, spring.bouncy));
  }, [name]);
  const sign = useAnimatedStyle(() => ({ transform: [{ perspective: 600 }, { rotateX: `${flip.value}deg` }] }));

  const upiBad = fupi.trim() !== '' && !UPI_RE.test(fupi.trim());
  const addFriend = () => {
    const n = fname.trim();
    if (!n || upiBad) return haptic.warn();
    if (friends.some((f) => f.name.toLowerCase() === n.toLowerCase())) return showToast(`${n} is already here`, 'warn');
    haptic.bump();
    setFriends([...friends, { name: n, upi_id: fupi.trim().toLowerCase() || null }]);
    setFname('');
    setFupi('');
  };

  const create = async () => {
    if (!name.trim()) return showToast('Give your group a name', 'warn');
    setBusy(true);
    try {
      const g = await api('/groups', { body: { name: name.trim(), emoji, members: friends } });
      haptic.success();
      await refreshAll();
      router.replace(`/group/${g.id}`);
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : t("Try again"), 'warn');
    } finally {
      setBusy(false);
    }
  };

  const seats = [{ name: 'You' }, ...friends];
  const R = 104;
  return (
    <Screen title={t("New group")}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 30 }}>
          {/* the huddle */}
          <View style={{ height: 270, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 150, height: 150, borderRadius: 75, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center', borderWidth: 6, borderColor: '#fff', ...shadow }}>
              <Text style={{ fontSize: 46 }}>{emoji}</Text>
            </View>
            {seats.map((s, i) => {
              const a = -Math.PI / 2 + (i / Math.max(seats.length, 5)) * Math.PI * 2;
              return (
                <Animated.View key={s.name} entering={ZoomIn.springify().damping(9)} exiting={ZoomOut}
                  style={{ position: 'absolute', left: '50%', top: '50%', marginLeft: Math.cos(a) * R - 26, marginTop: Math.sin(a) * R - 26, alignItems: 'center' }}>
                  <Press onLongPress={i ? () => { haptic.warn(); setFriends(friends.filter((f) => f.name !== s.name)); } : undefined} label={s.name}>
                    <Avatar name={s.name} index={i} size={44} />
                  </Press>
                </Animated.View>
              );
            })}
          </View>

          {/* Fin's sign */}
          <View style={{ alignItems: 'center', marginTop: -6 }}>
            <Animated.View style={[{ backgroundColor: '#fff', borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 10, borderWidth: 2.5, borderColor: colors.ink, minWidth: 190, alignItems: 'center' }, sign]}>
              <Text numberOfLines={1} style={{ fontFamily: font.extra, fontSize: 17, color: name ? colors.ink : colors.inkFaint }}>{name || t("Name me!")}</Text>
            </Animated.View>
            <View style={{ width: 4, height: 14, backgroundColor: colors.ink }} />
            <View style={{ marginTop: -8 }}><Mascot size={72} mood={friends.length ? 'happy' : 'idle'} hopKey={friends.length} /></View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Field label={t("Group name")} value={name} onChangeText={setName} placeholder="Goa trip" maxLength={60} /></View>
            <Press onPress={() => { haptic.bump(); setName(FUN_NAMES[Math.floor(Math.random() * FUN_NAMES.length)]); }} style={{ width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }} label="Roll a fun name">
              <Text style={{ fontSize: 24 }}>🎲</Text>
            </Press>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {EMOJIS.map((e) => <Chip key={e} label={e} active={e === emoji} onPress={() => setEmoji(e)} />)}
          </ScrollView>

          <T v="h3" style={{ marginTop: 6 }}>{t("Add friends")}</T>
          <T v="small" color={colors.inkSoft} style={{ marginTop: -10 }}>{t("They don't need the app. Long-press a face to remove it.")}</T>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <TextInput value={fname} onChangeText={setFname} placeholder={t("Name")} placeholderTextColor={colors.inkFaint} onSubmitEditing={addFriend} returnKeyType="done" maxLength={40}
                style={{ height: 54, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#FBF6FD', paddingHorizontal: 16, fontFamily: font.semi, fontSize: 15.5, color: colors.ink }} />
            </View>
            <Btn title={t("Add")} kind="soft" onPress={addFriend} />
          </View>
          <Field value={fupi} onChangeText={setFupi} placeholder={t("Their UPI ID (optional)")} autoCapitalize="none" error={upiBad ? "That doesn't look like a UPI ID" : null} />
          {fupi.trim() && !upiBad ? (
            <View style={{ backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 20 }}>🛡️</Text>
              <T v="small" style={{ flex: 1 }}>{t("Fin can't verify this UPI ID. Check the name in your UPI app the first time you pay.")}</T>
            </View>
          ) : null}
          <Btn title={t("Create group")} onPress={create} loading={busy} style={{ marginTop: 8 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

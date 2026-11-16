/** Opened from an invite link (fin://join/<token>). Lets you claim the spot a friend already made for you. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { Chillar } from '@/components/Chillar';
import { Avatar, Btn, Press, Screen, T } from '@/components/ui';
import { ApiError, api } from '@/lib/api';
import { refreshAll } from '@/lib/hooks';
import { colors } from '@/lib/theme';
import { haptic } from '@/lib/util';

export default function Join() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [info, setInfo] = useState<{ name: string; emoji: string; claimable: { id: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/join/${token}/preview`).then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : 'This link did not work.'));
  }, [token]);

  const join = async () => {
    setBusy(true);
    try {
      const g = await api(`/join/${token}${claim ? `?claim_member_id=${claim}` : ''}`, { method: 'POST' });
      haptic.success();
      await refreshAll();
      router.replace(`/group/${g.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not join');
      setBusy(false);
    }
  };

  return (
    <Screen title="Join group">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingBottom: 40 }}>
        <Chillar size={130} mood={error ? 'worried' : info ? 'excited' : 'thinking'} speech={error ?? (info ? "You're invited!" : 'Checking the link…')} />
        {info ? (
          <>
            <Text style={{ fontSize: 48 }}>{info.emoji}</Text>
            <T v="h1" center>{info.name}</T>
            {info.claimable.length ? (
              <>
                <T color={colors.inkSoft} center>Did a friend already add you? Tap your name.</T>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
                  {info.claimable.map((m, i) => (
                    <Press key={m.id} onPress={() => setClaim(claim === m.id ? null : m.id)} label={m.name}>
                      <View style={{ alignItems: 'center', width: 70 }}><Avatar name={m.name} index={i} size={46} selected={claim === m.id} /><T v="small" numberOfLines={1}>{m.name}</T></View>
                    </Press>
                  ))}
                </View>
              </>
            ) : null}
            <Btn title={claim ? "That's me, join" : 'Join as a new member'} onPress={join} loading={busy} style={{ alignSelf: 'stretch', marginTop: 10 }} />
          </>
        ) : null}
        {error ? <Btn title="Go home" kind="soft" onPress={() => router.replace('/home')} /> : null}
      </View>
    </Screen>
  );
}

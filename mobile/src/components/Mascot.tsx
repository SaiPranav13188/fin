/**
 * Fin's mascot: a round coin with a sprout on top. Users know it simply as Fin.
 * One canonical character file, reused on every screen. All motion runs on the UI thread.
 */
import React, { useEffect, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  SharedValue, cancelAnimation, interpolate, useAnimatedProps, useAnimatedStyle, useDerivedValue, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { useStore } from '@/lib/store';
import { colors, font, spring } from '@/lib/theme';

export type Mood = 'idle' | 'happy' | 'sleepy' | 'worried' | 'covering' | 'thinking' | 'cheer' | 'excited' | 'proud';
export type Prop = 'none' | 'glasses' | 'calculator' | 'magnifier' | 'letter' | 'tea' | 'umbrella' | 'coin' | 'sign';

const AEllipse = Animated.createAnimatedComponent(Ellipse);
const ACircle = Animated.createAnimatedComponent(Circle);

const PROP_EMOJI: Partial<Record<Prop, string>> = {
  calculator: '🧮', magnifier: '🔍', letter: '💌', tea: '☕', umbrella: '☂️', coin: '🪙',
};

type Props = {
  size?: number;
  mood?: Mood;
  prop?: Prop;
  /** -1..1 where the eyes should look. Drive these from a gesture or the gyroscope. */
  lookX?: SharedValue<number>;
  lookY?: SharedValue<number>;
  /** Bumped by the parent to make Fin hop (e.g. when a card changes). */
  hopKey?: number | string;
  speech?: string;
};

export function Mascot({ size = 120, mood = 'idle', prop = 'none', lookX, lookY, hopKey, speech }: Props) {
  const reduce = useStore((s) => s.settings.reduceMotion);
  const outfit = useStore((s) => s.settings.outfit);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const blink = useSharedValue(1); // eyelid: 1 open, 0 shut
  const breathe = useSharedValue(0);
  const squash = useSharedValue(0); // jelly squash-and-stretch
  const hop = useSharedValue(0);
  const tilt = useSharedValue(0);
  const paws = useSharedValue(0); // 0 down, 1 over the eyes
  const propPop = useSharedValue(0);
  const zzz = useSharedValue(0);
  const zeroX = useSharedValue(0);
  const zeroY = useSharedValue(0);
  const lx = lookX ?? zeroX;
  const ly = lookY ?? zeroY;

  // Breathing and idle fidgets. Random timing means it never loops the same way twice.
  useEffect(() => {
    if (reduce) return;
    breathe.value = withRepeat(withTiming(1, { duration: mood === 'sleepy' ? 2400 : 1700 }), -1, true);
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const fidget = () => {
      if (!alive) return;
      const r = Math.random();
      if (mood !== 'sleepy' && mood !== 'covering') {
        const shut = withTiming(0, { duration: 70 });
        const open = withTiming(1, { duration: 110 });
        blink.value = r < 0.25 ? withSequence(shut, open, shut, open) : withSequence(shut, open);
        if (r > 0.7) tilt.value = withSequence(withSpring((Math.random() - 0.5) * 10, spring.bouncy), withDelay(500, withSpring(0, spring.gentle)));
      }
      timer = setTimeout(fidget, 1800 + Math.random() * 3200);
    };
    timer = setTimeout(fidget, 900 + Math.random() * 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
      cancelAnimation(breathe);
    };
  }, [mood, reduce]);

  // Mood changes: a jelly squash, then the mood's own motion.
  useEffect(() => {
    paws.value = withSpring(mood === 'covering' ? 1 : 0, spring.snappy);
    blink.value = withTiming(mood === 'sleepy' ? 0.12 : 1, { duration: 200 });
    if (reduce) return;
    squash.value = withSequence(withTiming(1, { duration: 90 }), withSpring(0, spring.jelly));
    cancelAnimation(hop);
    if (mood === 'cheer' || mood === 'excited') {
      hop.value = withRepeat(withSequence(withSpring(-size * 0.16, spring.snappy), withSpring(0, spring.bouncy)), mood === 'cheer' ? 4 : -1);
    } else if (mood === 'thinking') {
      hop.value = withRepeat(withSequence(withTiming(-3, { duration: 600 }), withTiming(0, { duration: 600 })), -1);
    } else {
      hop.value = withSpring(0, spring.gentle);
    }
    zzz.value = mood === 'sleepy' ? withRepeat(withTiming(1, { duration: 2600 }), -1) : 0;
  }, [mood, reduce]);

  useEffect(() => {
    if (hopKey === undefined || reduce) return;
    hop.value = withSequence(withSpring(-size * 0.14, spring.snappy), withSpring(0, spring.bouncy));
    squash.value = withSequence(withTiming(0.8, { duration: 80 }), withSpring(0, spring.jelly));
  }, [hopKey]);

  useEffect(() => {
    propPop.value = 0;
    if (prop !== 'none') propPop.value = withSpring(1, spring.bouncy);
  }, [prop]);

  const bodyStyle = useAnimatedStyle(() => {
    const b = interpolate(breathe.value, [0, 1], [0, 0.025]);
    return {
      transform: [
        { translateY: hop.value },
        { rotate: `${tilt.value}deg` },
        { scaleX: 1 + squash.value * 0.12 + b },
        { scaleY: 1 - squash.value * 0.12 - b * 0.6 },
      ],
    };
  });
  const shadowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(hop.value, [-size * 0.16, 0], [0.05, 0.14]),
    transform: [{ scaleX: interpolate(hop.value, [-size * 0.16, 0], [0.7, 1]) }],
  }));

  // Pupils follow touch / tilt. "thinking" looks up; "worried" darts a little.
  const px = useDerivedValue(() => (mood === 'thinking' ? 2 : Math.max(-1, Math.min(1, lx.value)) * 4.2));
  const py = useDerivedValue(() => (mood === 'thinking' ? -4 : Math.max(-1, Math.min(1, ly.value)) * 3.4));
  const pupilR = mood === 'worried' ? 3.2 : mood === 'excited' ? 5.6 : 4.6;
  const eyeL = useAnimatedProps(() => ({ ry: 8.5 * blink.value + 0.6 }));
  const pupilL = useAnimatedProps(() => ({ cx: 44 + px.value, cy: 62 + py.value, opacity: blink.value > 0.4 ? 1 : 0 }));
  const pupilRp = useAnimatedProps(() => ({ cx: 76 + px.value, cy: 62 + py.value, opacity: blink.value > 0.4 ? 1 : 0 }));
  const pawL = useAnimatedProps(() => ({ cx: interpolate(paws.value, [0, 1], [22, 44]), cy: interpolate(paws.value, [0, 1], [86, 62]) }));
  const pawR = useAnimatedProps(() => ({ cx: interpolate(paws.value, [0, 1], [98, 76]), cy: interpolate(paws.value, [0, 1], [86, 62]) }));

  const propStyle = useAnimatedStyle(() => ({
    opacity: propPop.value,
    transform: [{ scale: propPop.value }, { rotate: `${interpolate(propPop.value, [0, 1], [-40, 0])}deg` }],
  }));
  const z1 = useAnimatedStyle(() => ({
    opacity: interpolate(zzz.value, [0, 0.2, 0.8, 1], [0, 1, 1, 0]),
    transform: [{ translateY: -zzz.value * size * 0.35 }, { translateX: zzz.value * size * 0.12 }, { scale: 0.7 + zzz.value * 0.6 }],
  }));

  const arcEyes = mood === 'happy' || mood === 'cheer' || mood === 'proud';
  const mouth =
    mood === 'happy' || mood === 'cheer' || mood === 'proud' ? <Path d="M48 78 Q60 92 72 78 Q60 84 48 78 Z" fill="#8A4B12" />
    : mood === 'excited' || mood === 'thinking' ? <Ellipse cx={60} cy={81} rx={4.5} ry={5.5} fill="#8A4B12" />
    : mood === 'worried' ? <Path d="M50 83 Q55 78 60 83 Q65 88 70 83" stroke="#8A4B12" strokeWidth={2.6} fill="none" strokeLinecap="round" />
    : mood === 'sleepy' ? <Ellipse cx={60} cy={81} rx={3} ry={2.4} fill="#8A4B12" />
    : mood === 'covering' ? <Path d="M53 82 Q60 87 67 82" stroke="#8A4B12" strokeWidth={2.6} fill="none" strokeLinecap="round" />
    : <Path d="M51 79 Q60 88 69 79" stroke="#8A4B12" strokeWidth={2.8} fill="none" strokeLinecap="round" />;

  return (
    <View style={{ width: size, height: size * 1.1, alignItems: 'center', justifyContent: 'flex-end' }} pointerEvents="none">
      {speech ? (
        <View style={[styles.bubble, { bottom: size * 1.08 }]}>
          <Text style={styles.bubbleText}>{speech}</Text>
        </View>
      ) : null}
      <Animated.View style={[styles.shadow, { width: size * 0.56, height: size * 0.07, borderRadius: size }, shadowStyle]} />
      <Animated.View style={[{ width: size, height: size * 1.08 }, bodyStyle]}>
        <Svg width={size} height={size * 1.08} viewBox="0 0 120 130">
          <Defs>
            <LinearGradient id={`coin${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFDD6B" />
              <Stop offset="1" stopColor={colors.coin} />
            </LinearGradient>
            <LinearGradient id={`leaf${uid}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#6BE3A8" />
              <Stop offset="1" stopColor={colors.mint} />
            </LinearGradient>
          </Defs>
          {/* sprout */}
          <Path d="M60 24 Q59 14 60 8" stroke="#12996D" strokeWidth={3} strokeLinecap="round" fill="none" />
          <Path d="M60 12 Q46 2 40 12 Q50 20 60 12 Z" fill={`url(#leaf${uid})`} />
          <Path d="M60 10 Q72 -2 82 8 Q72 18 60 10 Z" fill={`url(#leaf${uid})`} />
          {/* coin body */}
          <Circle cx={60} cy={72} r={50} fill={colors.coinDark} />
          <Circle cx={60} cy={69} r={50} fill={`url(#coin${uid})`} />
          <Circle cx={60} cy={69} r={41} fill="none" stroke="#FFE9A0" strokeWidth={2.5} opacity={0.9} />
          <Path d="M28 46 Q40 28 60 26" stroke="#FFF6CF" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.8} />
          {/* cheeks */}
          <Ellipse cx={32} cy={76} rx={7} ry={4.5} fill="#FF9EC4" opacity={0.75} />
          <Ellipse cx={88} cy={76} rx={7} ry={4.5} fill="#FF9EC4" opacity={0.75} />
          {/* eyes */}
          {arcEyes ? (
            <G>
              <Path d="M36 64 Q44 54 52 64" stroke="#3A2408" strokeWidth={3.6} fill="none" strokeLinecap="round" />
              <Path d="M68 64 Q76 54 84 64" stroke="#3A2408" strokeWidth={3.6} fill="none" strokeLinecap="round" />
            </G>
          ) : mood === 'sleepy' ? (
            <G>
              <Path d="M36 62 Q44 69 52 62" stroke="#3A2408" strokeWidth={3.4} fill="none" strokeLinecap="round" />
              <Path d="M68 62 Q76 69 84 62" stroke="#3A2408" strokeWidth={3.4} fill="none" strokeLinecap="round" />
            </G>
          ) : (
            <G>
              <AEllipse cx={44} cy={62} rx={8} fill="#fff" animatedProps={eyeL} />
              <AEllipse cx={76} cy={62} rx={8} fill="#fff" animatedProps={eyeL} />
              <ACircle r={pupilR} fill="#3A2408" animatedProps={pupilL} />
              <ACircle r={pupilR} fill="#3A2408" animatedProps={pupilRp} />
              {mood === 'worried' ? (
                <G>
                  <Path d="M36 50 L50 54" stroke="#3A2408" strokeWidth={3} strokeLinecap="round" />
                  <Path d="M84 50 L70 54" stroke="#3A2408" strokeWidth={3} strokeLinecap="round" />
                  <Path d="M94 44 Q98 52 94 56 Q90 52 94 44 Z" fill="#7CCBFF" />
                </G>
              ) : null}
            </G>
          )}
          {prop === 'glasses' ? (
            <G>
              <Rect x={32} y={52} width={24} height={20} rx={7} fill="rgba(255,255,255,0.35)" stroke="#3A2408" strokeWidth={3} />
              <Rect x={64} y={52} width={24} height={20} rx={7} fill="rgba(255,255,255,0.35)" stroke="#3A2408" strokeWidth={3} />
              <Path d="M56 60 L64 60" stroke="#3A2408" strokeWidth={3} />
            </G>
          ) : null}
          {mouth}
          {/* paws: rise to cover the eyes when Fin must not peek */}
          <ACircle r={9.5} fill="#FFD152" stroke={colors.coinDark} strokeWidth={2.4} animatedProps={pawL} />
          <ACircle r={9.5} fill="#FFD152" stroke={colors.coinDark} strokeWidth={2.4} animatedProps={pawR} />
          {/* outfits, unlocked by moments */}
          {outfit === 'cap' ? (
            <G>
              <Path d="M22 44 Q60 -2 98 44 Z" fill="#7B4DFF" />
              <Path d="M60 40 Q96 38 112 50 Q92 52 60 48 Z" fill="#5B34D6" />
              <Circle cx={60} cy={20} r={4} fill="#FFDD6B" />
            </G>
          ) : outfit === 'party' ? (
            <G>
              <Path d="M60 -6 L38 38 Q60 46 82 38 Z" fill="#FF6FB1" />
              <Path d="M49 16 L71 16 M44 27 L76 27" stroke="#FFF" strokeWidth={3} strokeLinecap="round" />
              <Circle cx={60} cy={-6} r={6} fill="#FFDD6B" />
            </G>
          ) : outfit === 'scarf' ? (
            <G>
              <Path d="M18 96 Q60 114 102 96 L100 108 Q60 126 20 108 Z" fill="#FF7A6B" />
              <Path d="M78 108 L88 128 L98 124 L90 104 Z" fill="#E85C4D" />
            </G>
          ) : null}
          {/* feet */}
          <Ellipse cx={46} cy={121} rx={9} ry={5} fill={colors.coinDark} />
          <Ellipse cx={74} cy={121} rx={9} ry={5} fill={colors.coinDark} />
        </Svg>
      </Animated.View>
      {PROP_EMOJI[prop] ? (
        <Animated.Text style={[{ position: 'absolute', right: -size * 0.04, bottom: size * 0.16, fontSize: size * 0.3 }, propStyle]}>
          {PROP_EMOJI[prop]}
        </Animated.Text>
      ) : null}
      {mood === 'sleepy' && !reduce ? (
        <Animated.Text style={[{ position: 'absolute', right: size * 0.05, top: size * 0.12, fontFamily: font.extra, color: colors.purple, fontSize: size * 0.16 }, z1]}>
          z
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: { position: 'absolute', bottom: 0, backgroundColor: '#5B3BB5' },
  bubble: {
    position: 'absolute', backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18,
    borderBottomLeftRadius: 6, maxWidth: 240, shadowColor: '#7B4DFF', shadowOpacity: 0.15, shadowRadius: 10, elevation: 4,
  },
  bubbleText: { fontFamily: font.semi, color: colors.ink, fontSize: 13.5, lineHeight: 19 },
});

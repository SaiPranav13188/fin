/** "TAP ME" curved over Fin's head on Home, so people know the mascot opens the actions. */
import React, { useEffect } from 'react';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText, TextPath } from 'react-native-svg';

import { useStore } from '@/lib/store';
import { colors, font } from '@/lib/theme';

const W = 170;
const H = 62;
// An arc that follows the top of the mascot's head.
const ARC = `M 14 ${H - 2} A 80 80 0 0 1 ${W - 14} ${H - 2}`;
const LABEL = '· TAP ME ·';

export function TapHint() {
  const reduce = useStore((s) => s.settings.reduceMotion);
  const bob = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    bob.value = withRepeat(withSequence(withTiming(-4, { duration: 900 }), withTiming(0, { duration: 900 })), -1);
  }, [reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: bob.value }] }));

  const text = (props: object) => (
    <SvgText fontFamily={font.extra} fontSize={15} letterSpacing={3} {...props}>
      <TextPath href="#tapArc" startOffset="50%" textAnchor="middle">{LABEL}</TextPath>
    </SvgText>
  );

  return (
    <Animated.View entering={FadeIn.duration(250)} exiting={FadeOut.duration(150)} style={[{ width: W, height: H, marginBottom: -22 }, style]} pointerEvents="none">
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          <LinearGradient id="tapGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.pink} />
            <Stop offset="1" stopColor={colors.purple} />
          </LinearGradient>
          <Path id="tapArc" d={ARC} fill="none" />
        </Defs>
        {/* white outline underneath keeps the letters readable over any background */}
        {text({ fill: '#fff', stroke: '#fff', strokeWidth: 4, strokeLinejoin: 'round' })}
        {text({ fill: 'url(#tapGrad)' })}
      </Svg>
    </Animated.View>
  );
}

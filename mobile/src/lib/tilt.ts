import { Accelerometer } from 'expo-sensors';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useSharedValue, withSpring } from 'react-native-reanimated';

import { useStore } from './store';
import { spring } from './theme';

/** Phone-aware motion: tilt (-1..1 on each axis) for parallax and for the mascot's eyes. Also detects a shake. */
export function useTilt(onShake?: () => void) {
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const reduce = useStore((s) => s.settings.reduceMotion);
  useEffect(() => {
    if (reduce || Platform.OS === 'web') return;
    let lastShake = 0;
    Accelerometer.setUpdateInterval(80);
    const sub = Accelerometer.addListener((a) => {
      x.value = withSpring(Math.max(-1, Math.min(1, a.x * 1.6)), spring.gentle);
      y.value = withSpring(Math.max(-1, Math.min(1, -(a.y + 0.55) * 1.6)), spring.gentle);
      const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
      if (onShake && g > 2.3 && Date.now() - lastShake > 1500) {
        lastShake = Date.now();
        onShake();
      }
    });
    return () => sub.remove();
  }, [reduce, onShake]);
  return { x, y };
}

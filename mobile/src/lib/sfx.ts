/** Tiny UI sounds. Off by default; the switch is in the profile. They follow the phone's silent mode. */
import { AudioPlayer, createAudioPlayer } from 'expo-audio';

import { useStore } from './store';

const SOURCES = {
  coin: require('../../assets/sfx/coin.wav'),
  slice: require('../../assets/sfx/slice.wav'),
  success: require('../../assets/sfx/success.wav'),
};
const players: Partial<Record<keyof typeof SOURCES, AudioPlayer>> = {};

function play(name: keyof typeof SOURCES) {
  if (!useStore.getState().settings.sound) return;
  try {
    const p = (players[name] ??= createAudioPlayer(SOURCES[name]));
    p.seekTo(0);
    p.play();
  } catch {
    // sound is decoration: never let it break a payment or a save
  }
}

export const sfx = { coin: () => play('coin'), slice: () => play('slice'), success: () => play('success') };

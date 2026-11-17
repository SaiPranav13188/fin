/** Push notifications: ask once, then send this phone's push address to the server. Fails quietly. */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let done = false;

export async function registerForPush() {
  if (done || Platform.OS === 'web') return;
  done = true;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Fin', importance: Notifications.AndroidImportance.DEFAULT, vibrationPattern: [0, 120, 80, 120], lightColor: '#FF6FB1',
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    await api('/auth/me', { method: 'PATCH', body: { push_token: token } });
  } catch {
    // Without Firebase set up on this build, Android can't hand out a push address. The app works without it.
    done = false;
  }
}

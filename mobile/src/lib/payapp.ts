/**
 * Opens a UPI payment in the user's UPI app and reads back the result.
 *
 * On Android the UPI app is started "for a result", the standard UPI intent flow: when the user comes
 * back, the app reports Status=SUCCESS / FAILURE / SUBMITTED. Fin uses that to record a payment
 * without asking. The UPI app can be the user's favourite (set in the profile) or Android's chooser.
 */
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

import { PayStatus, readUpiResponse } from './upi';
import { useStore } from './store';

export type UpiApp = 'ask' | 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'cred';
export const UPI_APPS: { key: UpiApp; label: string; pkg?: string }[] = [
  { key: 'ask', label: 'Ask every time' },
  { key: 'gpay', label: 'Google Pay', pkg: 'com.google.android.apps.nbu.paisa.user' },
  { key: 'phonepe', label: 'PhonePe', pkg: 'com.phonepe.app' },
  { key: 'paytm', label: 'Paytm', pkg: 'net.one97.paytm' },
  { key: 'bhim', label: 'BHIM', pkg: 'in.org.npci.upiapp' },
  { key: 'cred', label: 'CRED', pkg: 'com.dreamplug.androidapp' },
];

export type { PayStatus } from './upi';

export async function payWithUpi(link: string): Promise<PayStatus> {
  if (Platform.OS !== 'android') {
    try {
      await Linking.openURL(link);
      return 'unknown';
    } catch {
      return 'no_app';
    }
  }
  const pref = UPI_APPS.find((a) => a.key === useStore.getState().settings.upiApp);
  const attempts = pref?.pkg ? [pref.pkg, undefined] : [undefined]; // favourite app first, then the chooser
  for (const packageName of attempts) {
    try {
      const r = await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: link, ...(packageName ? { packageName } : {}) });
      return readUpiResponse(r.extra, r.data);
    } catch {
      // that app isn't installed: fall through to the chooser
    }
  }
  return 'no_app';
}

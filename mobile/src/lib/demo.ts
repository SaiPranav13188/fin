/** "Try the demo": a throwaway sample account from the server, so people can try Fin without signing up. */
import { api } from './api';
import { useStore } from './store';

export const isDemoEmail = (email?: string | null) => !!email?.endsWith('@demo.fin.invalid');

export async function startDemo() {
  const t = await api('/auth/demo', { method: 'POST', auth: false });
  useStore.getState().setSetting('onboarded', true);
  await useStore.getState().setTokens(t.access_token, t.refresh_token);
}

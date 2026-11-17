/** Crash reports (Sentry). Off unless EXPO_PUBLIC_SENTRY_DSN is set at build time. Never sends personal data. */
import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false, // no IP addresses, no user details
    tracesSampleRate: 0, // crashes only, so the free plan's quota lasts
    environment: __DEV__ ? 'development' : 'production',
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) delete event.request.headers.Authorization;
      }
      return event;
    },
    beforeBreadcrumb(b) {
      // network breadcrumbs can carry URLs with tokens (invite links, websockets): keep only the path
      if (b.data?.url && typeof b.data.url === 'string') b.data.url = b.data.url.split('?')[0];
      return b;
    },
  });
}

export const crashReportsOn = !!dsn;

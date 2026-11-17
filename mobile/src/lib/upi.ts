/** Reading UPI QR codes and building pay links. Pure functions, no UI. */
export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
export const UPI_MAX_PAISE = 100_000_00;

export type Payee = { pa: string; name: string; fixedPaise: number | null; params: [string, string][] };

/** Reads a UPI QR ("upi://pay?pa=...&pn=..."), or a bare UPI ID typed by hand. Returns null for anything else. */
export function parseUpi(raw: string): Payee | null {
  const text = raw.trim();
  if (UPI_RE.test(text)) return { pa: text.toLowerCase(), name: text.split('@')[0], fixedPaise: null, params: [['pa', text.toLowerCase()]] };
  const m = /^upi:\/\/pay\/?\?(.+)$/i.exec(text);
  if (!m) return null;
  const params: [string, string][] = [];
  for (const part of m[1].split('&')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    let value = part.slice(i + 1);
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {}
    params.push([part.slice(0, i).toLowerCase(), value]);
  }
  const get = (k: string) => params.find(([key]) => key === k)?.[1];
  const pa = get('pa')?.trim();
  if (!pa || !UPI_RE.test(pa)) return null;
  const am = parseFloat(get('am') ?? '');
  return { pa, name: (get('pn') ?? pa.split('@')[0]).slice(0, 60), fixedPaise: am > 0 ? Math.round(am * 100) : null, params };
}

/** Rebuilds the pay link. Every field from the QR is kept as it was, so a merchant's signed QR stays valid. */
export function buildLink(p: Payee, paise: number): string {
  const params = p.params.filter(([k]) => k !== 'cu' && (p.fixedPaise !== null || k !== 'am'));
  if (p.fixedPaise === null) params.push(['am', (paise / 100).toFixed(2)]);
  params.push(['cu', 'INR']);
  return 'upi://pay?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%40/g, '@')}`).join('&');
}

export type PayStatus = 'success' | 'failure' | 'submitted' | 'unknown' | 'no_app';

/** UPI apps answer with a query string like "txnId=..&responseCode=00&Status=SUCCESS&txnRef=..". */
export function readUpiResponse(extra: unknown, data?: string): PayStatus {
  const e = (extra ?? {}) as Record<string, unknown>;
  const raw = [e.response, e.Status, e.status, data].filter((v) => typeof v === 'string').join('&');
  const bare = [e.Status, e.status].find((v) => typeof v === 'string') as string | undefined; // some apps send just the word
  const status = (bare ?? /(?:^|&)status=([a-z]+)/i.exec(raw)?.[1])?.toLowerCase();
  if (status === 'success') return 'success';
  if (status === 'failure' || status === 'failed') return 'failure';
  if (status === 'submitted' || status === 'pending') return 'submitted';
  return 'unknown';
}

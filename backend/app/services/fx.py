"""Exchange rates to INR, from free public sources (ECB data via Frankfurter, with a backup). Cached for 6 hours."""
import json
import time
import urllib.request

CURRENCIES = ("USD", "EUR", "GBP", "AED", "SGD", "THB", "JPY", "AUD", "CAD", "MYR", "LKR", "NPR", "IDR", "VND", "CHF")
_cache: dict[str, tuple[float, float, str]] = {}  # currency -> (rate, fetched_at, date)
TTL = 6 * 3600


class FxError(Exception):
    pass


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "fin-app/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def rate_to_inr(currency: str) -> tuple[float, str]:
    """How many rupees one unit of `currency` buys, and the date of that rate."""
    currency = currency.upper()
    if currency == "INR":
        return 1.0, time.strftime("%Y-%m-%d")
    if currency not in CURRENCIES:
        raise FxError("That currency isn't supported yet")
    hit = _cache.get(currency)
    if hit and time.time() - hit[1] < TTL:
        return hit[0], hit[2]
    for fetch in (
        lambda: (lambda d: (d["rates"]["INR"], d["date"]))(_get(f"https://api.frankfurter.dev/v1/latest?base={currency}&symbols=INR")),
        lambda: (lambda d: (d["rates"]["INR"], time.strftime("%Y-%m-%d", time.gmtime(d["time_last_update_unix"]))))(_get(f"https://open.er-api.com/v6/latest/{currency}")),
    ):
        try:
            rate, date = fetch()
            rate = float(rate)
            if rate > 0:
                _cache[currency] = (rate, time.time(), date)
                return rate, date
        except Exception:
            continue
    if hit:  # stale is better than nothing
        return hit[0], hit[2]
    raise FxError("Couldn't get the exchange rate right now. Try again in a moment.")


def to_paise(minor_units: int, currency: str) -> tuple[int, float, str]:
    """Converts an amount in the currency's smallest unit (cents for USD; whole yen for JPY) to INR paise."""
    rate, date = rate_to_inr(currency)
    major = minor_units if currency.upper() in ("JPY", "IDR", "VND") else minor_units / 100
    return round(major * rate * 100), rate, date

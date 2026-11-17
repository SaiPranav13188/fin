"""Sends email through Brevo's API. Returns False instead of raising, so callers stay simple."""
import json
import logging
import urllib.request

from ..config import get_settings

log = logging.getLogger("fin.mail")


def mail_enabled() -> bool:
    s = get_settings()
    return bool(s.brevo_api_key and s.mail_from)


def send_mail(to: str, subject: str, text: str, html: str) -> bool:
    s = get_settings()
    if not mail_enabled():
        return False
    body = {"sender": {"name": s.mail_from_name, "email": s.mail_from}, "to": [{"email": to}],
            "subject": subject, "textContent": text, "htmlContent": html}
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(body).encode(), method="POST",
                                 headers={"api-key": s.brevo_api_key, "Content-Type": "application/json", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 200 <= r.status < 300
    except Exception as e:  # never leak the key or the address into logs
        log.warning("email send failed: %s", type(e).__name__)
        return False

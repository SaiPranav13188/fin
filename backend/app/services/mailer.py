"""Sends email over HTTPS through Mailjet (or Brevo). Render's free plan blocks normal email ports, so no SMTP.

Returns False instead of raising, so callers stay simple. Keys and addresses never go into logs.
"""
import base64
import json
import logging
import urllib.request

from ..config import get_settings

log = logging.getLogger("fin.mail")


def _provider() -> str | None:
    s = get_settings()
    if not s.mail_from:
        return None
    if s.mailjet_api_key and s.mailjet_secret_key:
        return "mailjet"
    if s.brevo_api_key:
        return "brevo"
    return None


def mail_enabled() -> bool:
    return _provider() is not None


def _request(provider: str, to: str, subject: str, text: str, html: str) -> urllib.request.Request:
    s = get_settings()
    if provider == "mailjet":
        body = {"Messages": [{"From": {"Email": s.mail_from, "Name": s.mail_from_name}, "To": [{"Email": to}],
                              "Subject": subject, "TextPart": text, "HTMLPart": html}]}
        auth = base64.b64encode(f"{s.mailjet_api_key}:{s.mailjet_secret_key}".encode()).decode()
        return urllib.request.Request("https://api.mailjet.com/v3.1/send", data=json.dumps(body).encode(), method="POST",
                                      headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"})
    body = {"sender": {"name": s.mail_from_name, "email": s.mail_from}, "to": [{"email": to}],
            "subject": subject, "textContent": text, "htmlContent": html}
    return urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(body).encode(), method="POST",
                                  headers={"api-key": s.brevo_api_key, "Content-Type": "application/json", "Accept": "application/json"})


def send_mail(to: str, subject: str, text: str, html: str) -> bool:
    provider = _provider()
    if not provider:
        return False
    try:
        with urllib.request.urlopen(_request(provider, to, subject, text, html), timeout=15) as r:
            return 200 <= r.status < 300
    except urllib.error.HTTPError as e:
        log.warning("email send failed: %s HTTP %s", provider, e.code)
        return False
    except Exception as e:
        log.warning("email send failed: %s %s", provider, type(e).__name__)
        return False

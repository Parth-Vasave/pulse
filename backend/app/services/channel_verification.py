"""Confirming that the owner of an email address wants Pulse's alerts there.

Without this, any account could add someone else's address as a channel and have Pulse mail it: the alert text
carries the attacker's monitor name and URL, so that is a phishing relay sending from our domain. A new email
channel therefore receives nothing until the recipient follows a link we mail them.

The link carries a signed, expiring token bound to the channel and the exact address, so it can't be replayed
against another channel. The confirmation email contains no user-supplied text at all.
"""

import hashlib
import smtplib
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage

import jwt

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models import NotificationChannel

log = get_logger("app.channel_verification")

TOKEN_TTL = timedelta(hours=48)
_AUDIENCE = "pulse:verify-channel"  # session tokens have no audience, so neither kind is accepted as the other
_ALGORITHM = "HS256"


def _address_digest(address: str) -> str:
    return hashlib.sha256(address.strip().lower().encode()).hexdigest()[:32]


def make_token(channel: NotificationChannel, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    payload = {
        "aud": _AUDIENCE,
        "cid": channel.id,
        "adr": _address_digest(channel.configuration["address"]),
        "iat": now,
        "exp": now + TOKEN_TTL,
    }
    return jwt.encode(payload, get_settings().secret_key, algorithm=_ALGORITHM)


def read_token(token: str) -> tuple[int, str] | None:
    """Return (channel_id, address digest), or None if the token is invalid, expired or not a verification token."""
    try:
        claims = jwt.decode(
            token,
            get_settings().secret_key,
            algorithms=[_ALGORITHM],
            audience=_AUDIENCE,
            options={"require": ["aud", "exp", "cid", "adr"]},
        )
        return int(claims["cid"]), str(claims["adr"])
    except (jwt.PyJWTError, ValueError, TypeError):
        return None


def token_matches(channel: NotificationChannel, digest: str) -> bool:
    address = channel.configuration.get("address")
    return isinstance(address, str) and _address_digest(address) == digest


def confirmation_link(token: str) -> str:
    # In the fragment, not the query string, so the token never reaches a server or proxy log.
    return f"{get_settings().frontend_url.rstrip('/')}/verify-channel#token={token}"


def send_confirmation(channel: NotificationChannel) -> bool:
    """Mail the confirmation link. Returns False (and logs) if the mail server refused; the user can resend."""
    s = get_settings()
    hours = int(TOKEN_TTL.total_seconds() // 3600)
    mail = EmailMessage()
    mail["Subject"] = "Confirm you want Pulse alerts at this address"
    mail["From"] = s.smtp_from
    mail["To"] = channel.configuration["address"]
    mail.set_content(
        "Someone asked Pulse to send API incident alerts to this email address.\n\n"
        f"To start receiving them, open this link within {hours} hours and confirm:\n"
        f"{confirmation_link(make_token(channel))}\n\n"
        "If you didn't expect this, ignore this email. Nothing will be sent to you unless you confirm.\n"
    )
    try:
        with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
            if s.smtp_starttls:
                smtp.starttls()
            if s.smtp_user:
                smtp.login(s.smtp_user, s.smtp_password)
            smtp.send_message(mail)
    except (smtplib.SMTPException, OSError) as exc:
        log.warning("channel_confirmation_failed", extra={"channel_id": channel.id, "error": type(exc).__name__})
        return False
    log.info("channel_confirmation_sent", extra={"channel_id": channel.id})
    return True

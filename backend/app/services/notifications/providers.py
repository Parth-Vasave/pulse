import smtplib
from email.message import EmailMessage

import httpx

from app.core.config import get_settings
from app.services.notifications.base import IncidentMessage, NotificationError, NotificationProvider
from app.services.safe_http import build_guarded_client
from app.services.ssrf import SSRFError


def _post_json(url: str, payload: dict, headers: dict | None = None) -> None:
    try:
        with build_guarded_client(10) as client:
            resp = client.post(url, json=payload, headers=headers or {})
    except SSRFError as exc:
        raise NotificationError(f"Blocked target: {exc}", retryable=False) from exc
    except httpx.HTTPError as exc:
        raise NotificationError(f"Request failed: {type(exc).__name__}") from exc
    if resp.status_code >= 500 or resp.status_code == 429:
        raise NotificationError(f"Endpoint returned HTTP {resp.status_code}")
    if resp.status_code >= 400:
        raise NotificationError(f"Endpoint rejected request: HTTP {resp.status_code}", retryable=False)


class EmailNotificationProvider(NotificationProvider):
    channel_type = "email"

    def send(self, config: dict, message: IncidentMessage) -> None:
        s = get_settings()
        mail = EmailMessage()
        mail["Subject"] = message.subject
        mail["From"] = s.smtp_from
        mail["To"] = config["address"]
        mail.set_content(message.body())
        try:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as smtp:
                if s.smtp_starttls:
                    smtp.starttls()
                if s.smtp_user:
                    smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(mail)
        except (smtplib.SMTPException, OSError) as exc:
            raise NotificationError(f"SMTP error: {type(exc).__name__}") from exc


class WebhookNotificationProvider(NotificationProvider):
    channel_type = "webhook"

    def send(self, config: dict, message: IncidentMessage) -> None:
        payload = {
            "event": f"incident.{message.kind}",
            "incident_id": message.incident_id,
            "monitor": {"name": message.monitor_name, "url": message.monitor_url},
            "reason": message.reason,
            "started_at": message.started_at.isoformat(),
            "resolved_at": message.resolved_at.isoformat() if message.resolved_at else None,
            "downtime_seconds": message.downtime_seconds,
            "text": message.body(),
        }
        _post_json(config["url"], payload)


class DiscordNotificationProvider(NotificationProvider):
    channel_type = "discord"

    def send(self, config: dict, message: IncidentMessage) -> None:
        color = 0xE5484D if message.kind == "created" else 0x30A46C
        payload = {"embeds": [{"title": message.subject, "description": message.body(), "color": color}]}
        _post_json(config["url"], payload)


PROVIDERS: dict[str, NotificationProvider] = {
    p.channel_type: p
    for p in (EmailNotificationProvider(), WebhookNotificationProvider(), DiscordNotificationProvider())
}


def get_provider(channel_type: str) -> NotificationProvider:
    try:
        return PROVIDERS[channel_type]
    except KeyError as exc:
        raise NotificationError(f"Unknown channel type {channel_type!r}", retryable=False) from exc

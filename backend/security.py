import re
import logging
from typing import Any, Dict, Union

# Compiled regex patterns for sensitive data detection & masking
_PATTERNS = [
    # Google Gemini API key: starts with AIza followed by 35 alphanumeric or dash/underscore
    (re.compile(r"AIza[0-9A-Za-z\-_]{35}"), lambda m: m.group(0)[:6] + "...[MASKED]"),
    # OpenRouter API key: starts with sk-or-v1- followed by 64 hex characters
    (re.compile(r"sk-or-v1-[0-9a-fA-F]{64}"), lambda m: m.group(0)[:10] + "...[MASKED]"),
    # OpenAI format key: starts with sk- followed by 32+ chars
    (re.compile(r"sk-[0-9A-Za-z_\-]{32,}"), lambda m: m.group(0)[:6] + "...[MASKED]"),
    # Generic Authorization Bearer tokens
    (re.compile(r"Bearer\s+([A-Za-z0-9_\-\.]{15,})", re.IGNORECASE), lambda m: "Bearer [MASKED]"),
    # Proxy URLs with embedded credentials: http://user:pass@host
    (re.compile(r"(https?|socks5)://([^:]+):([^@\s]+)@", re.IGNORECASE), lambda m: f"{m.group(1)}://{m.group(2)}:*****@"),
    # Sensitive URL query parameters: api_key=..., openrouter_key=..., token=..., key=..., password=...
    (re.compile(r"(?i)(api_key|openrouter_key|token|key|password|secret)=([^&\s]+)"), lambda m: f"{m.group(1)}=[MASKED]"),
    # Sensitive JSON payload fields: "api_key": "...", "cookies": "..."
    (re.compile(r'(?i)"(api_key|openrouter_key|token|password|cookies|cookie)"\s*:\s*"([^"]{6,})"'), lambda m: f'"{m.group(1)}": "[MASKED]"'),
    # YouTube sensitive cookie identifiers
    (re.compile(r"(?i)(SAPISID|APISID|SSID|HSID|SID|LOGIN_INFO)=([^;\s&]+)"), lambda m: f"{m.group(1)}=[MASKED]"),
]


def mask_sensitive_text(text: str) -> str:
    """Masks all known sensitive credentials, tokens, API keys, proxy passwords, and cookies
    from strings before they are logged to server output.
    """
    if not text or not isinstance(text, str):
        return text

    masked = text
    for pattern, repl in _PATTERNS:
        try:
            masked = pattern.sub(repl, masked)
        except Exception:
            pass
    return masked


class SensitiveDataFilter(logging.Filter):
    """Logging filter that redacts sensitive API keys, tokens, and credentials
    from all log records emitted to console, files, or stdout/stderr.
    """
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = mask_sensitive_text(record.msg)

            if record.args:
                if isinstance(record.args, dict):
                    record.args = {
                        k: mask_sensitive_text(str(v)) if isinstance(v, str) else v
                        for k, v in record.args.items()
                    }
                elif isinstance(record.args, tuple):
                    record.args = tuple(
                        mask_sensitive_text(str(v)) if isinstance(v, str) else v
                        for v in record.args
                    )
        except Exception:
            pass
        return True


def install_security_logging() -> None:
    """Installs the SensitiveDataFilter on all root, uvicorn, and app loggers
    to ensure zero leakage across any server log stream.
    """
    filter_instance = SensitiveDataFilter()

    # Apply to root logger and active handlers
    root_logger = logging.getLogger()
    if filter_instance not in root_logger.filters:
        root_logger.addFilter(filter_instance)
    for handler in root_logger.handlers:
        if filter_instance not in handler.filters:
            handler.addFilter(filter_instance)

    # Apply to core application and web server loggers
    target_loggers = [
        "cheat-clip-pro",
        "cheat-clip-pro.video-engine",
        "uvicorn",
        "uvicorn.access",
        "uvicorn.error",
        "fastapi",
    ]
    for name in target_loggers:
        l = logging.getLogger(name)
        if filter_instance not in l.filters:
            l.addFilter(filter_instance)
        for h in l.handlers:
            if filter_instance not in h.filters:
                h.addFilter(filter_instance)

"""
Prompt-injection warning scanner for external tool content.

Ported verbatim from Vibe-Trading's agent/src/security/scanner.py (pure
stdlib — no changes needed to run standalone). Registered as the
``src.security.scanner`` module by vt_base.install_src_shim() so the copied
``web_search_tool.py`` / ``web_reader_tool.py`` import it unchanged.

The scanner never rewrites or drops fetched content; it only adds warning
metadata to the JSON envelopes returned by reader/search tools so the agent
treats external text as untrusted instructions, and defangs chat-template
control tokens (``<|im_start|>`` etc.) that untrusted web content could use
to forge role boundaries.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable


@dataclass(frozen=True)
class InjectionRule:
    rule_id: str
    pattern: re.Pattern[str]
    severity: str
    message: str


_RULES: tuple[InjectionRule, ...] = (
    InjectionRule(
        "instruction_override",
        re.compile(
            r"\b(ignore|disregard|forget|bypass|override)\b.{0,80}"
            r"\b(previous|prior|above|earlier|system|developer)\b.{0,40}"
            r"\b(instructions?|rules?|messages?|prompt)\b",
            re.IGNORECASE | re.DOTALL,
        ),
        "high",
        "External content appears to request overriding prior instructions.",
    ),
    InjectionRule(
        "system_prompt_exfiltration",
        re.compile(
            r"\b(reveal|print|show|dump|leak|exfiltrate)\b.{0,80}"
            r"\b(system|developer|hidden)\b.{0,40}\b(prompt|instructions?|rules?|message)\b",
            re.IGNORECASE | re.DOTALL,
        ),
        "high",
        "External content appears to request hidden prompt or instruction disclosure.",
    ),
    InjectionRule(
        "role_or_channel_claim",
        re.compile(
            r"\b(system|developer)\s+message\b|\byou are now\b.{0,50}"
            r"\b(system|developer|admin|root)\b",
            re.IGNORECASE | re.DOTALL,
        ),
        "medium",
        "External content appears to impersonate a privileged role or channel.",
    ),
    InjectionRule(
        "secret_exfiltration",
        re.compile(
            r"\b(print|show|dump|send|exfiltrate|leak)\b.{0,80}"
            r"\b(api[_ -]?keys?|tokens?|passwords?|secrets?|env(?:ironment)? vars?)\b",
            re.IGNORECASE | re.DOTALL,
        ),
        "high",
        "External content appears to request secret or environment disclosure.",
    ),
    InjectionRule(
        "tool_abuse",
        re.compile(
            r"\b(call|run|execute|use)\b.{0,80}\b(shell|bash|terminal|python|curl)\b",
            re.IGNORECASE | re.DOTALL,
        ),
        "medium",
        "External content appears to instruct tool or shell execution.",
    ),
)


_ZWSP = "​"  # zero-width space

# Chat-template / tokenizer control-token shapes untrusted content could use to
# forge role boundaries. Matched exactly so ordinary prose is never touched.
_SPECIAL_TOKEN_RE = re.compile(
    r"<[\|｜][A-Za-z0-9_▁]{0,64}[\|｜]>"
    r"|<</?SYS>>"
    r"|\[/?INST\]"
    r"|</?s>"
    r"|<(?:start_of_turn|end_of_turn|bos|eos|pad)>"
)


def _defang_special_token(match: re.Match[str]) -> str:
    token = match.group(0)
    if len(token) > 1 and token[1] == _ZWSP:
        return token
    return token[0] + _ZWSP + token[1:]


def neutralize_special_tokens(text: str) -> str:
    """Insert a ZWSP after the opening delimiter of any control-token shape."""
    if not text or not _SPECIAL_TOKEN_RE.search(text):
        return text
    return _SPECIAL_TOKEN_RE.sub(_defang_special_token, text)


def scan_prompt_injection(text: str, *, field: str | None = None) -> list[dict[str, str]]:
    """Return prompt-injection findings for untrusted external text."""
    findings: list[dict[str, str]] = []
    if not text:
        return findings
    for rule in _RULES:
        match = rule.pattern.search(text)
        if not match:
            continue
        finding = {
            "type": "prompt_injection", "rule_id": rule.rule_id,
            "severity": rule.severity, "message": rule.message,
            "match": _compact_match(match.group(0)),
        }
        if field is not None:
            finding["field"] = field
        findings.append(finding)
    return findings


def with_security_warnings(payload: dict[str, Any], *, fields: Iterable[str]) -> dict[str, Any]:
    """Scan and neutralize selected untrusted string fields in a payload in place."""
    warnings: list[dict[str, str]] = []
    for selector in fields:
        for parent, key, path in _iter_selected_targets(payload, selector.split(".")):
            value = parent[key]
            if isinstance(value, str):
                warnings.extend(scan_prompt_injection(value, field=path))
                neutralized = neutralize_special_tokens(value)
                if neutralized is not value:
                    parent[key] = neutralized
    if warnings:
        existing = payload.get("security_warnings", [])
        payload["security_warnings"] = [*existing, *warnings] if isinstance(existing, list) else warnings
    return payload


def _iter_selected_targets(container: Any, parts: list[str], path: str = "") -> Iterable[tuple[Any, Any, str]]:
    if not parts:
        return
    head, *tail = parts
    if head == "*":
        if not isinstance(container, list):
            return
        for idx, item in enumerate(container):
            next_path = f"{path}.{idx}" if path else str(idx)
            if tail:
                yield from _iter_selected_targets(item, tail, next_path)
            else:
                yield container, idx, next_path
        return
    if not isinstance(container, dict) or head not in container:
        return
    next_path = f"{path}.{head}" if path else head
    if tail:
        yield from _iter_selected_targets(container[head], tail, next_path)
    else:
        yield container, head, next_path


def _compact_match(text: str) -> str:
    compact = " ".join(text.split())
    return compact if len(compact) <= 120 else compact[:117] + "..."

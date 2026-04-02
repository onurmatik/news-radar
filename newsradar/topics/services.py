import json
import logging
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from openai import OpenAI
from perplexity import Perplexity

from newsradar.topics.models import (
    AUTO_FREQUENCY_MAX_HOURS,
    AUTO_FREQUENCY_MIN_HOURS,
    Topic,
    normalize_topic_query,
)

logger = logging.getLogger(__name__)


def normalize_domain_value(entry: str) -> str | None:
    if not isinstance(entry, str):
        return None
    raw = entry.strip()
    if not raw:
        return None
    if raw.startswith("-"):
        raw = raw[1:].strip()
    if not raw:
        return None
    raw = raw.split("#", 1)[0].split("?", 1)[0]
    if raw.startswith("."):
        domain = raw.split("/", 1)[0]
    else:
        parsed = urlparse(raw if "://" in raw else f"//{raw}")
        host = parsed.netloc or parsed.path.split("/", 1)[0]
        if "@" in host:
            host = host.split("@")[-1]
        domain = host.split(":", 1)[0]
    domain = domain.strip().lower().rstrip(".")
    if domain.startswith("www."):
        domain = domain[4:]
    return domain or None


def clamp_auto_interval_hours(value: Any) -> int:
    try:
        interval = int(value)
    except (TypeError, ValueError):
        interval = 24
    return max(AUTO_FREQUENCY_MIN_HOURS, min(AUTO_FREQUENCY_MAX_HOURS, interval))


def normalize_string_list(
    values: list[str] | None,
    *,
    lower: bool = False,
    max_length: int | None = None,
) -> list[str]:
    if values is not None and not isinstance(values, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in values or []:
        if not isinstance(item, str):
            continue
        value = normalize_topic_query(item)
        if lower:
            value = value.lower()
        if not value or value in seen:
            continue
        seen.add(value)
        cleaned.append(value)
        if max_length is not None and len(cleaned) >= max_length:
            break
    return cleaned


def build_queries(primary_query: str, query_variations: list[str] | None = None) -> list[str]:
    normalized_primary = normalize_topic_query(primary_query)
    if not normalized_primary:
        raise ValueError("Primary query is required.")
    queries = [normalized_primary]
    for variation in normalize_string_list(query_variations, max_length=4):
        if variation == normalized_primary:
            continue
        queries.append(variation)
    return queries[:5]


def _normalize_domain_candidates(values: list[str] | None) -> list[str]:
    if values is not None and not isinstance(values, list):
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in values or []:
        domain = normalize_domain_value(item)
        if not domain or domain in seen:
            continue
        seen.add(domain)
        cleaned.append(domain)
    return cleaned


def _parse_json_from_text(text: str) -> Any:
    stripped = (text or "").strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        pass

    for start_char, end_char in (("{", "}"), ("[", "]")):
        start = stripped.find(start_char)
        end = stripped.rfind(end_char)
        if start == -1 or end == -1 or end <= start:
            continue
        candidate = stripped[start : end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _discover_topic_domains(monitoring_prompt: str) -> list[dict[str, str]]:
    try:
        client = Perplexity()
        response = client.search.create(
            query=(
                "Find reputable official, institutional, NGO, regulator, and major news "
                "domains that should be monitored for this topic. Topic: "
                f"{monitoring_prompt}"
            ),
            max_results=10,
            max_tokens=4000,
            max_tokens_per_page=512,
        )
        payload = response.model_dump()
    except Exception:
        logger.exception("Failed to discover domains for monitoring prompt.")
        return []

    results = payload.get("results") or []
    suggestions: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in results:
        if not isinstance(item, dict):
            continue
        domain = normalize_domain_value(item.get("url", ""))
        if not domain or domain in seen:
            continue
        seen.add(domain)
        suggestions.append(
            {
                "domain": domain,
                "label": normalize_topic_query(item.get("title") or domain) or domain,
                "rationale": normalize_topic_query(item.get("snippet") or "")[:240],
            }
        )
    return suggestions[:8]


def _fallback_locality(monitoring_prompt: str) -> tuple[str | None, list[str] | None]:
    lowered = monitoring_prompt.lower()
    if "türkiye" in lowered or "turkiye" in lowered or "türk" in lowered or "turk" in lowered:
        return "TR", ["tr"]
    if "united states" in lowered or "u.s." in lowered or " us " in f" {lowered} ":
        return "US", ["en"]
    return None, None


def _fallback_frequency(prompt: str) -> int:
    lowered = prompt.lower()
    if any(token in lowered for token in ("breaking", "live", "urgent", "real-time")):
        return 1
    if any(token in lowered for token in ("daily", "day to day", "market", "policy", "news")):
        return 24
    return 72


def _fallback_topic_organization(
    monitoring_prompt: str,
    discovered_sources: list[dict[str, str]],
) -> dict[str, Any]:
    country, languages = _fallback_locality(monitoring_prompt)
    return {
        "display_title": normalize_topic_query(monitoring_prompt),
        "primary_query": normalize_topic_query(monitoring_prompt),
        "query_variations": [],
        "source_suggestions": discovered_sources[:5],
        "search_domain_allowlist": [item["domain"] for item in discovered_sources[:5]] or None,
        "country": country,
        "search_language_filter": languages,
        "update_frequency": Topic.UPDATE_FREQUENCY_AUTO,
        "suggested_interval_hours": _fallback_frequency(monitoring_prompt),
    }


def _normalize_source_suggestions(
    raw_values: Any,
    discovered_sources: list[dict[str, str]],
) -> list[dict[str, str]]:
    if raw_values is not None and not isinstance(raw_values, list):
        raw_values = []
    suggestions: list[dict[str, str]] = []
    seen: set[str] = set()

    for item in raw_values or []:
        if not isinstance(item, dict):
            continue
        domain = normalize_domain_value(item.get("domain") or item.get("url") or "")
        if not domain or domain in seen:
            continue
        seen.add(domain)
        suggestions.append(
            {
                "domain": domain,
                "label": normalize_topic_query(item.get("label") or item.get("title") or domain)
                or domain,
                "rationale": normalize_topic_query(item.get("rationale") or item.get("reason") or "")[:240],
            }
        )

    for item in discovered_sources:
        domain = item["domain"]
        if domain in seen:
            continue
        seen.add(domain)
        suggestions.append(item)

    return suggestions[:8]


def organize_topic_configuration(
    monitoring_prompt: str,
    *,
    group_name: str | None = None,
    group_description: str | None = None,
) -> dict[str, Any]:
    normalized_prompt = normalize_topic_query(monitoring_prompt)
    if not normalized_prompt:
        raise ValueError("Monitoring prompt is required.")

    discovered_sources = _discover_topic_domains(normalized_prompt)
    fallback = _fallback_topic_organization(normalized_prompt, discovered_sources)
    if not getattr(settings, "OPENAI_API_KEY", ""):
        return fallback

    context: dict[str, Any] = {
        "monitoring_prompt": normalized_prompt,
        "group_name": normalize_topic_query(group_name or "") or None,
        "group_description": normalize_topic_query(group_description or "") or None,
        "discovered_sources": discovered_sources,
        "requirements": {
            "max_query_variations": 4,
            "max_source_suggestions": 8,
            "frequency_mode": "auto",
            "interval_hours_min": AUTO_FREQUENCY_MIN_HOURS,
            "interval_hours_max": AUTO_FREQUENCY_MAX_HOURS,
        },
    }
    prompt = (
        "You are organizing a topic-monitoring setup for a news radar.\n"
        "Return strict JSON only with this shape:\n"
        '{'
        '"display_title":"",'
        '"primary_query":"",'
        '"query_variations":[""],'
        '"source_suggestions":[{"domain":"","label":"","rationale":""}],'
        '"search_domain_allowlist":[""],'
        '"country":"",'
        '"search_language_filter":[""],'
        '"update_frequency":"auto",'
        '"suggested_interval_hours":24'
        '}\n'
        "Rules:\n"
        "- Keep display_title short and readable.\n"
        "- Keep queries concise and complementary.\n"
        "- Suggest country/language only when clearly useful.\n"
        "- Prefer reputable official, NGO, regulatory, and major news domains.\n"
        "- update_frequency must always be auto.\n"
        "- suggested_interval_hours must be an integer between 1 and 168.\n"
        "- If uncertain, leave optional fields empty rather than inventing details.\n"
        f"Context JSON:\n{json.dumps(context, ensure_ascii=False)}"
    )

    try:
        client = OpenAI(timeout=settings.OPENAI_RESPONSES_TIMEOUT_SECONDS)
        request_kwargs: dict[str, Any] = {
            "model": settings.OPENAI_RESPONSES_MODEL,
            "input": prompt,
            "max_output_tokens": 800,
        }
        if settings.OPENAI_RESPONSES_REASONING_EFFORT is not None:
            request_kwargs["reasoning"] = {
                "effort": settings.OPENAI_RESPONSES_REASONING_EFFORT,
            }
        response = client.responses.create(**request_kwargs)
        parsed = _parse_json_from_text(getattr(response, "output_text", ""))
        if not isinstance(parsed, dict):
            return fallback
    except Exception:
        logger.exception("Failed to organize monitoring prompt.")
        return fallback

    source_suggestions = _normalize_source_suggestions(
        parsed.get("source_suggestions"),
        discovered_sources,
    )
    normalized_allowlist = _normalize_domain_candidates(parsed.get("search_domain_allowlist"))
    if not normalized_allowlist:
        normalized_allowlist = [item["domain"] for item in source_suggestions[:5]]

    country = normalize_topic_query(parsed.get("country") or "").upper() or None
    if country and len(country) != 2:
        country = None

    display_title = normalize_topic_query(parsed.get("display_title") or "") or fallback["display_title"]
    primary_query = normalize_topic_query(parsed.get("primary_query") or "") or fallback["primary_query"]
    query_variations = [
        item
        for item in normalize_string_list(parsed.get("query_variations"), max_length=4)
        if item != primary_query
    ]
    languages = normalize_string_list(
        parsed.get("search_language_filter"),
        lower=True,
        max_length=10,
    ) or fallback["search_language_filter"]

    return {
        "display_title": display_title,
        "primary_query": primary_query,
        "query_variations": query_variations,
        "source_suggestions": source_suggestions,
        "search_domain_allowlist": normalized_allowlist or None,
        "country": country,
        "search_language_filter": languages,
        "update_frequency": Topic.UPDATE_FREQUENCY_AUTO,
        "suggested_interval_hours": clamp_auto_interval_hours(
            parsed.get("suggested_interval_hours")
        ),
    }

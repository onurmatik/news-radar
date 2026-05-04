import json
import logging
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from openai import OpenAI

from newsradar.topics.models import (
    AUTO_FREQUENCY_MAX_HOURS,
    AUTO_FREQUENCY_MIN_HOURS,
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


def _normalize_domain_candidates(
    values: list[str] | None,
    *,
    max_length: int = 20,
) -> list[str]:
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
        if len(cleaned) >= max_length:
            break
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


def _fallback_locality(monitoring_prompt: str) -> tuple[str | None, list[str] | None]:
    lowered = monitoring_prompt.lower()
    if "türkiye" in lowered or "turkiye" in lowered or "türk" in lowered or "turk" in lowered:
        return "TR", ["tr"]
    if "united states" in lowered or "u.s." in lowered or " us " in f" {lowered} ":
        return "US", ["en"]
    return None, None


def _build_fallback_configuration(
    monitoring_prompt: str,
    *,
    queries: list[str] | None = None,
    domains: list[str] | None = None,
    country: str | None = None,
    languages: list[str] | None = None,
) -> dict[str, Any]:
    normalized_prompt = normalize_topic_query(monitoring_prompt)
    fallback_country, fallback_languages = _fallback_locality(normalized_prompt)
    normalized_queries = normalize_string_list(queries, max_length=5)
    if not normalized_queries and normalized_prompt:
        normalized_queries = [normalized_prompt]
    normalized_domains = _normalize_domain_candidates(domains, max_length=20)
    normalized_country = normalize_topic_query(country or "").upper() or fallback_country
    if normalized_country and len(normalized_country) != 2:
        normalized_country = fallback_country
    normalized_languages = normalize_string_list(
        languages,
        lower=True,
        max_length=10,
    ) or fallback_languages
    return {
        "display_title": normalized_prompt,
        "query_variations": normalized_queries[:5],
        "suggested_domains": normalized_domains[:20],
        "country": normalized_country,
        "search_language_filter": normalized_languages,
        "topic_warning": None,
    }


def _normalize_topic_configuration(
    raw_values: Any,
    *,
    monitoring_prompt: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(raw_values, dict):
        return fallback

    query_variations = normalize_string_list(raw_values.get("query_variations"), max_length=5)
    if not query_variations:
        query_variations = fallback["query_variations"]

    suggested_domains = _normalize_domain_candidates(raw_values.get("domains"), max_length=20)
    if not suggested_domains:
        suggested_domains = fallback["suggested_domains"]

    country = normalize_topic_query(raw_values.get("country") or "").upper() or None
    if country and len(country) != 2:
        country = fallback["country"]

    languages = normalize_string_list(
        raw_values.get("languages"),
        lower=True,
        max_length=10,
    ) or fallback["search_language_filter"]
    topic_warning = normalize_topic_query(raw_values.get("topic_warning") or "") or None

    return {
        "display_title": fallback["display_title"] or normalize_topic_query(monitoring_prompt),
        "query_variations": query_variations,
        "suggested_domains": suggested_domains,
        "country": country,
        "search_language_filter": languages,
        "topic_warning": topic_warning,
    }


def _request_topic_configuration(
    prompt: str,
    *,
    monitoring_prompt: str,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    if not getattr(settings, "OPENAI_API_KEY", ""):
        return fallback

    try:
        client = OpenAI(timeout=settings.OPENAI_RESPONSES_TIMEOUT_SECONDS)
        request_kwargs: dict[str, Any] = {
            "model": settings.OPENAI_RESPONSES_MODEL,
            "input": prompt,
            "max_output_tokens": 1000,
        }
        if settings.OPENAI_RESPONSES_REASONING_EFFORT is not None:
            request_kwargs["reasoning"] = {
                "effort": settings.OPENAI_RESPONSES_REASONING_EFFORT,
            }
        response = client.responses.create(**request_kwargs)
        parsed = _parse_json_from_text(getattr(response, "output_text", ""))
        return _normalize_topic_configuration(
            parsed,
            monitoring_prompt=monitoring_prompt,
            fallback=fallback,
        )
    except Exception:
        logger.exception("Failed to organize monitoring prompt.")
        return fallback


def _normalize_feedback_items(feedback_items: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    normalized_items: list[dict[str, str]] = []
    for item in feedback_items or []:
        if not isinstance(item, dict):
            continue
        reaction = normalize_topic_query(item.get("reaction") or "").lower()
        if reaction not in {"up", "down"}:
            continue
        normalized_items.append(
            {
                "title": normalize_topic_query(item.get("title") or ""),
                "url": normalize_topic_query(item.get("url") or ""),
                "domain": normalize_domain_value(item.get("domain") or item.get("url") or "") or "",
                "snippet": normalize_topic_query(item.get("snippet") or "")[:500],
                "reaction": reaction,
            }
        )
        if len(normalized_items) >= 20:
            break
    return normalized_items


def organize_topic_configuration(monitoring_prompt: str) -> dict[str, Any]:
    normalized_prompt = normalize_topic_query(monitoring_prompt)
    if not normalized_prompt:
        raise ValueError("Monitoring prompt is required.")

    fallback = _build_fallback_configuration(normalized_prompt)
    prompt = (
        "You are configuring a news monitoring topic.\n"
        "Analyze the topic and return strict JSON only with this shape:\n"
        '{'
        '"query_variations":[""],'
        '"domains":[""],'
        '"country":"",'
        '"languages":[""],'
        '"topic_warning":""'
        '}\n'
        "Rules:\n"
        "- query_variations must be in English.\n"
        "- Provide up to 5 concise, distinct search query variations.\n"
        "- Provide up to 20 bare domains only, without protocols, paths, or explanations.\n"
        "- Prefer trustworthy official, regulatory, NGO, institutional, trade, and major news sources.\n"
        "- If the topic is clearly local or country-specific, set country to a 2-letter ISO code and languages to relevant language codes.\n"
        "- If the topic is not local, return country as an empty string and languages as an empty array.\n"
        "- Evaluate the topic choice itself and set topic_warning when the topic is too wide, too vague, too ambiguous, or otherwise likely to produce noisy monitoring results.\n"
        "- Leave topic_warning empty when no warning is needed.\n"
        "- Do not include markdown or any extra keys.\n"
        f"Topic: {normalized_prompt}"
    )
    return _request_topic_configuration(
        prompt,
        monitoring_prompt=normalized_prompt,
        fallback=fallback,
    )


def refine_topic_configuration(
    monitoring_prompt: str,
    *,
    queries: list[str] | None,
    domains: list[str] | None,
    country: str | None,
    languages: list[str] | None,
    feedback_items: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    normalized_prompt = normalize_topic_query(monitoring_prompt)
    if not normalized_prompt:
        raise ValueError("Monitoring prompt is required.")

    normalized_feedback = _normalize_feedback_items(feedback_items)
    fallback = _build_fallback_configuration(
        normalized_prompt,
        queries=queries,
        domains=domains,
        country=country,
        languages=languages,
    )
    if not normalized_feedback:
        return fallback

    context = {
        "topic": normalized_prompt,
        "current_configuration": {
            "query_variations": fallback["query_variations"],
            "domains": fallback["suggested_domains"],
            "country": fallback["country"] or "",
            "languages": fallback["search_language_filter"] or [],
        },
        "result_feedback": normalized_feedback,
    }
    prompt = (
        "You are revising a news monitoring topic after a trial search.\n"
        "Use the topic, current configuration, and user feedback on search results to improve the monitoring parameters.\n"
        "Return strict JSON only with this shape:\n"
        '{'
        '"query_variations":[""],'
        '"domains":[""],'
        '"country":"",'
        '"languages":[""],'
        '"topic_warning":""'
        '}\n'
        "Rules:\n"
        "- query_variations must be in English.\n"
        "- Provide up to 5 concise, distinct query variations.\n"
        "- Provide up to 20 bare domains only.\n"
        "- Keep positively correlated angles and domains when they seem useful.\n"
        "- Remove or de-emphasize domains and query angles that appear low quality or off-topic.\n"
        "- If the topic is clearly local or country-specific, set country to a 2-letter ISO code and languages to relevant language codes.\n"
        "- If the topic is not local, return country as an empty string and languages as an empty array.\n"
        "- Re-evaluate the topic choice itself and set topic_warning when the topic is still too wide, too vague, too ambiguous, or otherwise likely to produce noisy monitoring results.\n"
        "- Leave topic_warning empty when no warning is needed.\n"
        "- Do not include markdown or any extra keys.\n"
        f"Context JSON:\n{json.dumps(context, ensure_ascii=False)}"
    )
    return _request_topic_configuration(
        prompt,
        monitoring_prompt=normalized_prompt,
        fallback=fallback,
    )


def suggest_more_domains(
    monitoring_prompt: str,
    *,
    selected_domains: list[str] | None,
) -> list[str]:
    normalized_prompt = normalize_topic_query(monitoring_prompt)
    if not normalized_prompt:
        raise ValueError("Monitoring prompt is required.")

    normalized_selected = _normalize_domain_candidates(selected_domains, max_length=20)
    if not normalized_selected:
        raise ValueError("At least one selected domain is required.")

    remaining_count = 20 - len(normalized_selected)
    if remaining_count <= 0:
        return []

    if not getattr(settings, "OPENAI_API_KEY", ""):
        return []

    prompt = (
        "You are expanding a curated list of domains for a news monitoring topic.\n"
        "Return strict JSON only with this shape:\n"
        '{'
        '"domains":[""]'
        '}\n'
        "Rules:\n"
        f"- Suggest up to {remaining_count} additional bare domains only.\n"
        "- Do not include protocols, paths, explanations, markdown, or extra keys.\n"
        "- Do not repeat any domain already provided.\n"
        "- Prefer domains similar in trustworthiness and relevance to the provided list.\n"
        "- Favor official, regulatory, NGO, institutional, trade, and major news sources when relevant.\n"
        f"Topic: {normalized_prompt}\n"
        f"Current domains: {json.dumps(normalized_selected, ensure_ascii=False)}"
    )

    try:
        client = OpenAI(timeout=settings.OPENAI_RESPONSES_TIMEOUT_SECONDS)
        request_kwargs: dict[str, Any] = {
            "model": settings.OPENAI_RESPONSES_MODEL,
            "input": prompt,
            "max_output_tokens": 600,
        }
        if settings.OPENAI_RESPONSES_REASONING_EFFORT is not None:
            request_kwargs["reasoning"] = {
                "effort": settings.OPENAI_RESPONSES_REASONING_EFFORT,
            }
        response = client.responses.create(**request_kwargs)
        parsed = _parse_json_from_text(getattr(response, "output_text", ""))
    except Exception:
        logger.exception("Failed to suggest more domains.")
        return []

    if not isinstance(parsed, dict):
        return []

    existing = set(normalized_selected)
    expanded: list[str] = []
    for domain in _normalize_domain_candidates(parsed.get("domains"), max_length=20):
        if domain in existing:
            continue
        existing.add(domain)
        expanded.append(domain)
        if len(expanded) >= remaining_count:
            break
    return expanded

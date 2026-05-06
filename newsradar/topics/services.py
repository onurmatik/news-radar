import json
import logging
import re
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

SUPPORTED_TOPIC_COUNTRIES = [
    {"code": "AU", "name": "Australia", "languages": ["en"]},
    {"code": "BR", "name": "Brazil", "languages": ["pt"]},
    {"code": "CA", "name": "Canada", "languages": ["en", "fr"]},
    {"code": "CN", "name": "China", "languages": ["zh"]},
    {"code": "DE", "name": "Germany", "languages": ["de"]},
    {"code": "FR", "name": "France", "languages": ["fr"]},
    {"code": "GB", "name": "United Kingdom", "languages": ["en"]},
    {"code": "IN", "name": "India", "languages": ["en", "hi"]},
    {"code": "JP", "name": "Japan", "languages": ["ja"]},
    {"code": "SG", "name": "Singapore", "languages": ["en"]},
    {"code": "TR", "name": "Turkey", "languages": ["tr"]},
    {"code": "US", "name": "United States", "languages": ["en"]},
]

SUPPORTED_TOPIC_COUNTRY_CODES = {country["code"] for country in SUPPORTED_TOPIC_COUNTRIES}
COUNTRY_TITLE_PREFIXES = {
    "AU": ["australia", "australian"],
    "BR": ["brazil", "brazilian"],
    "CA": ["canada", "canadian"],
    "CN": ["china", "chinese"],
    "DE": ["germany", "german"],
    "FR": ["france", "french"],
    "GB": ["united kingdom", "uk", "britain", "british"],
    "IN": ["india", "indian"],
    "JP": ["japan", "japanese"],
    "SG": ["singapore", "singaporean"],
    "TR": ["turkey", "turkish", "türkiye", "türkiye's"],
    "US": ["united states", "u.s.", "us", "american"],
}
DOMAIN_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
TITLE_LEADING_VERB_RE = re.compile(r"^(monitor|monitoring|track|tracking|watch|watching|follow|following)\s+", re.IGNORECASE)
TITLE_LEADING_NOISE_RE = re.compile(
    r"^(developments?|updates?|news|headlines|stories|coverage)\s+(on|about|around|in|for)\s+",
    re.IGNORECASE,
)
TITLE_TRAILING_NOISE_RE = re.compile(
    r"\s+(and\s+)?((public\s+)?policy\s+)?(announcements?|updates?|news|developments?)$",
    re.IGNORECASE,
)
SHORT_TITLE_ALIASES = {
    "domestic politics": "politics",
    "internal politics": "politics",
    "national politics": "politics",
    "political": "politics",
    "political development": "politics",
    "political developments": "politics",
    "economic": "economy",
    "economic development": "economy",
    "economic developments": "economy",
    "market": "markets",
    "market developments": "markets",
}


def _is_valid_domain_name(domain: str) -> bool:
    if len(domain) > 253 or "." not in domain:
        return False
    labels = domain.split(".")
    if any(not label or not DOMAIN_LABEL_RE.match(label) for label in labels):
        return False
    tld = labels[-1]
    return len(tld) >= 2 and any(char.isalpha() for char in tld)


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
    try:
        domain = domain.encode("idna").decode("ascii")
    except UnicodeError:
        return None
    if not _is_valid_domain_name(domain):
        return None
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


def _normalize_short_topic_title(
    raw_title: str | None,
    *,
    fallback: str,
    country: str | None,
) -> str:
    title = normalize_topic_query(raw_title or "") or normalize_topic_query(fallback)
    title = TITLE_LEADING_VERB_RE.sub("", title).strip()
    title = TITLE_LEADING_NOISE_RE.sub("", title).strip()

    country_terms = COUNTRY_TITLE_PREFIXES.get(country or "", [])
    for term in country_terms:
        escaped = re.escape(term)
        title = re.sub(rf"^(the\s+)?{escaped}\s+", "", title, flags=re.IGNORECASE).strip()
        title = re.sub(rf"\s+(in|for|from|across|within)\s+(the\s+)?{escaped}$", "", title, flags=re.IGNORECASE).strip()
        title = re.sub(rf"\s+{escaped}$", "", title, flags=re.IGNORECASE).strip()
    title = TITLE_TRAILING_NOISE_RE.sub("", title).strip()
    title = SHORT_TITLE_ALIASES.get(title.lower(), title)
    words = title.split()
    if len(words) > 4:
        title = " ".join(words[:4])
    return title or normalize_topic_query(fallback)


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
        "suggested_group_name": None,
        "split_suggestions": [],
    }


def _normalize_split_suggestions(
    raw_values: Any,
    *,
    max_length: int = len(SUPPORTED_TOPIC_COUNTRIES),
) -> list[dict[str, Any]]:
    if not isinstance(raw_values, list):
        return []

    suggestions: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw_item in raw_values:
        if not isinstance(raw_item, dict):
            continue

        monitoring_prompt = (
            normalize_topic_query(raw_item.get("monitoring_prompt") or raw_item.get("topic") or "")
            or normalize_topic_query(raw_item.get("display_title") or "")
        )
        if not monitoring_prompt:
            continue

        country = normalize_topic_query(raw_item.get("country") or "").upper() or None
        if country and (len(country) != 2 or country not in SUPPORTED_TOPIC_COUNTRY_CODES):
            continue

        display_title = _normalize_short_topic_title(
            raw_item.get("display_title"),
            fallback=monitoring_prompt,
            country=country,
        )
        query_variations = normalize_string_list(raw_item.get("query_variations"), max_length=5)
        if not query_variations:
            query_variations = [monitoring_prompt]

        dedupe_key = (monitoring_prompt.lower(), country or "")
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        languages = normalize_string_list(
            raw_item.get("languages") or raw_item.get("search_language_filter"),
            lower=True,
            max_length=10,
        )
        suggestions.append(
            {
                "monitoring_prompt": monitoring_prompt,
                "display_title": display_title,
                "query_variations": query_variations,
                "suggested_domains": _normalize_domain_candidates(
                    raw_item.get("domains") or raw_item.get("suggested_domains"),
                    max_length=20,
                ),
                "country": country,
                "search_language_filter": languages or None,
                "topic_warning": normalize_topic_query(raw_item.get("topic_warning") or "") or None,
            }
        )
        if len(suggestions) >= max_length:
            break
    return suggestions


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
    split_suggestions = _normalize_split_suggestions(raw_values.get("split_topics"))
    suggested_group_name = (
        normalize_topic_query(
            raw_values.get("suggested_group_name") or raw_values.get("group_name") or ""
        )
        or None
    )
    if not split_suggestions:
        suggested_group_name = None

    return {
        "display_title": fallback["display_title"] or normalize_topic_query(monitoring_prompt),
        "query_variations": query_variations,
        "suggested_domains": suggested_domains,
        "country": country,
        "search_language_filter": languages,
        "topic_warning": topic_warning,
        "suggested_group_name": suggested_group_name,
        "split_suggestions": split_suggestions,
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
            "max_output_tokens": 2000,
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
    supported_countries = ", ".join(
        f'{country["code"]} ({country["name"]}; languages: {", ".join(country["languages"])})'
        for country in SUPPORTED_TOPIC_COUNTRIES
    )
    prompt = (
        "You are configuring a news monitoring topic.\n"
        "Analyze the topic and return strict JSON only with this shape:\n"
        '{'
        '"query_variations":[""],'
        '"domains":[""],'
        '"country":"",'
        '"languages":[""],'
        '"topic_warning":"",'
        '"suggested_group_name":"",'
        '"split_topics":[{'
        '"monitoring_prompt":"",'
        '"display_title":"",'
        '"query_variations":[""],'
        '"domains":[""],'
        '"country":"",'
        '"languages":[""],'
        '"topic_warning":""'
        "}]"
        '}\n'
        "Rules:\n"
        "- query_variations must be in English.\n"
        "- Provide up to 5 concise, distinct search query variations.\n"
        "- Provide up to 20 bare domains only, without protocols, paths, or explanations.\n"
        "- Every domains entry, including split_topics domains, must be one real website domain in hostname format such as reuters.com, bbc.com, or aa.com.tr.\n"
        "- Never return outlet names, source categories, examples, language notes, or sentences inside domains; omit uncertain domains instead.\n"
        "- Prefer trustworthy official, regulatory, NGO, institutional, trade, and major news sources.\n"
        "- If the topic is clearly local or country-specific, set country to a 2-letter ISO code and languages to relevant language codes.\n"
        "- If the topic is not local, return country as an empty string and languages as an empty array.\n"
        "- Evaluate the topic choice itself and set topic_warning when the topic is too wide, too vague, too ambiguous, or otherwise likely to produce noisy monitoring results.\n"
        "- Leave topic_warning empty when no warning is needed.\n"
        "- suggested_group_name should be a short shared umbrella for the topic set, such as Turkey agenda or AI by country.\n"
        "- suggested_group_name must preserve the user's original subject and must not be broader or more generic than the original topic.\n"
        "- Keep suggested_group_name empty when split_topics is empty.\n"
        "- For country-specific topical prompts, keep the subject in suggested_group_name; do not use generic country agenda names unless the user asked for a general agenda/news topic.\n"
        "- When topic_warning is empty, return split_topics as an empty array.\n"
        "- When the topic is broad, populate split_topics with focused topic drafts the user could create instead.\n"
        "- For broad agenda topics, create 3 to 6 focused split_topics.\n"
        "- For requests that ask for every supported country or all countries, create one split topic for each supported country listed below.\n"
        "- Each split topic must be independently useful as a saved monitoring topic.\n"
        "- Split topic display_title must be short, ideally 1 to 3 words, without shared geography or umbrella terms that belong in suggested_group_name.\n"
        "- Split topic display_title must be a category label, not a sentence or instruction.\n"
        "- Split topic display_title must not start with Monitor, Track, Watch, Follow, developments on, updates on, or news about.\n"
        "- Split topic display_title must not repeat the country, geography, or group name.\n"
        "- Example: for Türkiye gündemi, use suggested_group_name Türkiye gündemi and split titles like politics, economy, foreign policy, energy.\n"
        "- Example: for Türkiye'de yargının siyasallaşması, if split topics are needed, use suggested_group_name Türkiye yargı siyasallaşması and split titles like judicial appointments, court independence, constitutional court.\n"
        "- Split topic query_variations must be in English and can reuse the same base query when the country filter differentiates the topics.\n"
        "- Split topic country must be empty or one of the supported country codes listed below.\n"
        f"- Supported countries for split topics: {supported_countries}.\n"
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
        '"topic_warning":"",'
        '"suggested_group_name":"",'
        '"split_topics":[]'
        '}\n'
        "Rules:\n"
        "- query_variations must be in English.\n"
        "- Provide up to 5 concise, distinct query variations.\n"
        "- Provide up to 20 bare domains only.\n"
        "- Every domains entry must be one real website domain in hostname format such as reuters.com, bbc.com, or aa.com.tr.\n"
        "- Never return outlet names, source categories, examples, language notes, or sentences inside domains; omit uncertain domains instead.\n"
        "- Keep positively correlated angles and domains when they seem useful.\n"
        "- Remove or de-emphasize domains and query angles that appear low quality or off-topic.\n"
        "- If the topic is clearly local or country-specific, set country to a 2-letter ISO code and languages to relevant language codes.\n"
        "- If the topic is not local, return country as an empty string and languages as an empty array.\n"
        "- Re-evaluate the topic choice itself and set topic_warning when the topic is still too wide, too vague, too ambiguous, or otherwise likely to produce noisy monitoring results.\n"
        "- Leave topic_warning empty when no warning is needed.\n"
        "- Return split_topics as an empty array.\n"
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
        "- Every domains entry must be one real website domain in hostname format such as reuters.com, bbc.com, or aa.com.tr.\n"
        "- Never return outlet names, source categories, examples, language notes, or sentences inside domains; omit uncertain domains instead.\n"
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

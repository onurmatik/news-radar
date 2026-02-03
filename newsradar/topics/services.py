from urllib.parse import urlparse


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

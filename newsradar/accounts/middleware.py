from __future__ import annotations

from newsradar.accounts.models import Profile


class ApiKeyAuthenticationMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    @staticmethod
    def _extract_api_key(request) -> str | None:
        authorization = (request.META.get("HTTP_AUTHORIZATION") or "").strip()
        if authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
            if token:
                return token
        header_value = (request.META.get("HTTP_X_API_KEY") or "").strip()
        return header_value or None

    def __call__(self, request):
        if request.path.startswith("/api/"):
            api_key = self._extract_api_key(request)
            if api_key:
                profile = (
                    Profile.objects.select_related("user")
                    .filter(
                        api_key=api_key,
                        is_pro=True,
                        user__is_active=True,
                    )
                    .first()
                )
                if profile:
                    request.user = profile.user
        return self.get_response(request)

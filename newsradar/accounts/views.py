from urllib.parse import urlparse

from django.conf import settings
from sesame.views import LoginView


class SesameLoginView(LoginView):
    def get_success_url_allowed_hosts(self):
        allowed_hosts = super().get_success_url_allowed_hosts()
        frontend_url = getattr(settings, "FRONTEND_BASE_URL", "")
        if frontend_url:
            allowed_hosts.add(urlparse(frontend_url).netloc)
        if settings.DEBUG:
            next_url = self.request.GET.get(self.redirect_field_name)
            if next_url:
                next_host = urlparse(next_url).netloc
                if next_host:
                    allowed_hosts.add(next_host)
        return allowed_hosts

    def get_default_redirect_url(self):
        frontend_url = getattr(settings, "FRONTEND_BASE_URL", "")
        if frontend_url:
            return frontend_url
        return super().get_default_redirect_url()

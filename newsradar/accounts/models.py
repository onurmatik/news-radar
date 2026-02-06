import secrets

from django.conf import settings
from django.db import models
from django.utils import timezone


class Profile(models.Model):
    PLAN_MONTHLY = "monthly"
    PLAN_YEARLY = "yearly"
    PLAN_CHOICES = (
        (PLAN_MONTHLY, "Monthly"),
        (PLAN_YEARLY, "Yearly"),
    )

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    is_pro = models.BooleanField(default=False)
    pro_plan = models.CharField(max_length=16, choices=PLAN_CHOICES, blank=True)
    pro_started_at = models.DateTimeField(blank=True, null=True)
    pro_current_period_ends_at = models.DateTimeField(blank=True, null=True)
    stripe_customer_id = models.CharField(max_length=255, blank=True)
    stripe_subscription_id = models.CharField(max_length=255, blank=True)
    api_key = models.CharField(max_length=128, blank=True, null=True, unique=True)
    api_key_created_at = models.DateTimeField(blank=True, null=True)
    last_visit_at = models.DateTimeField(blank=True, null=True)
    previous_visit_at = models.DateTimeField(blank=True, null=True)

    def __str__(self):
        return self.user.first_name.strip() or self.user.username

    def record_visit(self, visited_at=None) -> None:
        timestamp = visited_at or timezone.now()
        if self.last_visit_at:
            self.previous_visit_at = self.last_visit_at
        self.last_visit_at = timestamp
        self.save(update_fields=["last_visit_at", "previous_visit_at"])

    @staticmethod
    def _new_api_key() -> str:
        return f"nr_{secrets.token_urlsafe(32)}"

    def ensure_api_key(self) -> str:
        if self.api_key:
            return self.api_key
        return self.rotate_api_key()

    def rotate_api_key(self) -> str:
        key = self._new_api_key()
        while Profile.objects.filter(api_key=key).exists():
            key = self._new_api_key()
        self.api_key = key
        self.api_key_created_at = timezone.now()
        self.save(update_fields=["api_key", "api_key_created_at"])
        return key

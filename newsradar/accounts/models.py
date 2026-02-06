from django.conf import settings
from django.db import models
from django.utils import timezone


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
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

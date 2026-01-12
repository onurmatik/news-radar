from django.db import models


class Execution(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    class OriginType(models.TextChoices):
        PERIODIC = "periodic", "Periodic"
        USER = "user", "User"
        ADMIN = "admin", "Admin"
        CLI = "cli", "CLI"

    content_item = models.ForeignKey(
        "content.ContentItem",
        on_delete=models.CASCADE,
        related_name="executions",
    )
    raw_data = models.JSONField(blank=True, null=True)
    origin_type = models.CharField(
        max_length=20,
        choices=OriginType.choices,
        default=OriginType.USER,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RUNNING,
    )
    error_message = models.TextField(blank=True, null=True)
    llm_config = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

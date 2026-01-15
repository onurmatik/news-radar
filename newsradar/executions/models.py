from django.db import models


class Execution(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"

    class Initiator(models.TextChoices):
        PERIODIC = "periodic", "Periodic"
        USER = "user", "User"
        ADMIN = "admin", "Admin"
        CLI = "cli", "CLI"

    topic = models.ForeignKey(
        "topics.Topic",
        on_delete=models.CASCADE,
        related_name="executions",
    )

    response_payload = models.JSONField(blank=True, null=True)
    initiator = models.CharField(
        max_length=20,
        choices=Initiator.choices,
        default=Initiator.USER,
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RUNNING,
    )
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.id}: {self.topic}"

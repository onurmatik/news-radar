from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)

    def __str__(self):
        return self.user.first_name.strip() or self.user.username


class UserKeyword(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='keywords')
    keyword = models.ForeignKey('keywords.Keyword', on_delete=models.CASCADE, related_name='keywords_by')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'keyword'], name='unique_user_keyword')
        ]

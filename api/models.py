import uuid

from django.contrib.auth.models import User
from django.db import models


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    filename = models.CharField(max_length=255)
    owner = models.ForeignKey(
        User,
        related_name="assets",
        on_delete=models.CASCADE,  # Maybe set null and allow for cleanup later?
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

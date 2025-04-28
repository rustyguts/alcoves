import uuid

from django.contrib.auth.models import User
from django.core.validators import FileExtensionValidator
from django.db import models


def get_upload_path(instance, filename):
    return f"assets/{instance.id}/{filename}"


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    filename = models.CharField(max_length=255)
    file = models.FileField(
        upload_to=get_upload_path,
        validators=[
            FileExtensionValidator(
                allowed_extensions=["jpg", "jpeg", "png", "gif", "heic", "avif", "webp"]
            )
        ],
        blank=True,
        null=True,
    )
    owner = models.ForeignKey(
        User,
        related_name="assets",
        on_delete=models.CASCADE,  # Maybe set null and allow for cleanup later?
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

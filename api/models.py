import uuid

from django.contrib.auth.models import User
from django.db import models
from django.db.models.signals import post_save
from django.dispatch import receiver


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    filename = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Library(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    assets = models.ManyToManyField(Asset, blank=True)
    owner = models.OneToOneField(User, on_delete=models.CASCADE, related_name="library")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def delete(self, *args, **kwargs):
        if self.assets.exists():
            raise Exception("Cannot delete library that contains assets.")
        return super().delete(*args, **kwargs)


@receiver(post_save, sender=User)
def create_user_library(sender, instance, created, **kwargs):
    if created:
        Library.objects.create(owner=instance)

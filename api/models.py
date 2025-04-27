import uuid
from django.db import models


# Create your models here.


class Asset(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    filename = models.CharField(max_length=255)
    # Add other fields like upload_date, user, file_path etc. later


# @receiver(post_save, sender=User)
# def create_user_library(sender, instance, created, **kwargs):
#     if created:
#         Library.objects.create(owner=instance)

from django.urls import path

from . import views

urlpatterns = [
    path("api/", views.root, name="root"),
    path("api/upload", views.upload_file, name="upload_file"),
]

from django.urls import path

from . import views

urlpatterns = [
    path("api/", views.root, name="root"),
    # path("api/assets", views.get_assets, name="get_assets"),
    path("api/upload", views.upload_file, name="upload_file"),
]

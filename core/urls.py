from django.contrib.auth import views as auth_views
from django.urls import include, path

from . import views

urlpatterns = [
    path("favicon.ico", views.favicon, name="favicon"),
    path("", views.home, name="home"),
    path(
        "accounts/login/",
        auth_views.LoginView.as_view(template_name="login.jinja"),
        name="login",
    ),
    path("accounts/register/", views.register, name="register"),
    path("accounts/", include("django.contrib.auth.urls")),
    path("assets/timeline/", views.asset_timeline, name="asset_timeline"),
    path("image-preview/<uuid:asset_id>/", views.image_preview, name="image_preview"),
]

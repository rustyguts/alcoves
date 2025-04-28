from django.urls import path, include
from django.contrib.auth import views as auth_views
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path(
        "accounts/login/",
        auth_views.LoginView.as_view(template_name="login.jinja"),
        name="login",
    ),
    path("accounts/register/", views.register, name="register"),
    path("accounts/", include("django.contrib.auth.urls")),
]

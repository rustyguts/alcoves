from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.template import loader
from django.shortcuts import render, redirect
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth import login


def register(request):
    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)  # Log the user in after registration
            return redirect(
                "home"
            )  # Redirect to home page after successful registration
    else:
        form = UserCreationForm()
    return render(request, "register.html", {"form": form})


@login_required
def home(request):
    template = loader.get_template("home.html")
    return HttpResponse(template.render({}, request))

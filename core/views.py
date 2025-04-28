from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.shortcuts import redirect, render
from django.views.decorators.http import require_http_methods

from core.forms import UploadForm


@login_required
def home(request):
    assets = request.user.assets.all().order_by("-created_at")
    return render(request, "home.jinja", {"assets": assets, "form": UploadForm()})


@login_required
@require_http_methods(["POST"])
def create_asset(request):
    form = UploadForm(request.POST, request.FILES, initial={"user": request.user})
    if form.is_valid():
        asset = form.save(commit=False)
        asset.owner = request.user
        asset.save()
        response = render(request, "partials/asset-item.jinja", {"asset": asset})
        response["HX-Trigger"] = "asset-created"
        return response
    else:
        response = render(request, "partials/upload-modal.jinja", {"form": form})
        response["HX-Retarget"] = "#upload_modal"
        response["HX-Reswap"] = "outerHTML"
        response["HX-Trigger-After-Settle"] = "fail"
        return response


def register(request):
    if request.method == "POST":
        form = UserCreationForm(request.POST)
        if form.is_valid():
            user = form.save()
            login(request, user)
            return redirect("home")
    else:
        form = UserCreationForm()
    return render(request, "register.jinja", {"form": form})

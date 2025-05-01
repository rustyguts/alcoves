from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.core.paginator import Paginator
from django.shortcuts import redirect, render

from api.models import Asset


def _get_optimized_page(queryset, page_number, per_page=40):
    try:
        page_number = int(page_number)
    except (ValueError, TypeError):
        page_number = 1

    offset = (page_number - 1) * per_page
    page_items = queryset[offset : offset + per_page]
    paginator = Paginator(queryset, per_page)
    page = paginator.page(page_number)
    page.object_list = page_items

    return page


@login_required
def home(request):
    assets_queryset = request.user.assets.all().order_by("-created_at")
    page_number = request.GET.get("page", 1)
    page_obj = _get_optimized_page(assets_queryset, page_number)
    return render(request, "home.jinja", {"page_obj": page_obj})


@login_required
def asset_timeline(request):
    assets_queryset = request.user.assets.all().order_by("-created_at")
    page_number = request.GET.get("page", 1)
    page_obj = _get_optimized_page(assets_queryset, page_number)
    return render(request, "partials/asset-items-page.jinja", {"page_obj": page_obj})


@login_required
def image_preview(request, asset_id):
    try:
        asset = request.user.assets.get(id=asset_id)
    except Asset.DoesNotExist:
        return HttpResponse(status=404)

    user_assets = request.user.assets.all().order_by("-created_at")
    asset_ids = list(user_assets.values_list("id", flat=True))

    try:
        current_index = asset_ids.index(asset.id)
    except ValueError:
        return HttpResponse(status=500)

    previous_asset_id = asset_ids[current_index - 1] if current_index > 0 else None
    next_asset_id = (
        asset_ids[current_index + 1] if current_index < len(asset_ids) - 1 else None
    )

    context = {
        "asset": asset,
        "previous_asset_id": previous_asset_id,
        "next_asset_id": next_asset_id,
    }
    return render(request, "partials/image-preview.jinja", context)


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

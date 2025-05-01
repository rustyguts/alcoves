from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.forms import UserCreationForm
from django.core.paginator import Paginator
from django.shortcuts import redirect, render


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

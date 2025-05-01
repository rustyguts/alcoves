import os
from datetime import datetime, timedelta
from uuid import NAMESPACE_URL, uuid5

import pyvips
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.http import FileResponse, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.http import require_http_methods

from api.models import Asset


def root(request):
    return JsonResponse(
        {
            "message": "hi",
            "status": "success",
        }
    )


@require_http_methods(["GET"])
def get_asset_proxy(request, asset_id):
    try:
        asset = Asset.objects.get(id=asset_id)

        resize_width = int(request.GET.get("width", 300))
        resize_quality = int(request.GET.get("quality", 80))

        original_image = pyvips.Image.new_from_file(asset.file.path)
        original_width = original_image.width

        if resize_width > original_width:
            resize_width = original_width

        cache_key_hash = f"{asset.file.path}_{resize_width}_{resize_quality}"
        cache_uuid = uuid5(NAMESPACE_URL, cache_key_hash)
        cache_dir = os.path.join(settings.MEDIA_ROOT, "cache")
        cache_path = f"{os.path.join(cache_dir, str(cache_uuid))}.jpg"

        if not os.path.exists(cache_path):
            print(f"Cache miss for {cache_path}")
            os.makedirs(os.path.dirname(cache_path), exist_ok=True)

            vips_image = pyvips.Image.thumbnail(asset.file.path, resize_width)
            vips_image.jpegsave(cache_path, Q=resize_quality, interlace=True)

            cache.set(cache_key_hash, cache_path, timeout=None)

        response = FileResponse(
            open(cache_path, "rb"),
            content_type="image/jpeg",
        )

        # Add Vary header to instruct browsers to cache based on query parameters
        response["Vary"] = "Accept-Encoding, width, quality"

        # Add ETag header based on the width and quality
        etag = f'W/"{cache_uuid}"'
        response["ETag"] = etag

        # Check if the client sent an If-None-Match header and it matches our ETag
        if_none_match = request.META.get("HTTP_IF_NONE_MATCH")
        if if_none_match and if_none_match == etag:
            # Return 304 Not Modified to use browser cache
            response = JsonResponse({}, status=304)
            return response

        # Set relatively short cache time to allow for changes
        cache_max_age = 60 * 60 * 24  # 1 day
        expires = timezone.now() + timedelta(seconds=cache_max_age)

        response["Cache-Control"] = f"public, max-age={cache_max_age}, must-revalidate"
        response["Expires"] = expires.strftime("%a, %d %b %Y %H:%M:%S GMT")
        response["Last-Modified"] = datetime.fromtimestamp(
            os.path.getmtime(cache_path)
        ).strftime("%a, %d %b %Y %H:%M:%S GMT")

        return response
    except Asset.DoesNotExist:
        return JsonResponse({"error": "Asset not found"}, status=404)


@login_required
@require_http_methods(["POST"])
def upload_file(request):
    files = request.FILES.getlist("files[]")
    assets = []

    for uploaded_file in files:
        asset = Asset(
            file=uploaded_file,
            owner=request.user,
            filename=uploaded_file.name,
        )
        asset.save()
        assets.append(asset)

    if request.headers.get("x-requested-with") == "XMLHttpRequest":
        return JsonResponse({"success": True, "files": []})
    else:
        return redirect("/")

import os
from uuid import NAMESPACE_URL, uuid5

import pyvips
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, JsonResponse
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

        cache_uuid = uuid5(NAMESPACE_URL, asset.file.path)
        cache_path = f"/data/media/cache/{cache_uuid}.jpg"
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)

        vips_image = pyvips.Image.new_from_file(asset.file.path)
        vips_image.jpegsave(cache_path, Q=80, interlace=True)
        return FileResponse(
            open(cache_path, "rb"),
            content_type="image/jpeg",
        )
    except Asset.DoesNotExist:
        return JsonResponse({"error": "Asset not found"}, status=404)


# @csrf_exempt
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

    # response = render(request, "partials/asset-timeline.jinja", {"assets": assets})
    response = JsonResponse({"success": True, "files": []})
    # response["HX-Trigger"] = "assets-created"
    # response["HX-Refresh"] = "true"
    return response

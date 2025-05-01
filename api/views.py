from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods

from api.models import Asset


def root(request):
    return JsonResponse(
        {
            "message": "hi",
            "status": "success",
        }
    )


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
    response["HX-Refresh"] = "true"
    return response

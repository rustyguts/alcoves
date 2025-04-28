from django.http import JsonResponse
from django.views.decorators.http import require_POST

from api.models import Asset


def root(request):
    return JsonResponse(
        {
            "message": "hi",
            "status": "success",
        }
    )


# @require_GET
# @login_required
# def get_assets(request):
#     """
#     Retrieve all assets owned by the authenticated user.
#     """
#     try:
#         # assets = Asset.objects.filter(owner=request.user)
#         assets = Asset.objects.all()
#         asset_list = [
#             {
#                 "id": str(asset.id),
#                 "filename": asset.filename,
#             }
#             for asset in assets
#         ]
#         return JsonResponse(
#             {
#                 "assets": asset_list,
#                 "status": "success",
#             },
#             status=200,
#         )
#     except Exception as e:
#         # Log the exception e
#         print(f"Error retrieving assets: {e}")
#         return JsonResponse({"error": "Failed to retrieve assets"}, status=500)


@require_POST  # Ensure this view only accepts POST requests
def upload_file(request):
    if "file" not in request.FILES:
        return JsonResponse({"error": "No file provided"}, status=400)

    uploaded_file = request.FILES["file"]

    # Basic validation (add more as needed)
    if not uploaded_file.name:
        return JsonResponse({"error": "File name missing"}, status=400)

    # You might want to save the file somewhere, e.g., MEDIA_ROOT
    # For now, just create the Asset record
    try:
        asset = Asset.objects.create(filename=uploaded_file.name)
        # In a real app, save the file to disk/cloud storage here
        # e.g., with default_storage.save(f'uploads/{asset.id}/{uploaded_file.name}', uploaded_file)
        return JsonResponse(
            {
                "message": "File uploaded successfully",
                "asset_id": str(asset.id),
                "filename": asset.filename,
                "status": "success",
            },
            status=201,
        )
    except Exception as e:
        # Log the exception e
        print(f"Error creating asset: {e}")  # Basic logging
        return JsonResponse({"error": "Failed to process file"}, status=500)

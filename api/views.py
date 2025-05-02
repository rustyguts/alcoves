import logging
import os
from uuid import NAMESPACE_URL, uuid5

from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.views.decorators.http import require_http_methods
from PIL import Image, ImageOps

from api.models import Asset

logger = logging.getLogger(__name__)


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
        logger.warning(f"Processing asset: {asset_id}")

        # Default parameters
        default_quality = 80
        max_width = 3000
        max_height = 2000

        # Get request parameters
        width = request.GET.get("width")
        height = request.GET.get("height")
        quality = int(request.GET.get("quality", default_quality))
        fit = request.GET.get("fit", "cover" if (width and height) else "scale-down")

        # Register HEIF opener for Pillow
        from pillow_heif import register_heif_opener

        register_heif_opener()

        # Open the image with Pillow (now supports HEIC thanks to pillow-heif)
        img = Image.open(asset.file.path)

        # Handle EXIF orientation
        # This will automatically rotate the image based on EXIF data
        img = ImageOps.exif_transpose(img)

        # Calculate dimensions
        orig_width, orig_height = img.size

        if width and height:
            target_width = min(int(width), max_width)
            target_height = min(int(height), max_height)
        elif width:
            target_width = min(int(width), max_width)
            target_height = int((target_width / orig_width) * orig_height)
        elif height:
            target_height = min(int(height), max_height)
            target_width = int((target_height / orig_height) * orig_width)
        else:
            target_width = min(orig_width, max_width)
            target_height = min(orig_height, max_height)

        # Create a unique cache path
        output_format = "jpg"
        cache_key = f"{asset.file.path}_{target_width}_{target_height}_{quality}_{fit}_{output_format}"
        cache_id = uuid5(NAMESPACE_URL, cache_key)
        cache_dir = os.path.join(settings.MEDIA_ROOT, "cache")
        cache_path = os.path.join(cache_dir, f"{cache_id}.{output_format}")

        # Create cache directory if it doesn't exist
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)

        # Process image if not in cache
        if not os.path.exists(cache_path):
            # Resize based on fit mode
            if fit == "cover" and width and height:
                # Calculate aspect ratios
                target_ratio = target_width / target_height
                orig_ratio = orig_width / orig_height

                if orig_ratio > target_ratio:
                    # Original is wider, crop width
                    resize_height = target_height
                    resize_width = int(resize_height * orig_ratio)
                    resized = img.resize(
                        (resize_width, resize_height), Image.Resampling.LANCZOS
                    )

                    # Center crop
                    left = (resize_width - target_width) // 2
                    final = resized.crop((left, 0, left + target_width, target_height))
                else:
                    # Original is taller, crop height
                    resize_width = target_width
                    resize_height = int(resize_width / orig_ratio)
                    resized = img.resize(
                        (resize_width, resize_height), Image.Resampling.LANCZOS
                    )

                    # Center crop
                    top = (resize_height - target_height) // 2
                    final = resized.crop((0, top, target_width, top + target_height))
            elif fit == "scale-down":
                # Only scale down, never up
                if orig_width <= target_width and orig_height <= target_height:
                    final = img
                else:
                    scale = min(target_width / orig_width, target_height / orig_height)
                    new_width = int(orig_width * scale)
                    new_height = int(orig_height * scale)
                    final = img.resize(
                        (new_width, new_height), Image.Resampling.LANCZOS
                    )
            else:
                # Simple resize
                final = img.resize(
                    (target_width, target_height), Image.Resampling.LANCZOS
                )

            # Convert to RGB if needed
            if final.mode in ("RGBA", "LA") or (
                final.mode == "P" and "transparency" in final.info
            ):
                final = final.convert("RGB")

            logger.warning(f"Saving image to cache: {cache_path}")
            final.save(
                cache_path, "JPEG", quality=quality, optimize=True, progressive=True
            )

        # Serve the file
        logger.warning(f"Serving cached image: {cache_path}")
        response = FileResponse(open(cache_path, "rb"), content_type="image/jpeg")

        # Add basic cache headers
        cache_max_age = 60 * 60 * 24  # 1 day
        response["Cache-Control"] = f"public, max-age={cache_max_age}"
        response["ETag"] = f'W/"{cache_id}"'

        # Return 304 if ETag matches
        if_none_match = request.META.get("HTTP_IF_NONE_MATCH")
        if if_none_match and if_none_match == response["ETag"]:
            return HttpResponse(status=304)

        return response

    except Asset.DoesNotExist:
        return JsonResponse({"error": "Asset not found"}, status=404)
    except ValueError as e:
        return JsonResponse({"error": f"Invalid parameter: {str(e)}"}, status=400)
    except Exception as e:
        logger.error(f"Error processing image: {str(e)}")
        return JsonResponse({"error": "Server error"}, status=500)


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

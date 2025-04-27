from django.shortcuts import render
from django.http import HttpResponse
from django.http import JsonResponse


def root(request):
    return JsonResponse(
        {
            "message": "hi",
            "status": "success",
        }
    )

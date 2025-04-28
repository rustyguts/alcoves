from django import forms

from api.models import Asset


class UploadForm(forms.ModelForm):
    file = forms.FileField(
        widget=forms.FileInput(
            attrs={
                "class": "file-input file-input-bordered w-full",
            }
        ),
        required=True,
    )

    # Add a clean method
    # https://www.youtube.com/watch?v=OkalF8q7Xss&list=PL4cUxeGkcC9hgO93oEHPBMuLA20y0SBVK&index=10

    class Meta:
        model = Asset
        fields = ("file",)

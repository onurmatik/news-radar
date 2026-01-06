from django.urls import path

from .views import SimilarContentView

urlpatterns = [
    path("similar-content/", SimilarContentView.as_view(), name="similar-content"),
]
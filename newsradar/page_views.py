from django.shortcuts import render


def dashboard(request):
    return render(request, "dashboard.html", {"page": "dashboard"})


def topics(request):
    return render(request, "topics.html", {"page": "topics"})


def upgrade(request):
    return render(request, "upgrade.html", {"page": "upgrade"})


def developer_access(request):
    return render(request, "developer_access.html", {"page": "developer-access"})


def content_detail(request, content_id: int):
    return render(
        request,
        "content_detail.html",
        {
            "page": "content-detail",
            "content_id": content_id,
        },
    )

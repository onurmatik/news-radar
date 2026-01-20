from django.contrib import admin

from .models import Bookmark, Content


@admin.register(Content)
class ContentAdmin(admin.ModelAdmin):
    list_display = ("id", "execution", "url", "title", "date", "last_updated", "created_at")
    search_fields = ("execution__topic__text", "execution__topic__queries", "url", "title")
    list_select_related = ("execution", "execution__topic")


@admin.register(Bookmark)
class BookmarkAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "content", "created_at")
    list_select_related = ("user", "content")
    search_fields = ("user__username", "content__url", "content__title")

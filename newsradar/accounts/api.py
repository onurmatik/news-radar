from urllib.parse import parse_qsl, urlencode

from django.conf import settings
from django.contrib.auth import get_user_model, logout
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.core.validators import validate_email
from django.db import IntegrityError
from django.urls import reverse
from django.utils.crypto import get_random_string
from ninja import NinjaAPI, Schema
from ninja.errors import HttpError
from sesame.utils import get_query_string


api = NinjaAPI(title="Accounts API", urls_namespace="accounts")


class MagicLinkRequest(Schema):
    email: str
    redirect_url: str | None = None


class MagicLinkResponse(Schema):
    sent: bool


class CurrentUserResponse(Schema):
    id: int
    username: str
    email: str


class LogoutResponse(Schema):
    logged_out: bool


def _build_username(user_model, email: str) -> str:
    username_field = user_model.USERNAME_FIELD
    field = user_model._meta.get_field(username_field)
    max_length = getattr(field, "max_length", None)
    base = email.strip()
    if max_length and len(base) > max_length:
        base = base[:max_length]
    candidate = base
    while user_model._default_manager.filter(**{username_field: candidate}).exists():
        suffix = get_random_string(4).lower()
        trimmed = base
        if max_length:
            trimmed = base[: max_length - len(suffix) - 1]
        candidate = f"{trimmed}-{suffix}"
    return candidate


def _build_magic_link(request, user, redirect_url: str | None) -> str:
    login_path = reverse("sesame-login")
    login_url = request.build_absolute_uri(login_path)
    query_string = get_query_string(user)
    if query_string.startswith("?"):
        query_string = query_string[1:]
    params = dict(parse_qsl(query_string, keep_blank_values=True))
    if redirect_url:
        params["next"] = redirect_url
    return f"{login_url}?{urlencode(params)}"


@api.post("/magic-link", response=MagicLinkResponse)
def request_magic_link(request, payload: MagicLinkRequest):
    email = payload.email.strip().lower() if isinstance(payload.email, str) else ""
    if not email:
        raise HttpError(400, "Email address is required.")
    try:
        validate_email(email)
    except ValidationError as exc:
        raise HttpError(400, "Enter a valid email address.") from exc

    User = get_user_model()
    user = User.objects.filter(email__iexact=email).first()
    if not user:
        try:
            username = _build_username(User, email)
            user = User.objects.create_user(**{
                User.USERNAME_FIELD: username,
                User.EMAIL_FIELD: email,
            })
        except IntegrityError as exc:
            raise HttpError(400, "Unable to create account for that email.") from exc

    redirect_url = payload.redirect_url or settings.FRONTEND_BASE_URL or None
    magic_link = _build_magic_link(request, user, redirect_url)

    subject = "Your NewsRadar sign-in link"
    message = (
        "Use the link below to sign in to NewsRadar:\n\n"
        f"{magic_link}\n\n"
        "If you didn't request this email, you can ignore it."
    )

    try:
        send_mail(
            subject,
            message,
            settings.DEFAULT_FROM_EMAIL,
            [email],
            fail_silently=False,
        )
    except Exception as exc:
        raise HttpError(500, "Unable to send sign-in email right now.") from exc

    return MagicLinkResponse(sent=True)


@api.get("/me", response=CurrentUserResponse)
def current_user(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")
    return CurrentUserResponse(
        id=request.user.id,
        username=request.user.get_username(),
        email=request.user.email or "",
    )


@api.post("/logout", response=LogoutResponse)
def logout_user(request):
    if request.user.is_authenticated:
        logout(request)
    return LogoutResponse(logged_out=True)

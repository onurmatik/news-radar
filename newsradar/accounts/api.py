from datetime import datetime
from typing import Literal
from urllib.parse import parse_qsl, urlencode, urlparse

import stripe
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

from newsradar.accounts.models import Profile

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
    is_pro: bool
    pro_plan: Literal["monthly", "yearly"] | None = None


class CheckoutSessionRequest(Schema):
    plan: Literal["monthly", "yearly"]
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutSessionResponse(Schema):
    checkout_url: str


class LogoutResponse(Schema):
    logged_out: bool


class ApiAccessResponse(Schema):
    is_pro: bool
    api_key: str | None = None
    key_created_at: datetime | None = None


class ApiAccessRotateResponse(Schema):
    api_key: str
    key_created_at: datetime


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


def _get_frontend_origin() -> str | None:
    frontend_url = (settings.FRONTEND_BASE_URL or "").strip()
    if not frontend_url:
        return None
    parsed = urlparse(frontend_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    return f"{parsed.scheme}://{parsed.netloc}"


def _is_allowed_checkout_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    frontend_origin = _get_frontend_origin()
    if not frontend_origin:
        return True
    return parsed.netloc == urlparse(frontend_origin).netloc


def _default_success_url() -> str:
    configured = (settings.STRIPE_CHECKOUT_SUCCESS_URL or "").strip()
    if configured:
        return configured
    frontend_origin = _get_frontend_origin()
    if frontend_origin:
        return f"{frontend_origin}/upgrade?checkout=success"
    return "http://localhost:5173/upgrade?checkout=success"


def _default_cancel_url() -> str:
    configured = (settings.STRIPE_CHECKOUT_CANCEL_URL or "").strip()
    if configured:
        return configured
    frontend_origin = _get_frontend_origin()
    if frontend_origin:
        return f"{frontend_origin}/upgrade?checkout=cancelled"
    return "http://localhost:5173/upgrade?checkout=cancelled"


def _resolve_checkout_url(provided: str | None, fallback: str, field_name: str) -> str:
    resolved = (provided or fallback).strip()
    if not resolved:
        raise HttpError(400, f"{field_name} is required.")
    if not _is_allowed_checkout_url(resolved):
        raise HttpError(400, f"{field_name} host is not allowed.")
    return resolved


def _get_price_id(plan: Literal["monthly", "yearly"]) -> str:
    if plan == Profile.PLAN_MONTHLY:
        return (settings.STRIPE_PRICE_ID_MONTHLY or "").strip()
    return (settings.STRIPE_PRICE_ID_YEARLY or "").strip()


def _build_line_item(plan: Literal["monthly", "yearly"]) -> dict:
    price_id = _get_price_id(plan)
    if price_id:
        return {"price": price_id, "quantity": 1}

    if plan == Profile.PLAN_MONTHLY:
        interval = "month"
        unit_amount = 2000
        product_name = "NewsRadar Pro Monthly"
    else:
        interval = "year"
        unit_amount = 20000
        product_name = "NewsRadar Pro Yearly"

    return {
        "price_data": {
            "currency": "usd",
            "unit_amount": unit_amount,
            "product_data": {"name": product_name},
            "recurring": {"interval": interval},
        },
        "quantity": 1,
    }


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
    profile, _ = Profile.objects.get_or_create(user=request.user)
    profile.record_visit()
    return CurrentUserResponse(
        id=request.user.id,
        username=request.user.get_username(),
        email=request.user.email or "",
        is_pro=profile.is_pro,
        pro_plan=profile.pro_plan or None,
    )


@api.get("/api-access", response=ApiAccessResponse)
def api_access(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    profile, _ = Profile.objects.get_or_create(user=request.user)
    if not profile.is_pro:
        return ApiAccessResponse(is_pro=False, api_key=None, key_created_at=None)

    api_key = profile.ensure_api_key()
    return ApiAccessResponse(
        is_pro=True,
        api_key=api_key,
        key_created_at=profile.api_key_created_at,
    )


@api.post("/api-access/rotate", response=ApiAccessRotateResponse)
def rotate_api_access_key(request):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    profile, _ = Profile.objects.get_or_create(user=request.user)
    if not profile.is_pro:
        raise HttpError(403, "Upgrade to Pro to get your API key.")

    api_key = profile.rotate_api_key()
    return ApiAccessRotateResponse(
        api_key=api_key,
        key_created_at=profile.api_key_created_at,
    )


@api.post("/billing/checkout", response=CheckoutSessionResponse)
def create_billing_checkout_session(request, payload: CheckoutSessionRequest):
    if not request.user.is_authenticated:
        raise HttpError(401, "Authentication required.")

    stripe_secret_key = (settings.STRIPE_SECRET_KEY or "").strip()
    if not stripe_secret_key:
        raise HttpError(500, "Stripe is not configured.")

    success_url = _resolve_checkout_url(
        payload.success_url,
        _default_success_url(),
        "success_url",
    )
    cancel_url = _resolve_checkout_url(
        payload.cancel_url,
        _default_cancel_url(),
        "cancel_url",
    )

    profile, _ = Profile.objects.get_or_create(user=request.user)
    stripe.api_key = stripe_secret_key

    checkout_args = {
        "mode": "subscription",
        "line_items": [_build_line_item(payload.plan)],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {
            "user_id": str(request.user.id),
            "plan": payload.plan,
        },
        "subscription_data": {
            "metadata": {
                "user_id": str(request.user.id),
                "plan": payload.plan,
            }
        },
        "allow_promotion_codes": True,
    }
    if profile.stripe_customer_id:
        checkout_args["customer"] = profile.stripe_customer_id
    elif request.user.email:
        checkout_args["customer_email"] = request.user.email

    try:
        session = stripe.checkout.Session.create(**checkout_args)
    except stripe.error.StripeError as exc:
        raise HttpError(502, "Unable to start Stripe checkout right now.") from exc

    checkout_url = getattr(session, "url", None)
    if not checkout_url:
        raise HttpError(502, "Stripe checkout URL is unavailable.")
    return CheckoutSessionResponse(checkout_url=checkout_url)


@api.post("/logout", response=LogoutResponse)
def logout_user(request):
    if request.user.is_authenticated:
        logout(request)
    return LogoutResponse(logged_out=True)

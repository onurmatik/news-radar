import json
from datetime import datetime, timezone as dt_timezone
from urllib.parse import urlparse

import stripe
from django.conf import settings
from django.http import HttpRequest, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from sesame.views import LoginView

from newsradar.accounts.models import Profile


class SesameLoginView(LoginView):
    def get_success_url_allowed_hosts(self):
        allowed_hosts = super().get_success_url_allowed_hosts()
        frontend_url = getattr(settings, "FRONTEND_BASE_URL", "")
        if frontend_url:
            allowed_hosts.add(urlparse(frontend_url).netloc)
        if settings.DEBUG:
            next_url = self.request.GET.get(self.redirect_field_name)
            if next_url:
                next_host = urlparse(next_url).netloc
                if next_host:
                    allowed_hosts.add(next_host)
        return allowed_hosts

    def get_default_redirect_url(self):
        frontend_url = getattr(settings, "FRONTEND_BASE_URL", "")
        if frontend_url:
            return frontend_url
        return super().get_default_redirect_url()


def _to_datetime(timestamp: int | None) -> datetime | None:
    if not timestamp:
        return None
    return datetime.fromtimestamp(timestamp, tz=dt_timezone.utc)


def _plan_from_price_id(price_id: str | None) -> str:
    if not price_id:
        return ""
    if price_id == (settings.STRIPE_PRICE_ID_MONTHLY or "").strip():
        return Profile.PLAN_MONTHLY
    if price_id == (settings.STRIPE_PRICE_ID_YEARLY or "").strip():
        return Profile.PLAN_YEARLY
    return ""


def _get_profile_for_subscription(subscription: dict) -> Profile | None:
    metadata = subscription.get("metadata") or {}
    user_id = metadata.get("user_id")
    if user_id:
        try:
            return Profile.objects.select_related("user").get(user_id=int(user_id))
        except (ValueError, Profile.DoesNotExist):
            pass

    customer_id = subscription.get("customer")
    if customer_id:
        profile = Profile.objects.select_related("user").filter(
            stripe_customer_id=customer_id
        ).first()
        if profile:
            return profile

    subscription_id = subscription.get("id")
    if subscription_id:
        return Profile.objects.select_related("user").filter(
            stripe_subscription_id=subscription_id
        ).first()

    return None


def _save_profile_checkout_completed(session: dict) -> None:
    metadata = session.get("metadata") or {}
    user_id = metadata.get("user_id")
    if not user_id:
        return

    try:
        profile, _ = Profile.objects.select_related("user").get_or_create(user_id=int(user_id))
    except ValueError:
        return

    plan = metadata.get("plan")
    if plan not in {Profile.PLAN_MONTHLY, Profile.PLAN_YEARLY}:
        plan = ""

    profile.is_pro = True
    profile.pro_plan = plan
    profile.pro_started_at = profile.pro_started_at or timezone.now()
    profile.stripe_customer_id = session.get("customer") or profile.stripe_customer_id
    profile.stripe_subscription_id = (
        session.get("subscription") or profile.stripe_subscription_id
    )
    profile.save(
        update_fields=[
            "is_pro",
            "pro_plan",
            "pro_started_at",
            "stripe_customer_id",
            "stripe_subscription_id",
        ]
    )


def _save_profile_subscription_state(subscription: dict) -> None:
    profile = _get_profile_for_subscription(subscription)
    if not profile:
        return

    status = (subscription.get("status") or "").strip().lower()
    is_active = status in {"active", "trialing", "past_due", "unpaid"}

    price_id = None
    items = subscription.get("items") or {}
    for item in items.get("data", []):
        price = item.get("price") or {}
        if price.get("id"):
            price_id = price.get("id")
            break

    metadata = subscription.get("metadata") or {}
    plan = metadata.get("plan") or _plan_from_price_id(price_id)
    if plan not in {Profile.PLAN_MONTHLY, Profile.PLAN_YEARLY}:
        plan = ""

    profile.is_pro = is_active
    profile.pro_plan = plan if is_active else ""
    profile.pro_current_period_ends_at = _to_datetime(subscription.get("current_period_end"))
    profile.stripe_customer_id = subscription.get("customer") or profile.stripe_customer_id
    profile.stripe_subscription_id = subscription.get("id") or profile.stripe_subscription_id
    if is_active and profile.pro_started_at is None:
        profile.pro_started_at = timezone.now()

    profile.save(
        update_fields=[
            "is_pro",
            "pro_plan",
            "pro_started_at",
            "pro_current_period_ends_at",
            "stripe_customer_id",
            "stripe_subscription_id",
        ]
    )


@csrf_exempt
def stripe_webhook(request: HttpRequest) -> HttpResponse:
    if request.method != "POST":
        return HttpResponse(status=405)

    stripe_secret_key = (settings.STRIPE_SECRET_KEY or "").strip()
    if not stripe_secret_key:
        return HttpResponse(status=503)

    stripe.api_key = stripe_secret_key
    payload = request.body
    webhook_secret = (settings.STRIPE_WEBHOOK_SECRET or "").strip()

    try:
        if webhook_secret:
            signature = request.META.get("HTTP_STRIPE_SIGNATURE", "")
            event = stripe.Webhook.construct_event(payload, signature, webhook_secret)
        else:
            event = json.loads(payload.decode("utf-8"))
    except (ValueError, stripe.error.SignatureVerificationError):
        return HttpResponse(status=400)

    event_type = event.get("type", "")
    data_object = (event.get("data") or {}).get("object") or {}

    if event_type == "checkout.session.completed":
        _save_profile_checkout_completed(data_object)
    elif event_type in {
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }:
        _save_profile_subscription_state(data_object)

    return HttpResponse(status=200)

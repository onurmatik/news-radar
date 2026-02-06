from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from newsradar.accounts.models import Profile


class AccountsApiTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="tester",
            email="tester@example.com",
        )

    def test_me_includes_membership_fields(self):
        Profile.objects.create(
            user=self.user,
            is_pro=True,
            pro_plan=Profile.PLAN_YEARLY,
        )
        self.client.force_login(self.user)

        response = self.client.get("/api/auth/me")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["username"], "tester")
        self.assertEqual(payload["email"], "tester@example.com")
        self.assertTrue(payload["is_pro"])
        self.assertEqual(payload["pro_plan"], Profile.PLAN_YEARLY)

    @override_settings(
        STRIPE_SECRET_KEY="sk_test_123",
        STRIPE_PRICE_ID_MONTHLY="price_monthly_123",
        STRIPE_PRICE_ID_YEARLY="price_yearly_123",
        FRONTEND_BASE_URL="http://localhost:5173",
    )
    @patch("newsradar.accounts.api.stripe.checkout.Session.create")
    def test_create_checkout_session(self, mock_create_session):
        self.client.force_login(self.user)

        class Session:
            url = "https://checkout.stripe.com/c/pay_123"

        mock_create_session.return_value = Session()

        response = self.client.post(
            "/api/auth/billing/checkout",
            data={"plan": "monthly"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"checkout_url": "https://checkout.stripe.com/c/pay_123"},
        )

        _, kwargs = mock_create_session.call_args
        self.assertEqual(kwargs["mode"], "subscription")
        self.assertEqual(kwargs["line_items"][0]["price"], "price_monthly_123")
        self.assertEqual(
            kwargs["success_url"],
            "http://localhost:5173/upgrade?checkout=success",
        )
        self.assertEqual(
            kwargs["cancel_url"],
            "http://localhost:5173/upgrade?checkout=cancelled",
        )

    def test_checkout_requires_authentication(self):
        response = self.client.post(
            "/api/auth/billing/checkout",
            data={"plan": "monthly"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

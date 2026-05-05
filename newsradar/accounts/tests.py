import json
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
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

    @override_settings(FRONTEND_BASE_URL="http://localhost:8000")
    def test_magic_link_email_uses_clearer_copy(self):
        response = self.client.post(
            "/api/auth/magic-link",
            data=json.dumps({"email": "tester@example.com"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"sent": True})
        self.assertEqual(len(mail.outbox), 1)

        sent = mail.outbox[0]
        self.assertEqual(sent.subject, "Your NewsRadar magic link")
        self.assertIn("Hi there,", sent.body)
        self.assertIn("Use the secure link below to sign in to NewsRadar:", sent.body)
        self.assertIn("/api/auth/sesame/?", sent.body)
        self.assertIn("sign in instantly without a password", sent.body)
        self.assertIn("you can safely ignore it", sent.body)
        self.assertEqual(len(sent.alternatives), 1)
        html_body, mimetype = sent.alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn("Your secure magic link is ready", html_body)
        self.assertIn("Sign in to NewsRadar", html_body)
        self.assertIn('href="http://testserver/api/auth/sesame/?', html_body)
        self.assertIn("Copy and paste this URL into your browser", html_body)

    @override_settings(
        STRIPE_SECRET_KEY="sk_test_123",
        STRIPE_PRICE_ID_MONTHLY="price_monthly_123",
        STRIPE_PRICE_ID_YEARLY="price_yearly_123",
        FRONTEND_BASE_URL="http://localhost:8000",
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
            "http://localhost:8000/upgrade?checkout=success",
        )
        self.assertEqual(
            kwargs["cancel_url"],
            "http://localhost:8000/upgrade?checkout=cancelled",
        )

    def test_checkout_requires_authentication(self):
        response = self.client.post(
            "/api/auth/billing/checkout",
            data={"plan": "monthly"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    @override_settings(
        STRIPE_SECRET_KEY="sk_test_123",
        STRIPE_PRICE_ID_MONTHLY="",
        STRIPE_PRICE_ID_YEARLY="",
        FRONTEND_BASE_URL="http://localhost:8000",
    )
    @patch("newsradar.accounts.api.stripe.checkout.Session.create")
    def test_create_checkout_session_falls_back_to_inline_price_data(self, mock_create_session):
        self.client.force_login(self.user)

        class Session:
            url = "https://checkout.stripe.com/c/pay_123"

        mock_create_session.return_value = Session()

        response = self.client.post(
            "/api/auth/billing/checkout",
            data={"plan": "yearly"},
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 200)
        _, kwargs = mock_create_session.call_args
        line_item = kwargs["line_items"][0]
        self.assertEqual(line_item["quantity"], 1)
        self.assertEqual(line_item["price_data"]["currency"], "usd")
        self.assertEqual(line_item["price_data"]["unit_amount"], 20000)
        self.assertEqual(line_item["price_data"]["recurring"]["interval"], "year")
        self.assertEqual(line_item["price_data"]["product_data"]["name"], "NewsRadar Pro Yearly")

    def test_api_access_returns_upgrade_message_for_non_pro(self):
        self.client.force_login(self.user)

        response = self.client.get("/api/auth/api-access")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "is_pro": False,
                "api_key": None,
                "key_created_at": None,
            },
        )

    def test_api_access_returns_key_for_pro_user(self):
        Profile.objects.create(user=self.user, is_pro=True, pro_plan=Profile.PLAN_MONTHLY)
        self.client.force_login(self.user)

        response = self.client.get("/api/auth/api-access")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["is_pro"])
        self.assertTrue(payload["api_key"].startswith("nr_"))
        self.assertIsNotNone(payload["key_created_at"])
        profile = Profile.objects.get(user=self.user)
        self.assertEqual(payload["api_key"], profile.api_key)

    def test_rotate_api_access_key_requires_pro(self):
        self.client.force_login(self.user)

        response = self.client.post("/api/auth/api-access/rotate")

        self.assertEqual(response.status_code, 403)

    def test_rotate_api_access_key_changes_key(self):
        profile = Profile.objects.create(
            user=self.user,
            is_pro=True,
            pro_plan=Profile.PLAN_MONTHLY,
        )
        original_key = profile.rotate_api_key()
        self.client.force_login(self.user)

        response = self.client.post("/api/auth/api-access/rotate")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertNotEqual(payload["api_key"], original_key)
        profile.refresh_from_db()
        self.assertEqual(payload["api_key"], profile.api_key)

    def test_api_key_authenticates_me_endpoint_without_session(self):
        profile = Profile.objects.create(
            user=self.user,
            is_pro=True,
            pro_plan=Profile.PLAN_MONTHLY,
        )
        api_key = profile.rotate_api_key()

        response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {api_key}",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "tester@example.com")

    def test_non_pro_api_key_cannot_authenticate(self):
        profile = Profile.objects.create(user=self.user, is_pro=False)
        api_key = profile.rotate_api_key()

        response = self.client.get(
            "/api/auth/me",
            HTTP_AUTHORIZATION=f"Bearer {api_key}",
        )

        self.assertEqual(response.status_code, 401)

    def test_api_key_can_create_topic_on_existing_endpoint(self):
        profile = Profile.objects.create(user=self.user, is_pro=True, pro_plan=Profile.PLAN_MONTHLY)
        api_key = profile.rotate_api_key()

        response = self.client.post(
            "/api/topics/",
            data=json.dumps(
                {
                    "monitoring_prompt": "global supply chain",
                    "display_title": "Global supply chain",
                    "primary_query": "global supply chain",
                }
            ),
            content_type="application/json",
            HTTP_X_API_KEY=api_key,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["topic"]["queries"], ["global supply chain"])

from django.test import SimpleTestCase
from django.urls import reverse


class PageViewTests(SimpleTestCase):
    def test_dashboard_page_renders(self):
        response = self.client.get(reverse("dashboard"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Intelligence feed")
        self.assertContains(response, 'data-page="dashboard"')

    def test_topics_page_renders(self):
        response = self.client.get(reverse("topics"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="topic-form-root"')
        self.assertContains(response, 'data-page="topics"')

    def test_upgrade_page_renders(self):
        response = self.client.get(reverse("upgrade"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Upgrade to Pro")
        self.assertContains(response, 'data-page="upgrade"')

    def test_developer_access_page_renders(self):
        response = self.client.get(reverse("developer-access"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "API Access")
        self.assertContains(response, 'data-page="developer-access"')

    def test_content_detail_page_renders(self):
        response = self.client.get(reverse("content-detail", args=[123]))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'data-page="content-detail"')
        self.assertContains(response, 'data-content-id="123"')

import unittest

from app import app


class AppTestCase(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        self.client = app.test_client()

    def test_index_renders(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("指标实验台".encode("utf-8"), response.data)

    def test_search_by_name(self):
        response = self.client.get("/api/stocks/search?q=中芯")
        self.assertEqual(response.status_code, 200)
        symbols = {item["symbol"] for item in response.get_json()["items"]}
        self.assertIn("00981.HK", symbols)
        self.assertIn("688981.SH", symbols)

    def test_accepts_valid_custom_symbol(self):
        response = self.client.get("/api/stocks/search?q=00700.HK")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["items"][0]["symbol"], "00700.HK")

    def test_rejects_invalid_symbol(self):
        response = self.client.get("/api/prices/BAD?start=2025-07-02&end=2026-06-30")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["error"], "证券代码格式不正确")

    def test_rejects_invalid_date_range(self):
        response = self.client.get("/api/prices/00981.HK?start=2026-07-01&end=2026-06-30")
        self.assertEqual(response.status_code, 400)
        self.assertIn("开始日期", response.get_json()["error"])

    def test_seed_data_path(self):
        response = self.client.get("/api/prices/00981.HK?start=2025-07-02&end=2026-06-30")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["meta"]["symbol"], "00981.HK")
        self.assertGreater(len(payload["prices"]), 200)
        self.assertEqual(payload["prices"][0]["date"], "2025-07-02")
        self.assertEqual(payload["prices"][-1]["date"], "2026-06-30")

    def test_health_does_not_expose_token(self):
        response = self.client.get("/api/health/data-source")
        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("token", " ".join(payload.keys()).lower())


if __name__ == "__main__":
    unittest.main()


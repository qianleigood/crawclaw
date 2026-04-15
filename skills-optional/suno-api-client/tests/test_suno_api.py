import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT_PATH = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "suno_api.py"
spec = importlib.util.spec_from_file_location("suno_api", SCRIPT_PATH)
suno_api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suno_api)


class FakeResponse:
    def __init__(self, status, body):
        self.status = status
        self._body = body.encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class SunoApiTests(unittest.TestCase):
    def test_generate_builds_expected_request(self):
        captured = {}

        def fake_urlopen(req, timeout):
            captured["url"] = req.full_url
            captured["method"] = req.get_method()
            captured["timeout"] = timeout
            captured["cookie"] = req.get_header("Cookie")
            captured["content_type"] = req.get_header("Content-type")
            captured["body"] = json.loads(req.data.decode("utf-8"))
            return FakeResponse(200, '{"ok": true}')

        with patch.object(suno_api.urllib.request, "urlopen", side_effect=fake_urlopen):
            status, data = suno_api._request(
                "POST",
                "/api/generate",
                payload={"prompt": "夜色", "model": "chirp-v4", "continue_at": None},
                cookie="session=abc",
                timeout=9,
            )

        self.assertEqual(status, 200)
        self.assertEqual(data, {"ok": True})
        self.assertEqual(captured["url"], f"{suno_api.DEFAULT_BASE_URL}/api/generate")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["timeout"], 9)
        self.assertEqual(captured["cookie"], "session=abc")
        self.assertEqual(captured["content_type"], "application/json")
        self.assertEqual(captured["body"], {"prompt": "夜色", "model": "chirp-v4"})

    def test_http_error_returns_status_and_json_body(self):
        error = suno_api.urllib.error.HTTPError(
            url="http://localhost:3001/api/get_limit",
            code=429,
            msg="Too Many Requests",
            hdrs=None,
            fp=io.BytesIO(b'{"detail":"rate limited"}'),
        )

        with patch.object(suno_api.urllib.request, "urlopen", side_effect=error):
            status, data = suno_api._request("GET", "/api/get_limit")

        self.assertEqual(status, 429)
        self.assertEqual(data, {"detail": "rate limited"})

    def test_url_error_returns_structured_failure(self):
        error = suno_api.urllib.error.URLError("connection refused")

        with patch.object(suno_api.urllib.request, "urlopen", side_effect=error):
            status, data = suno_api._request("GET", "/api/get_limit")

        self.assertEqual(status, 0)
        self.assertEqual(data["error"], "url_error")
        self.assertIn("connection refused", data["reason"])
        self.assertTrue(data["url"].endswith("/api/get_limit"))

    def test_persona_command_uses_query_string(self):
        with patch.object(suno_api, "_request", return_value=(200, {"persona": 1})) as mock_request:
            with redirect_stdout(io.StringIO()) as out:
                suno_api.cmd_persona(SimpleNamespace(id="persona_123", page=2, cookie=None, timeout=5))

        mock_request.assert_called_once_with(
            "GET",
            "/api/persona?id=persona_123&page=2",
            cookie=None,
            timeout=5,
        )
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["status"], 200)
        self.assertEqual(parsed["data"], {"persona": 1})

    def test_generate_stems_command_posts_audio_id(self):
        with patch.object(suno_api, "_request", return_value=(200, {"job": "queued"})) as mock_request:
            with redirect_stdout(io.StringIO()) as out:
                suno_api.cmd_generate_stems(
                    SimpleNamespace(
                        audio_id="song_42",
                        cookie="c=1",
                        timeout=7,
                        only_gen=False,
                        include_page_url=False,
                        download_dir=None,
                        fields=None,
                    )
                )

        mock_request.assert_called_once_with(
            "POST",
            "/api/generate_stems",
            payload={"audio_id": "song_42"},
            cookie="c=1",
            timeout=7,
        )
        parsed = json.loads(out.getvalue())
        self.assertEqual(parsed["data"], {"job": "queued"})

    def test_filter_only_gen_removes_preview(self):
        items = [
            {"id": "1", "type": "gen", "model_name": "chirp-auk"},
            {"id": "2", "type": "preview", "model_name": "chirp-fenix"},
        ]
        filtered = suno_api._filter_items(items, only_gen=True)
        self.assertEqual(filtered, [{"id": "1", "type": "gen", "model_name": "chirp-auk"}])

    def test_include_page_url_appends_song_url(self):
        item = {"id": "abc123", "title": "demo"}
        enriched = suno_api._enrich_items(item, include_page_url=True)
        self.assertEqual(enriched["page_url"], "https://suno.com/song/abc123")

    def test_download_items_writes_audio_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            items = [{"id": "song_1", "title": "春日一下", "audio_url": "https://cdn.test/song.mp3"}]

            def fake_download(url, output_path, timeout):
                pathlib.Path(output_path).write_bytes(b"mp3data")

            with patch.object(suno_api, "_download_file", side_effect=fake_download):
                result = suno_api._download_items(items, tmpdir, timeout=5)

            self.assertEqual(result[0]["download_status"], "downloaded")
            self.assertTrue(result[0]["downloaded_audio_path"].endswith(".mp3"))
            self.assertTrue(pathlib.Path(result[0]["downloaded_audio_path"]).exists())

    def test_filter_fields_keeps_only_selected_keys(self):
        items = [{"id": "1", "status": "complete", "audio_url": "u", "page_url": "p"}]
        filtered = suno_api._filter_fields(items, "id,status")
        self.assertEqual(filtered, [{"id": "1", "status": "complete"}])

    def test_effective_timeout_prefers_wait_audio_timeout(self):
        args = SimpleNamespace(wait_audio=True, wait_audio_timeout=55, timeout=10)
        self.assertEqual(suno_api._effective_timeout(args), 55)
        args = SimpleNamespace(wait_audio=False, wait_audio_timeout=55, timeout=10)
        self.assertEqual(suno_api._effective_timeout(args), 10)

    def test_parser_accepts_extended_options(self):
        parser = suno_api.build_parser()
        args = parser.parse_args(["persona", "--id", "persona_123", "--page", "3"])
        self.assertEqual(args.command, "persona")
        self.assertEqual(args.id, "persona_123")
        self.assertEqual(args.page, 3)

        args = parser.parse_args([
            "generate-stems",
            "--audio-id",
            "song_42",
            "--include-page-url",
            "--download-dir",
            "/tmp/out",
            "--fields",
            "id,status",
        ])
        self.assertEqual(args.command, "generate-stems")
        self.assertEqual(args.audio_id, "song_42")
        self.assertTrue(args.include_page_url)
        self.assertEqual(args.download_dir, "/tmp/out")
        self.assertEqual(args.fields, "id,status")

        args = parser.parse_args(["generate", "--prompt", "test", "--only-gen", "--wait-audio-timeout", "90"])
        self.assertEqual(args.command, "generate")
        self.assertTrue(args.only_gen)
        self.assertEqual(args.wait_audio_timeout, 90)


if __name__ == "__main__":
    unittest.main()

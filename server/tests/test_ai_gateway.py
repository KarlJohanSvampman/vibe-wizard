import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from server import ai_gateway


class AudioGatewayTests(unittest.TestCase):
    def setUp(self) -> None:
        ai_gateway.JOBS.clear()
        self.client = TestClient(ai_gateway.app)

    def tearDown(self) -> None:
        ai_gateway.JOBS.clear()

    def test_health_reports_configured_provider_family(self) -> None:
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["provider"], "elevenlabs")

    def test_requires_server_side_api_key(self) -> None:
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": ""}, clear=False):
            response = self.client.post(
                "/api/audio/generations",
                json={"prompt": "Warm analog pad", "durationSeconds": 4},
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("ELEVENLABS_API_KEY", response.json()["detail"])

    def test_creates_job_polls_and_downloads_generated_audio(self) -> None:
        async def fake_provider_call(request: ai_gateway.GenerateAudioRequest) -> tuple[bytes, str]:
            self.assertEqual(request.prompt, "Warm analog pad")
            self.assertEqual(request.duration_seconds, 4)
            return b"fake-audio-bytes", "audio/mpeg"

        with (
            patch.dict(os.environ, {"ELEVENLABS_API_KEY": "server-test-key"}, clear=False),
            patch.object(ai_gateway, "call_elevenlabs", side_effect=fake_provider_call),
        ):
            submitted = self.client.post(
                "/api/audio/generations",
                json={
                    "prompt": "  Warm analog pad  ",
                    "durationSeconds": 4,
                    "outputFormat": "mp3",
                },
            )
            self.assertEqual(submitted.status_code, 202)
            job_id = submitted.json()["jobId"]

            status = self.client.get(f"/api/audio/generations/{job_id}")
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["status"], "succeeded")
            self.assertEqual(status.json()["progress"], 100)
            result_url = status.json()["result"]["downloadUrl"]

            download = self.client.get(result_url)
            self.assertEqual(download.status_code, 200)
            self.assertEqual(download.content, b"fake-audio-bytes")
            self.assertTrue(download.headers["content-type"].startswith("audio/mpeg"))

    def test_validates_duration_and_prompt(self) -> None:
        with patch.dict(os.environ, {"ELEVENLABS_API_KEY": "server-test-key"}, clear=False):
            too_long = self.client.post(
                "/api/audio/generations",
                json={"prompt": "Long sound", "durationSeconds": 31},
            )
            blank = self.client.post(
                "/api/audio/generations",
                json={"prompt": "    ", "durationSeconds": 2},
            )
        self.assertEqual(too_long.status_code, 422)
        self.assertEqual(blank.status_code, 422)

    def test_provider_failure_remains_visible_as_a_failed_job(self) -> None:
        async def fail_provider_call(_request: ai_gateway.GenerateAudioRequest) -> tuple[bytes, str]:
            raise RuntimeError("ElevenLabs account limit reached")

        with (
            patch.dict(os.environ, {"ELEVENLABS_API_KEY": "server-test-key"}, clear=False),
            patch.object(ai_gateway, "call_elevenlabs", side_effect=fail_provider_call),
        ):
            submitted = self.client.post(
                "/api/audio/generations",
                json={"prompt": "Short synth stab", "durationSeconds": 2},
            )
            job_id = submitted.json()["jobId"]
            status = self.client.get(f"/api/audio/generations/{job_id}")

        self.assertEqual(status.json()["status"], "failed")
        self.assertIn("account limit", status.json()["message"])


if __name__ == "__main__":
    unittest.main()

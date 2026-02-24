"""Tests for TranscriptionService.translate() and stop_recording() translation integration."""

import json
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from src.backend.transcription import TranscriptionCancelled, TranscriptionService


class TestTranslateRouting(unittest.TestCase):
    """Test that translate() routes to the correct provider."""

    def setUp(self):
        self.svc = TranscriptionService()
        self.svc.set_api_credentials("openai", "test-key")

    @patch.object(TranscriptionService, "_translate_openai", return_value="translated")
    def test_defaults_to_openai(self, mock_openai):
        result = self.svc.translate("hello", "es")
        mock_openai.assert_called_once_with("hello", "es", "auto")
        self.assertEqual(result, "translated")

    @patch.object(TranscriptionService, "_translate_openai", return_value="translated")
    def test_explicit_openai_provider(self, mock_openai):
        self.svc.set_api_credentials("openai", "test-key")
        self.svc.translate("hello", "es")
        mock_openai.assert_called_once()

    @patch.object(TranscriptionService, "_translate_gemini", return_value="traducido")
    def test_gemini_provider(self, mock_gemini):
        self.svc.set_api_credentials("gemini", "gemini-key")
        result = self.svc.translate("hello", "es")
        mock_gemini.assert_called_once_with("hello", "es", "auto")
        self.assertEqual(result, "traducido")

    def test_empty_text_returns_empty(self):
        self.assertEqual(self.svc.translate("", "es"), "")
        self.assertEqual(self.svc.translate("   ", "es"), "")
        self.assertEqual(self.svc.translate(None, "es"), "")

    def test_source_language_passed_through(self):
        with patch.object(self.svc, "_translate_openai", return_value="ok") as mock:
            self.svc.translate("hello", "es", "en")
            mock.assert_called_once_with("hello", "es", "en")

    def test_cancel_before_translate(self):
        self.svc.request_cancel()
        with self.assertRaises(TranscriptionCancelled):
            self.svc.translate("hello", "es")


class TestTranslateOpenAI(unittest.TestCase):
    """Test OpenAI translation implementation."""

    def setUp(self):
        self.svc = TranscriptionService()
        self.svc._openai_client = None
        self.svc._openai_client_key = None
        self.svc.set_api_credentials("openai", "test-key")

    @patch("src.backend.transcription.OpenAI")
    def test_calls_chat_completions(self, MockOpenAI):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "  Hola mundo  "
        mock_client.chat.completions.create.return_value = mock_response

        result = self.svc._translate_openai("Hello world", "Spanish")

        MockOpenAI.assert_called_once_with(api_key="test-key")
        call_kwargs = mock_client.chat.completions.create.call_args
        self.assertEqual(call_kwargs.kwargs["model"], "gpt-4o-mini")
        messages = call_kwargs.kwargs["messages"]
        self.assertIn("Spanish", messages[0]["content"])
        self.assertEqual(messages[1]["content"], "Hello world")
        self.assertEqual(result, "Hola mundo")

    @patch("src.backend.transcription.OpenAI")
    def test_uses_custom_base_url(self, MockOpenAI):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "translated"
        mock_client.chat.completions.create.return_value = mock_response

        self.svc.set_api_credentials("openai", "test-key", "https://custom.api.com/v1")
        self.svc._translate_openai("hello", "French")

        MockOpenAI.assert_called_once_with(
            api_key="test-key",
            base_url="https://custom.api.com/v1",
        )

    @patch("src.backend.transcription.OpenAI")
    def test_source_language_in_prompt(self, MockOpenAI):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "translated"
        mock_client.chat.completions.create.return_value = mock_response

        self.svc._translate_openai("hello", "French", "English")

        messages = mock_client.chat.completions.create.call_args.kwargs["messages"]
        self.assertIn("from English", messages[0]["content"])

    @patch("src.backend.transcription.OpenAI")
    def test_auto_source_language_omitted_from_prompt(self, MockOpenAI):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        mock_response = MagicMock()
        mock_response.choices = [MagicMock()]
        mock_response.choices[0].message.content = "translated"
        mock_client.chat.completions.create.return_value = mock_response

        self.svc._translate_openai("hello", "French", "auto")

        messages = mock_client.chat.completions.create.call_args.kwargs["messages"]
        self.assertNotIn("from auto", messages[0]["content"])

    def test_no_api_key_raises(self):
        self.svc.set_api_credentials("openai", "")
        with patch("src.backend.transcription.OPENAI_API_KEY", ""), self.assertRaises(ValueError):
            self.svc._translate_openai("hello", "French")


class TestTranslateGemini(unittest.TestCase):
    """Test Gemini translation implementation."""

    def setUp(self):
        self.svc = TranscriptionService()
        self.svc.set_api_credentials("gemini", "gemini-test-key")
        self.svc.set_api_model("gemini-2.0-flash")

    @patch("src.backend.transcription.urllib_request.urlopen")
    def test_calls_gemini_api(self, mock_urlopen):
        response_data = {"candidates": [{"content": {"parts": [{"text": "  Hola mundo  "}]}}]}
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(response_data).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        result = self.svc._translate_gemini("Hello world", "Spanish")

        self.assertEqual(result, "Hola mundo")
        call_args = mock_urlopen.call_args
        req = call_args[0][0]
        self.assertIn("gemini-2.0-flash", req.full_url)
        self.assertIn("gemini-test-key", req.full_url)

    @patch("src.backend.transcription.urllib_request.urlopen")
    def test_uses_custom_model(self, mock_urlopen):
        response_data = {"candidates": [{"content": {"parts": [{"text": "translated"}]}}]}
        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(response_data).encode()
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        mock_urlopen.return_value = mock_resp

        self.svc.set_api_model("gemini-1.5-pro")
        self.svc._translate_gemini("hello", "French")

        req = mock_urlopen.call_args[0][0]
        self.assertIn("gemini-1.5-pro", req.full_url)

    def test_no_api_key_raises(self):
        self.svc.set_api_credentials("gemini", "")
        with self.assertRaises(ValueError):
            self.svc._translate_gemini("hello", "French")


class TestStopRecordingTranslation(unittest.TestCase):
    """Test that stop_recording() integrates translation correctly."""

    def _make_api(self, output_mode="transcribe", target_language="es"):
        """Create an Api instance with mocked dependencies."""
        with (
            patch("src.backend.api.AudioRecorder"),
            patch(
                "src.backend.api.load_settings",
                return_value={
                    "mode": "local",
                    "model": "base",
                    "language": "auto",
                    "api_provider": "openai",
                    "api_key": "test-key",
                    "api_model": "",
                    "api_base_url": "",
                    "output_mode": output_mode,
                    "target_language": target_language,
                    "source_language": "auto",
                    "auto_copy": False,
                    "sound_enabled": False,
                },
            ),
        ):
            from src.backend.api import Api

            api = Api()
        return api

    def test_transcribe_mode_no_translation(self):
        api = self._make_api(output_mode="transcribe")
        api._recorder = MagicMock()
        api._recorder.get_duration.return_value = 2.0
        api._recorder.get_wav_bytes.return_value = BytesIO(b"fake-wav")
        api._transcription = MagicMock()
        api._transcription.transcribe.return_value = "Hello world"
        api._transcription.mode = "local"

        result = api.stop_recording()

        api._transcription.translate.assert_not_called()
        self.assertTrue(result["success"])
        self.assertEqual(result["text"], "Hello world")
        self.assertEqual(result["translation"], "")

    def test_translate_mode_returns_translation(self):
        api = self._make_api(output_mode="translate", target_language="es")
        api._recorder = MagicMock()
        api._recorder.get_duration.return_value = 2.0
        api._recorder.get_wav_bytes.return_value = BytesIO(b"fake-wav")
        api._transcription = MagicMock()
        api._transcription.transcribe.return_value = "Hello world"
        api._transcription.translate.return_value = "Hola mundo"
        api._transcription.mode = "local"

        result = api.stop_recording()

        api._transcription.translate.assert_called_once_with("Hello world", "es", "auto")
        self.assertEqual(result["text"], "Hola mundo")
        self.assertEqual(result["transcript"], "Hello world")
        self.assertEqual(result["translation"], "Hola mundo")

    def test_both_mode_returns_formatted(self):
        api = self._make_api(output_mode="both", target_language="es")
        api._recorder = MagicMock()
        api._recorder.get_duration.return_value = 2.0
        api._recorder.get_wav_bytes.return_value = BytesIO(b"fake-wav")
        api._transcription = MagicMock()
        api._transcription.transcribe.return_value = "Hello world"
        api._transcription.translate.return_value = "Hola mundo"
        api._transcription.mode = "local"

        result = api.stop_recording()

        self.assertIn("Transcript:", result["text"])
        self.assertIn("Hello world", result["text"])
        self.assertIn("Translation (es):", result["text"])
        self.assertIn("Hola mundo", result["text"])

    def test_both_mode_same_text_returns_original(self):
        """If translation equals transcript (e.g., same language), just return transcript."""
        api = self._make_api(output_mode="both", target_language="en")
        api._recorder = MagicMock()
        api._recorder.get_duration.return_value = 2.0
        api._recorder.get_wav_bytes.return_value = BytesIO(b"fake-wav")
        api._transcription = MagicMock()
        api._transcription.transcribe.return_value = "Hello world"
        api._transcription.translate.return_value = "Hello world"
        api._transcription.mode = "local"

        result = api.stop_recording()

        self.assertEqual(result["text"], "Hello world")

    def test_translation_failure_shows_error_inline(self):
        api = self._make_api(output_mode="translate", target_language="es")
        api._recorder = MagicMock()
        api._recorder.get_duration.return_value = 2.0
        api._recorder.get_wav_bytes.return_value = BytesIO(b"fake-wav")
        api._transcription = MagicMock()
        api._transcription.transcribe.return_value = "Hello world"
        api._transcription.translate.side_effect = ValueError("API key not set")
        api._transcription.mode = "local"

        result = api.stop_recording()

        self.assertTrue(result["success"])
        self.assertIn("[Translation failed:", result["text"])


if __name__ == "__main__":
    unittest.main()

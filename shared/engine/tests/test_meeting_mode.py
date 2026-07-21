"""Unit tests for meeting mode's pure logic.

Covers the deterministic, side-effect-free summary parser the integrator relies
on to turn the single LLM summarization response into a structured
`meeting_result` payload: `parse_meeting_summary` and `_strip_bullet`. No API,
mic, model, or network is touched.

Runs under both `pytest` and `python -m unittest`.
"""
import os
import tempfile
import unittest

# engine.py redirects stderr to a log file at import time; point it at a temp dir
# so importing it here can't touch a real config directory.
os.environ.setdefault("WHISPERCLICK_CONFIG_DIR", tempfile.mkdtemp(prefix="wc-meeting-test-"))

from engine import _strip_bullet, parse_meeting_summary


class StripBulletTests(unittest.TestCase):
    def test_dash_marker(self):
        self.assertEqual(_strip_bullet("- do the thing"), "do the thing")

    def test_star_marker(self):
        self.assertEqual(_strip_bullet("* do the thing"), "do the thing")

    def test_unicode_bullet(self):
        self.assertEqual(_strip_bullet("• do the thing"), "do the thing")

    def test_numbered_dot(self):
        self.assertEqual(_strip_bullet("1. do the thing"), "do the thing")

    def test_numbered_paren(self):
        self.assertEqual(_strip_bullet("2) do the thing"), "do the thing")

    def test_no_marker_passthrough(self):
        self.assertEqual(_strip_bullet("do the thing"), "do the thing")

    def test_leading_whitespace(self):
        self.assertEqual(_strip_bullet("   - do the thing "), "do the thing")


class ParseMeetingSummaryTests(unittest.TestCase):
    def test_summary_and_action_items(self):
        text = (
            "We shipped v2. Bob will deploy Friday.\n\n"
            "Action Items:\n"
            "- Bob: deploy Friday\n"
            "- Ana: write release notes"
        )
        summary, items = parse_meeting_summary(text)
        self.assertEqual(summary, "We shipped v2. Bob will deploy Friday.")
        self.assertEqual(items, ["Bob: deploy Friday", "Ana: write release notes"])

    def test_no_header_all_summary(self):
        summary, items = parse_meeting_summary("Just a status chat, nothing to do.")
        self.assertEqual(summary, "Just a status chat, nothing to do.")
        self.assertEqual(items, [])

    def test_none_placeholder_dropped(self):
        summary, items = parse_meeting_summary("Recap here.\nAction Items:\n- None")
        self.assertEqual(summary, "Recap here.")
        self.assertEqual(items, [])

    def test_na_and_no_action_items_dropped(self):
        _, items = parse_meeting_summary("S.\nAction Items:\n- N/A\n- No action items")
        self.assertEqual(items, [])

    def test_markdown_bold_header(self):
        summary, items = parse_meeting_summary("Recap.\n**Action Items**\n- Ship it")
        self.assertEqual(summary, "Recap.")
        self.assertEqual(items, ["Ship it"])

    def test_singular_header_and_numbered_items(self):
        summary, items = parse_meeting_summary(
            "Recap.\nAction Item:\n1. First\n2. Second")
        self.assertEqual(summary, "Recap.")
        self.assertEqual(items, ["First", "Second"])

    def test_blank_lines_ignored_between_items(self):
        _, items = parse_meeting_summary("S.\nAction Items:\n- One\n\n- Two\n")
        self.assertEqual(items, ["One", "Two"])

    def test_empty_input(self):
        self.assertEqual(parse_meeting_summary(""), ("", []))
        self.assertEqual(parse_meeting_summary("   \n  "), ("", []))

    def test_multiline_summary_preserved(self):
        text = "Line one.\nLine two.\nAction Items:\n- Task"
        summary, items = parse_meeting_summary(text)
        self.assertEqual(summary, "Line one.\nLine two.")
        self.assertEqual(items, ["Task"])

    def test_items_without_bullet_markers(self):
        # A model that returns bare lines under the header still yields items.
        _, items = parse_meeting_summary("S.\nAction Items:\nCall vendor\nSend invoice")
        self.assertEqual(items, ["Call vendor", "Send invoice"])


if __name__ == "__main__":
    unittest.main()

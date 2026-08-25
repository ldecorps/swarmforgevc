#!/usr/bin/env python3
"""TDD: Local Agent turns must not hang Telegram after tools / dead clients."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import agent_core
from turn_gate import TurnGate


def _tool_call(name: str, args: dict) -> dict:
    return {"function": {"name": name, "arguments": args}}


class FastPathTests(unittest.TestCase):
    def test_exact_ping_skips_chat(self) -> None:
        chat = mock.Mock()
        reply, _ = agent_core.run_turn("ping", chat_fn=chat)
        self.assertEqual(reply, "Pong")
        chat.assert_not_called()


class StreamBreakTests(unittest.TestCase):
    def test_broken_pipe_on_progress_aborts_turn_and_skips_further_chat(self) -> None:
        """Progress write failure must end the turn — not be swallowed while holding the infer lock."""
        calls: list[str] = []

        def chat(messages, *, model, tools):  # noqa: ARG001
            calls.append("chat")
            if len(calls) == 1:
                return {
                    "message": {
                        "content": "",
                        "tool_calls": [_tool_call("list_dir", {"path": "."})],
                    }
                }
            self.fail("second ollama call must not run after stream break")
            return {"message": {"content": "should not happen"}}

        def on_event(evt: dict) -> None:
            if evt.get("type") == "tool_result":
                raise BrokenPipeError("client gone")

        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "list the project root",
                root=tmp,
                chat_fn=chat,
                on_event=on_event,
            )

        self.assertEqual(len(calls), 1)
        self.assertIn("stream broken", reply.lower())
        self.assertIn("client", reply.lower())


class TurnDeadlineTests(unittest.TestCase):
    def test_deadline_between_tool_rounds_ends_turn(self) -> None:
        """After tools, if the wall clock is past the deadline, do not start another Ollama call."""
        clock = {"t": 100.0}
        calls: list[str] = []

        def now() -> float:
            return clock["t"]

        def chat(messages, *, model, tools):  # noqa: ARG001
            calls.append("chat")
            if len(calls) == 1:
                # Simulate wall time burning during the first call.
                clock["t"] = 200.0
                return {
                    "message": {
                        "content": "",
                        "tool_calls": [_tool_call("list_dir", {"path": "."})],
                    }
                }
            self.fail("deadline must prevent the post-tool ollama call")
            return {"message": {"content": "late"}}

        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "list files",
                root=tmp,
                chat_fn=chat,
                now_fn=now,
                gate=TurnGate(now_fn=now, idle_s=0.0),
                deadline_s=30.0,  # started at 100, after first chat t=200
            )

        self.assertEqual(len(calls), 1)
        self.assertIn("deadline", reply.lower())


class DeadlineHelperTests(unittest.TestCase):
    def test_deadline_exceeded_predicate(self) -> None:
        self.assertFalse(agent_core.deadline_exceeded(10.0, start=0.0, limit_s=30.0))
        self.assertTrue(agent_core.deadline_exceeded(31.0, start=0.0, limit_s=30.0))
        self.assertFalse(agent_core.deadline_exceeded(10.0, start=0.0, limit_s=None))
        self.assertFalse(agent_core.deadline_exceeded(10.0, start=0.0, limit_s=0))


class OllamaTimeoutConfigTests(unittest.TestCase):
    def test_ollama_timeout_default_is_bounded(self) -> None:
        # Regression lock: unbounded 600s waits are what parked Telegram.
        self.assertLessEqual(agent_core.OLLAMA_TIMEOUT_S, 120)
        self.assertGreater(agent_core.OLLAMA_TIMEOUT_S, 0)


if __name__ == "__main__":
    unittest.main()

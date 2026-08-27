#!/usr/bin/env python3
"""TDD: empty Ollama replies must not be the Telegram final answer."""

from __future__ import annotations

import tempfile
import unittest

import agent_core
from turn_gate import TurnGate


def _tool_call(name: str, args: dict) -> dict:
    return {"function": {"name": name, "arguments": args}}


class EmptyReplyRecoveryTests(unittest.TestCase):
    def test_empty_first_reply_nudges_and_continues(self) -> None:
        n = {"i": 0}

        def chat(messages, *, model, tools):  # noqa: ARG001
            n["i"] += 1
            if n["i"] == 1:
                return {"message": {"content": ""}}
            if n["i"] == 2:
                self.assertTrue(
                    any(
                        m.get("role") == "user" and "empty" in str(m.get("content", "")).lower()
                        for m in messages
                    )
                )
                return {
                    "message": {
                        "content": "",
                        "tool_calls": [_tool_call("run_shell", {"command": "echo 42"})],
                    }
                }
            return {"message": {"content": "42 lines"}}

        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "how many lines of code",
                root=tmp,
                chat_fn=chat,
                gate=TurnGate(idle_s=0),
                deadline_s=999,
            )
        self.assertEqual(n["i"], 3)
        self.assertIn("42", reply)
        self.assertNotIn("(empty model reply)", reply.lower())

    def test_double_empty_fails_closed_with_clear_error(self) -> None:
        def chat(messages, *, model, tools):  # noqa: ARG001
            return {"message": {"content": "  "}}

        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "how many lines",
                root=tmp,
                chat_fn=chat,
                gate=TurnGate(idle_s=0),
                deadline_s=999,
            )
        self.assertNotEqual(reply.strip(), "(empty model reply)")
        self.assertIn("empty", reply.lower())
        self.assertIn("retry", reply.lower())


if __name__ == "__main__":
    unittest.main()

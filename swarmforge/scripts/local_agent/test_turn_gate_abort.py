#!/usr/bin/env python3
"""TDD: abort gate stops hung turns mid-chat / when idle between rounds."""

from __future__ import annotations

import tempfile
import threading
import time
import unittest

import agent_core
from turn_gate import TurnAborted, TurnGate


def _tool_call(name: str, args: dict) -> dict:
    return {"function": {"name": name, "arguments": args}}


class TurnGateTests(unittest.TestCase):
    def test_raise_if_aborted_after_abort(self) -> None:
        gate = TurnGate()
        gate.abort("deadline")
        with self.assertRaises(TurnAborted) as ctx:
            gate.raise_if_aborted()
        self.assertIn("deadline", str(ctx.exception))

    def test_idle_raises_without_progress(self) -> None:
        clock = {"t": 0.0}
        gate = TurnGate(now_fn=lambda: clock["t"], idle_s=10.0)
        gate.note_progress()
        clock["t"] = 11.0
        with self.assertRaises(TurnAborted) as ctx:
            gate.raise_if_stale()
        self.assertIn("idle", str(ctx.exception).lower())

    def test_raise_if_aborted_ignores_idle(self) -> None:
        """In-flight Ollama polls must not trip idle — only explicit abort."""
        clock = {"t": 0.0}
        gate = TurnGate(now_fn=lambda: clock["t"], idle_s=1.0)
        gate.note_progress()
        clock["t"] = 99.0
        gate.raise_if_aborted()  # must not raise

    def test_abort_runs_registered_closers(self) -> None:
        closed = {"n": 0}
        gate = TurnGate()
        gate.register_closer(lambda: closed.__setitem__("n", closed["n"] + 1))
        gate.abort("x")
        self.assertEqual(closed["n"], 1)


class AbortDuringChatTests(unittest.TestCase):
    def test_blocking_chat_unblocked_by_gate_abort(self) -> None:
        """Regression: socket shutdown alone left the worker inside chat(); abort must win.

        chat_fn does not cooperatively poll — run_turn must watch the gate itself.
        """
        gate = TurnGate()
        entered = threading.Event()

        def chat(messages, *, model, tools):  # noqa: ARG001
            entered.set()
            time.sleep(5.0)
            self.fail("chat should have been aborted")
            return {"message": {"content": "nope"}}

        def killer() -> None:
            self.assertTrue(entered.wait(2))
            time.sleep(0.05)
            gate.abort("turn deadline exceeded (120s)")

        threading.Thread(target=killer, daemon=True).start()
        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "do something slow",
                root=tmp,
                chat_fn=chat,
                gate=gate,
                deadline_s=999,
            )
        self.assertIn("deadline", reply.lower())


class IdleAfterToolsTests(unittest.TestCase):
    def test_idle_after_tool_round_aborts_before_next_chat(self) -> None:
        """Between rounds, no progress for idle_s must fail closed before another Ollama call."""
        clock = {"t": 100.0}
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
            self.fail("idle abort must prevent the next ollama call")
            return {"message": {"content": "late"}}

        gate = TurnGate(now_fn=lambda: clock["t"], idle_s=5.0)

        def raise_if_stale_with_jump() -> None:
            # Simulate wall time passing after the tool round's last successful emit.
            if len(calls) == 1 and clock["t"] < 120.0:
                clock["t"] = 120.0
            TurnGate.raise_if_stale(gate)

        gate.raise_if_stale = raise_if_stale_with_jump  # type: ignore[method-assign]

        with tempfile.TemporaryDirectory() as tmp:
            reply, _ = agent_core.run_turn(
                "list files",
                root=tmp,
                chat_fn=chat,
                now_fn=lambda: clock["t"],
                gate=gate,
                deadline_s=999,
            )
        self.assertEqual(len(calls), 1)
        self.assertIn("idle", reply.lower())


if __name__ == "__main__":
    unittest.main()

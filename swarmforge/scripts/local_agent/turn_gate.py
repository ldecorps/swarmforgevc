#!/usr/bin/env python3
"""Turn abort gate — deadline/idle must stop the tool loop even mid-chat."""

from __future__ import annotations

import threading
import time
from typing import Callable


class TurnAborted(Exception):
    """Turn must stop: wall deadline, idle watchdog, or external cancel."""


class TurnGate:
    """Shared abort + progress heartbeat for one Local Agent turn."""

    def __init__(
        self,
        *,
        now_fn: Callable[[], float] | None = None,
        idle_s: float = 0.0,
    ) -> None:
        self._now = now_fn or time.time
        self._idle_s = idle_s
        self._abort = threading.Event()
        self._reason = "turn aborted"
        self._last_progress = self._now()
        self._aux_closers: list[Callable[[], None]] = []
        self._lock = threading.Lock()

    def note_progress(self) -> None:
        self._last_progress = self._now()

    def register_closer(self, closer: Callable[[], None]) -> None:
        with self._lock:
            self._aux_closers.append(closer)

    def abort(self, reason: str = "turn aborted") -> None:
        self._reason = reason
        self._abort.set()
        with self._lock:
            closers = list(self._aux_closers)
        for closer in closers:
            try:
                closer()
            except Exception:  # noqa: BLE001 — best-effort cancel
                pass

    def aborted(self) -> bool:
        return self._abort.is_set()

    def reason(self) -> str:
        return self._reason

    def raise_if_aborted(self) -> None:
        """External cancel / wall deadline only — safe to poll during Ollama."""
        if self._abort.is_set():
            raise TurnAborted(self._reason)

    def raise_if_stale(self) -> None:
        """Abort or between-round idle (no progress events). Not for in-flight chat."""
        self.raise_if_aborted()
        if self._idle_s > 0 and (self._now() - self._last_progress) >= self._idle_s:
            raise TurnAborted(f"idle for {self._idle_s:.0f}s with no progress")

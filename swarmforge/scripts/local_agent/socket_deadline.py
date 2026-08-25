#!/usr/bin/env python3
"""Hard socket deadline: unblock a stuck stream write/read after the turn wall clock."""

from __future__ import annotations

import socket
import threading
import time
from typing import Callable


def _shutdown_conn(conn: socket.socket) -> None:
    try:
        conn.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def _fire_deadline(
    conn: socket.socket,
    on_fire: Callable[[], None] | None,
    close_delay_s: float,
) -> None:
    if on_fire is not None:
        try:
            on_fire()
        except Exception:  # noqa: BLE001 — watchdog must still shut the socket
            pass
    if close_delay_s <= 0:
        _shutdown_conn(conn)
        return
    closer = threading.Timer(close_delay_s, lambda: _shutdown_conn(conn))
    closer.daemon = True
    closer.start()


def arm_connection_deadline(
    conn: socket.socket,
    seconds: float,
    *,
    on_fire: Callable[[], None] | None = None,
    close_delay_s: float = 0.0,
) -> threading.Timer | None:
    """After ``seconds``, run ``on_fire`` then shut down ``conn``.

    ``close_delay_s`` waits after ``on_fire`` before shutdown so a turn can
    still emit error/done NDJSON (abort-without-instant-kill).

    Returns the timer (cancel on clean finish), or None when deadline is disabled.
    """
    if seconds is None or seconds <= 0:
        return None
    timer = threading.Timer(
        seconds, lambda: _fire_deadline(conn, on_fire, close_delay_s)
    )
    timer.daemon = True
    timer.start()
    return timer


def cancel_deadline(timer: threading.Timer | None) -> None:
    if timer is not None:
        timer.cancel()

#!/usr/bin/env python3
"""TDD: hard socket deadline unblocks a stuck stream."""

from __future__ import annotations

import socket
import time
import unittest

from socket_deadline import arm_connection_deadline, cancel_deadline


class SocketDeadlineTests(unittest.TestCase):
    def test_disabled_deadline_returns_none(self) -> None:
        a, b = socket.socketpair()
        try:
            self.assertIsNone(arm_connection_deadline(a, 0))
            self.assertIsNone(arm_connection_deadline(a, -1))
        finally:
            a.close()
            b.close()

    def test_deadline_shutdown_unblocks_recv(self) -> None:
        a, b = socket.socketpair()
        try:
            fired = {"n": 0}
            timer = arm_connection_deadline(a, 0.05, on_fire=lambda: fired.__setitem__("n", 1))
            self.assertIsNotNone(timer)
            t0 = time.time()
            data = b.recv(64)
            elapsed = time.time() - t0
            self.assertEqual(data, b"")
            self.assertLess(elapsed, 1.0)
            self.assertEqual(fired["n"], 1)
            cancel_deadline(timer)
        finally:
            a.close()
            b.close()

    def test_cancel_prevents_shutdown(self) -> None:
        a, b = socket.socketpair()
        try:
            timer = arm_connection_deadline(a, 0.2)
            cancel_deadline(timer)
            time.sleep(0.35)
            a.settimeout(0.05)
            with self.assertRaises(socket.timeout):
                a.recv(1)
        finally:
            a.close()
            b.close()

    def test_close_delay_lets_on_fire_run_before_shutdown(self) -> None:
        """Regression: instant shutdown after abort dropped the Telegram final line."""
        a, b = socket.socketpair()
        try:
            order: list[str] = []

            def on_fire() -> None:
                order.append("fire")
                # Socket must still be writable long enough to send NDJSON.
                a.sendall(b"error-line\n")
                order.append("sent")

            timer = arm_connection_deadline(a, 0.05, on_fire=on_fire, close_delay_s=0.15)
            self.assertIsNotNone(timer)
            data = b.recv(64)
            self.assertEqual(data, b"error-line\n")
            self.assertEqual(order, ["fire", "sent"])
            # After delay, peer sees EOF.
            t0 = time.time()
            eof = b.recv(64)
            self.assertEqual(eof, b"")
            self.assertGreaterEqual(time.time() - t0, 0.1)
            cancel_deadline(timer)
        finally:
            a.close()
            b.close()


if __name__ == "__main__":
    unittest.main()

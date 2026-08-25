#!/usr/bin/env python3
"""HTTP front for Local Agent — front desk POSTs /turn or /turn/stream here."""

from __future__ import annotations

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from agent_core import (  # noqa: E402
    DEFAULT_MODEL,
    KEEP_ALIVE,
    NUM_CTX,
    NUM_PREDICT,
    OLLAMA_TIMEOUT_S,
    THINK,
    TURN_DEADLINE_S,
    TURN_IDLE_S,
    fast_path_reply,
    run_turn,
)
from socket_deadline import arm_connection_deadline, cancel_deadline  # noqa: E402
from turn_gate import TurnGate  # noqa: E402

HOST = os.environ.get("LOCAL_AGENT_HOST", "127.0.0.1")
PORT = int(os.environ.get("LOCAL_AGENT_PORT", "18765"))
ROOT = os.environ.get("LOCAL_AGENT_ROOT") or str(HERE.parents[2])  # repo root

_sessions: dict[str, list[dict[str, Any]]] = {}
_sessions_lock = threading.Lock()
# One Ollama turn at a time — parallel CPU runs thrash and time out Telegram.
_infer_lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter
        sys.stderr.write(f"[local-agent] {self.address_string()} {fmt % args}\n")

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}

    def _send(self, code: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self._send(
                200,
                {
                    "ok": True,
                    "model": DEFAULT_MODEL,
                    "think": THINK,
                    "num_ctx": NUM_CTX,
                    "num_predict": NUM_PREDICT,
                    "keep_alive": KEEP_ALIVE,
                    "ollama_timeout_s": OLLAMA_TIMEOUT_S,
                    "turn_deadline_s": TURN_DEADLINE_S,
                    "turn_idle_s": TURN_IDLE_S,
                    "root": ROOT,
                    "sessions": len(_sessions),
                },
            )
            return
        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/turn", "/turn/stream"):
            self._send(404, {"ok": False, "error": "not found"})
            return
        body = self._read_json()
        text = str(body.get("text") or "").strip()
        session_id = str(body.get("session_id") or "default")
        if not text:
            self._send(400, {"ok": False, "error": "text required"})
            return
        with _sessions_lock:
            history = list(_sessions.get(session_id) or [])

        if path == "/turn/stream":
            self._stream_turn(text, session_id, history)
            return

        # Fast path skips the infer lock so pings never queue behind Ollama.
        if fast_path_reply(text) is None:
            with _infer_lock:
                reply, updated = run_turn(text, history=history, root=ROOT)
        else:
            reply, updated = run_turn(text, history=history, root=ROOT)
        trimmed = updated[-40:]
        with _sessions_lock:
            _sessions[session_id] = trimmed
        self._send(200, {"ok": True, "reply": reply, "session_id": session_id})

    def _stream_turn(self, text: str, session_id: str, history: list[dict[str, Any]]) -> None:
        """NDJSON event stream: progress lines, then a final {type:done, reply}."""
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        write_bound = max(TURN_IDLE_S, 30.0) + 15.0

        def write_event(obj: dict[str, Any]) -> None:
            line = (json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8")
            # Bound only the write — a connection-wide timeout fires keep-alive
            # "Request timed out" during long Ollama calls and confuses ops.
            old = self.connection.gettimeout()
            try:
                self.connection.settimeout(write_bound)
                self.wfile.write(line)
                self.wfile.flush()
            finally:
                try:
                    self.connection.settimeout(old)
                except OSError:
                    pass

        def on_event(evt: dict[str, Any]) -> None:
            write_event(evt)

        # Soft checks inside run_turn miss a wedged chat()/blocked write. Abort
        # the gate first; delay socket close so error/done NDJSON can still flush
        # (instant shutdown left Telegram with "client disconnected" / offline).
        gate = TurnGate(idle_s=TURN_IDLE_S)
        reason = f"turn deadline exceeded ({TURN_DEADLINE_S:.0f}s)"

        def on_deadline() -> None:
            sys.stderr.write(f"[local-agent] {reason} — aborting turn (stream close delayed)\n")
            gate.abort(reason)

        deadline_timer = arm_connection_deadline(
            self.connection,
            TURN_DEADLINE_S,
            on_fire=on_deadline,
            close_delay_s=2.0,
        )
        try:
            if fast_path_reply(text) is None:
                with _infer_lock:
                    reply, updated = run_turn(
                        text, history=history, root=ROOT, on_event=on_event, gate=gate
                    )
            else:
                reply, updated = run_turn(
                    text, history=history, root=ROOT, on_event=on_event, gate=gate
                )
            trimmed = updated[-40:]
            with _sessions_lock:
                _sessions[session_id] = trimmed
            write_event({"type": "done", "ok": True, "reply": reply, "session_id": session_id})
        except BrokenPipeError:
            sys.stderr.write("[local-agent] client disconnected mid-stream\n")
        except ConnectionResetError:
            sys.stderr.write("[local-agent] client reset mid-stream\n")
        except Exception as e:  # noqa: BLE001
            try:
                write_event({"type": "error", "ok": False, "text": str(e), "error": str(e)})
                write_event({"type": "done", "ok": False, "error": str(e), "session_id": session_id})
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            cancel_deadline(deadline_timer)


def main() -> None:
    os.environ.setdefault("LOCAL_AGENT_ROOT", ROOT)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(
        f"[local-agent] listening on http://{HOST}:{PORT} "
        f"model={DEFAULT_MODEL} think={THINK} num_ctx={NUM_CTX} "
        f"num_predict={NUM_PREDICT} keep_alive={KEEP_ALIVE} root={ROOT}\n"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[local-agent] shutting down\n")


if __name__ == "__main__":
    main()

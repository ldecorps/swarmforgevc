#!/usr/bin/env python3
"""Tool-call shim between a local-model (qwen CLI) seat and Ollama - BL-1917.

qwen2.5-coder-14b writes its tool call as text: a ```json fence, a bare JSON
object, or JSON inside <tool_call> tags. Ollama turns a reply into
tool_calls only when the reply starts with the template's <tool_call> tag, so
the call reaches qwen as plain content, qwen prints it, and the seat stalls on
its first turn. Measured 2026-10-03: 5 of 5 replays of the coder seat's real
first request came back as a ```json fence naming read_file with the right
arguments, and tool_calls empty.

The shim forwards every request to Ollama unchanged, with one exception. A
chat completion that declares tools goes upstream with streaming off. When the
reply has no tool_calls but its content holds a JSON object naming one of the
declared tools, that object becomes a tool call and the rest of the content
stays as content. A client that asked for a stream gets the reply back as
server-sent events, with a keepalive comment while Ollama works.

Going the other way, an assistant turn in the request history that carries
tool_calls loses its text before it reaches Ollama (BL-1919): the template
shows such a turn's calls only when it has no text, and a model shown its
own turns as bare announcements goes on announcing instead of calling.

Usage:
  local_model_tool_call_shim.py serve  --port <n> --upstream <http://host:port/v1>
  local_model_tool_call_shim.py ensure --port <n> --upstream <http://host:port/v1> --log <path>

`ensure` exits 0 once a shim for that upstream answers on the port, starting
one in the background when nothing answers there. It refuses (exit 1) when
something else holds the port, and never stops a process it did not start.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable

NAME = "local-model-tool-call-shim"
HEALTH_PATH = "/shim/health"
HOP_BY_HOP = {"host", "content-length", "connection", "transfer-encoding", "accept-encoding", "keep-alive"}

_TAGGED = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.DOTALL)
_FENCED = re.compile(r"```[A-Za-z0-9_-]*[ \t]*\n?(.*?)```", re.DOTALL)
_LINE_START_BRACE = re.compile(r"(?m)^[ \t]*\{")


def declared_tool_names(request: dict[str, Any]) -> set[str]:
    names: set[str] = set()
    for tool in request.get("tools") or []:
        fn = tool.get("function") if isinstance(tool, dict) else None
        if isinstance(fn, dict) and isinstance(fn.get("name"), str) and fn["name"]:
            names.add(fn["name"])
    return names


def _call_from_object(obj: Any, names: set[str]) -> dict[str, str] | None:
    if not isinstance(obj, dict) or obj.get("name") not in names:
        return None
    args = obj.get("arguments", obj.get("parameters", {}))
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            return None
    if not isinstance(args, dict):
        return None
    return {"name": obj["name"], "arguments": json.dumps(args)}


def _call_from_blob(blob: str, names: set[str]) -> dict[str, str] | None:
    try:
        return _call_from_object(json.loads(blob), names)
    except ValueError:
        return None


def _without_spans(text: str, spans: list[tuple[int, int]]) -> str:
    kept, last = [], 0
    for start, end in spans:
        kept.append(text[last:start])
        last = end
    kept.append(text[last:])
    return "".join(kept).strip()


def _wrapped_calls(content: str, names: set[str]) -> tuple[list[dict[str, str]], list[tuple[int, int]]]:
    for pattern in (_TAGGED, _FENCED):
        calls, spans = [], []
        for match in pattern.finditer(content):
            call = _call_from_blob(match.group(1).strip(), names)
            if call:
                calls.append(call)
                spans.append(match.span())
        if calls:
            return calls, spans
    return [], []


def _bare_calls(content: str, names: set[str]) -> tuple[list[dict[str, str]], list[tuple[int, int]]]:
    decoder = json.JSONDecoder()
    calls, spans, pos = [], [], 0
    for match in _LINE_START_BRACE.finditer(content):
        start = match.end() - 1
        if start < pos:
            continue
        try:
            obj, end = decoder.raw_decode(content, start)
        except ValueError:
            continue
        call = _call_from_object(obj, names)
        if call:
            calls.append(call)
            spans.append((start, end))
            pos = end
    return calls, spans


def extract_tool_calls(content: str, names: set[str]) -> tuple[list[dict[str, str]], str]:
    """The tool calls written into `content` as text, and the content left over.

    Only a JSON object whose "name" is a declared tool counts; anything else
    leaves the content exactly as it was and returns no calls."""
    if not content or not names:
        return [], content
    calls, spans = _wrapped_calls(content, names)
    if not calls:
        calls, spans = _bare_calls(content, names)
    if not calls:
        return [], content
    return calls, _without_spans(content, spans)


def _new_call_id() -> str:
    return f"call_{uuid.uuid4().hex[:8]}"


def rewrite_completion(
    completion: dict[str, Any], names: set[str], new_id: Callable[[], str] = _new_call_id
) -> tuple[dict[str, Any], int]:
    """Turns text tool calls in a non-streamed chat completion into tool_calls.

    Returns the completion and how many calls were rewritten (0 leaves it
    untouched, including every reply that already carries tool_calls)."""
    choices = completion.get("choices") or []
    if not choices or not isinstance(choices[0], dict):
        return completion, 0
    message = choices[0].get("message") or {}
    if message.get("tool_calls"):
        return completion, 0
    calls, remaining = extract_tool_calls(str(message.get("content") or ""), names)
    if not calls:
        return completion, 0
    message["tool_calls"] = [
        {"id": new_id(), "index": i, "type": "function", "function": call} for i, call in enumerate(calls)
    ]
    message["content"] = remaining
    choices[0]["message"] = message
    choices[0]["finish_reason"] = "tool_calls"
    return completion, len(calls)


def history_without_call_prose(request: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """The request with the text dropped from every assistant turn that also
    carries tool_calls, and how many turns lost their text (BL-1919).

    The model's chat template renders an assistant turn's tool calls only
    when that turn has no text, so a turn kept as "I'll read the card." plus
    its call reached the model as the sentence alone. Shown its own history
    as announcements with no calls, it went on announcing: 3 of 4 replays
    with that history ended in prose, 0 of 4 with the text dropped."""
    messages = request.get("messages")
    if not isinstance(messages, list):
        return request, 0
    stripped, kept = 0, []
    for message in messages:
        if isinstance(message, dict) and message.get("role") == "assistant" \
                and message.get("tool_calls") and message.get("content"):
            message = {**message, "content": ""}
            stripped += 1
        kept.append(message)
    return ({**request, "messages": kept}, stripped) if stripped else (request, 0)


def completion_to_chunks(completion: dict[str, Any], include_usage: bool) -> list[dict[str, Any]]:
    """The chat.completion.chunk events a streaming client would have received."""
    base = {
        "id": completion.get("id"),
        "object": "chat.completion.chunk",
        "created": completion.get("created"),
        "model": completion.get("model"),
        "system_fingerprint": completion.get("system_fingerprint"),
    }
    choice = (completion.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    delta: dict[str, Any] = {"role": "assistant", "content": message.get("content") or ""}
    if message.get("reasoning"):
        delta["reasoning"] = message["reasoning"]
    if message.get("tool_calls"):
        delta["tool_calls"] = [
            {"index": i, "id": tc.get("id"), "type": "function", "function": tc.get("function")}
            for i, tc in enumerate(message["tool_calls"])
        ]
    chunks = [
        {**base, "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
        {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": choice.get("finish_reason") or "stop"}]},
    ]
    if include_usage and completion.get("usage"):
        chunks.append({**base, "choices": [], "usage": completion["usage"]})
    return chunks


def upstream_root(upstream: str) -> str:
    root = upstream.rstrip("/")
    return root[: -len("/v1")] if root.endswith("/v1") else root


def _log(message: str) -> None:
    print(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}", file=sys.stderr, flush=True)


class ShimHandler(BaseHTTPRequestHandler):
    upstream = "http://127.0.0.1:11434/v1"
    timeout_s = 900.0
    keepalive_s = 15.0

    def log_message(self, *_args: Any) -> None:  # the shim logs its own lines
        pass

    def do_GET(self) -> None:
        if self.path == HEALTH_PATH:
            self._send_json(200, {"shim": NAME, "upstream": self.upstream})
            return
        self._passthrough(None)

    def do_HEAD(self) -> None:
        self._passthrough(None)

    def do_DELETE(self) -> None:
        self._passthrough(self._read_body())

    def do_POST(self) -> None:
        body = self._read_body()
        if self.path.rstrip("/").endswith("/chat/completions"):
            try:
                request = json.loads(body or b"{}")
            except ValueError:
                request = None
            if isinstance(request, dict) and declared_tool_names(request):
                self._shim_chat(request)
                return
        self._passthrough(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("content-length") or 0)
        return self.rfile.read(length) if length else b""

    def _forward_headers(self) -> dict[str, str]:
        return {k: v for k, v in self.headers.items() if k.lower() not in HOP_BY_HOP}

    def _send_json(self, status: int, payload: Any) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(data)

    def _passthrough(self, body: bytes | None) -> None:
        req = urllib.request.Request(
            upstream_root(self.upstream) + self.path, data=body, method=self.command, headers=self._forward_headers()
        )
        try:
            resp = urllib.request.urlopen(req, timeout=self.timeout_s)
        except urllib.error.HTTPError as err:
            resp = err
        except (urllib.error.URLError, OSError) as err:
            self._send_json(502, {"error": {"message": f"{NAME}: upstream unreachable: {err}"}})
            return
        with resp:
            self.send_response(resp.status if hasattr(resp, "status") else resp.code)
            for key, value in resp.headers.items():
                if key.lower() not in HOP_BY_HOP:
                    self.send_header(key, value)
            self.send_header("Connection", "close")
            self.end_headers()
            if self.command == "HEAD":
                return
            while True:
                piece = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                if not piece:
                    break
                self.wfile.write(piece)
                self.wfile.flush()

    def _call_upstream(self, request: dict[str, Any]) -> tuple[int, bytes]:
        upstream_request = dict(request)
        upstream_request["stream"] = False
        upstream_request.pop("stream_options", None)
        req = urllib.request.Request(
            upstream_root(self.upstream) + self.path,
            data=json.dumps(upstream_request).encode(),
            method="POST",
            headers={**self._forward_headers(), "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()
        except (urllib.error.URLError, OSError) as err:
            return 502, json.dumps({"error": {"message": f"{NAME}: upstream unreachable: {err}"}}).encode()

    def _rewritten(self, request: dict[str, Any], status: int, raw: bytes, stripped: int = 0) -> tuple[int, Any]:
        try:
            payload = json.loads(raw or b"{}")
        except ValueError:
            payload = {"error": {"message": raw.decode(errors="replace")[:500]}}
        rewritten = 0
        if status == 200 and isinstance(payload, dict):
            payload, rewritten = rewrite_completion(payload, declared_tool_names(request))
        finish = ((payload.get("choices") or [{}])[0] or {}).get("finish_reason") if isinstance(payload, dict) else None
        _log(f"chat model={request.get('model')} status={status} tools={len(request.get('tools') or [])} "
             f"history_stripped={stripped} rewritten={rewritten} finish={finish}")
        return status, payload

    def _shim_chat(self, request: dict[str, Any]) -> None:
        upstream_request, stripped = history_without_call_prose(request)
        if not request.get("stream"):
            status, payload = self._rewritten(request, *self._call_upstream(upstream_request), stripped)
            self._send_json(status, payload)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        box: dict[str, tuple[int, bytes]] = {}
        worker = threading.Thread(target=lambda: box.setdefault("r", self._call_upstream(upstream_request)), daemon=True)
        worker.start()
        while worker.is_alive():
            worker.join(self.keepalive_s)
            if worker.is_alive():
                self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        status, payload = self._rewritten(request, *box["r"], stripped)
        if status != 200:
            error = payload.get("error") if isinstance(payload, dict) else None
            self.wfile.write(b"data: " + json.dumps({"error": error or {"message": str(payload)}}).encode() + b"\n\n")
            self.wfile.flush()
            return
        include_usage = bool((request.get("stream_options") or {}).get("include_usage"))
        for chunk in completion_to_chunks(payload, include_usage):
            self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def make_server(port: int, upstream: str, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    handler = type("BoundShimHandler", (ShimHandler,), {"upstream": upstream})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def probe(port: int, timeout_s: float = 1.0) -> dict[str, Any] | None:
    """The health answer on the port: the shim's own JSON, {} for something
    else answering, or None when nothing answers."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{HEALTH_PATH}", timeout=timeout_s) as resp:
            body = json.loads(resp.read() or b"{}")
            return body if isinstance(body, dict) else {}
    except urllib.error.HTTPError:
        return {}
    except (urllib.error.URLError, OSError, ValueError):
        return None


def ensure(port: int, upstream: str, log_path: str, wait_s: float = 10.0) -> int:
    found = probe(port)
    if found is not None:
        if found.get("shim") == NAME and found.get("upstream") == upstream:
            return 0
        _log(f"{NAME}: port {port} is held by something else ({found or 'not the shim'}); not starting")
        return 1
    with open(log_path, "ab") as log:
        subprocess.Popen(
            [sys.executable, __file__, "serve", "--port", str(port), "--upstream", upstream],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
        )
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        found = probe(port)
        if found and found.get("shim") == NAME:
            return 0
        time.sleep(0.2)
    _log(f"{NAME}: started but never answered on port {port} within {wait_s}s (log: {log_path})")
    return 1


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog=NAME)
    parser.add_argument("mode", choices=["serve", "ensure"])
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--upstream", required=True)
    parser.add_argument("--log", default="/dev/null")
    args = parser.parse_args(argv)
    if args.mode == "ensure":
        return ensure(args.port, args.upstream, args.log)
    server = make_server(args.port, args.upstream)
    _log(f"{NAME}: serving 127.0.0.1:{args.port} -> {args.upstream}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

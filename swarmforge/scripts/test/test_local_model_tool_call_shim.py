#!/usr/bin/env python3
"""BL-1917: the local-model tool-call shim turns a tool call written as text
into a real tool call, and leaves every other reply alone.

Run: python3 -m unittest swarmforge/scripts/test/test_local_model_tool_call_shim.py
"""

from __future__ import annotations

import json
import sys
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import local_model_tool_call_shim as shim  # noqa: E402

NAMES = {"read_file", "run_shell_command"}
# The coder seat's first reply, verbatim from the 2026-10-03 replays.
FENCED = '```json\n{\n  "name": "read_file",\n  "arguments": {\n    "file_path": "/etc/hostname"\n  }\n}\n```'
PREAMBLE = "I will read the file `/etc/hostname` and tell you what it says.\n\n" + FENCED


def completion(content: str, tool_calls=None) -> dict:
    message = {"role": "assistant", "content": content}
    if tool_calls:
        message["tool_calls"] = tool_calls
    return {"id": "chatcmpl-1", "object": "chat.completion", "created": 1, "model": "m",
            "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 9, "completion_tokens": 3, "total_tokens": 12}}


class ExtractToolCallsTests(unittest.TestCase):
    def test_fenced_call_becomes_a_call(self) -> None:
        calls, rest = shim.extract_tool_calls(FENCED, NAMES)
        self.assertEqual(calls, [{"name": "read_file", "arguments": '{"file_path": "/etc/hostname"}'}])
        self.assertEqual(rest, "")

    def test_preamble_stays_as_content(self) -> None:
        calls, rest = shim.extract_tool_calls(PREAMBLE, NAMES)
        self.assertEqual([c["name"] for c in calls], ["read_file"])
        self.assertEqual(rest, "I will read the file `/etc/hostname` and tell you what it says.")

    def test_bare_and_tagged_calls(self) -> None:
        bare = '{"name": "run_shell_command", "arguments": {"command": "wc -l x"}}'
        tagged = "<tool_call>\n" + bare + "\n</tool_call>"
        for content in (bare, tagged, "Running it:\n" + bare):
            calls, _ = shim.extract_tool_calls(content, NAMES)
            self.assertEqual(calls, [{"name": "run_shell_command", "arguments": '{"command": "wc -l x"}'}], content)

    def test_two_bare_calls(self) -> None:
        content = '{"name": "read_file", "arguments": {"file_path": "a"}}\n{"name": "read_file", "arguments": {"file_path": "b"}}'
        calls, rest = shim.extract_tool_calls(content, NAMES)
        self.assertEqual([json.loads(c["arguments"])["file_path"] for c in calls], ["a", "b"])
        self.assertEqual(rest, "")

    def test_arguments_given_as_a_json_string(self) -> None:
        calls, _ = shim.extract_tool_calls('{"name": "read_file", "arguments": "{\\"file_path\\": \\"a\\"}"}', NAMES)
        self.assertEqual(calls, [{"name": "read_file", "arguments": '{"file_path": "a"}'}])

    def test_undeclared_name_prose_and_plain_json_are_left_alone(self) -> None:
        for content in ('```json\n{"name": "delete_repo", "arguments": {}}\n```',
                        "The file says carillon.",
                        '```json\n{"name": "x", "version": 2}\n```',
                        '{"file_path": "/etc/hostname"}'):
            self.assertEqual(shim.extract_tool_calls(content, NAMES), ([], content), content)

    def test_no_declared_tools_means_no_calls(self) -> None:
        self.assertEqual(shim.extract_tool_calls(FENCED, set()), ([], FENCED))


class RewriteCompletionTests(unittest.TestCase):
    def test_fenced_reply_is_rewritten(self) -> None:
        out, n = shim.rewrite_completion(completion(FENCED), NAMES, new_id=lambda: "call_x")
        self.assertEqual(n, 1)
        choice = out["choices"][0]
        self.assertEqual(choice["finish_reason"], "tool_calls")
        self.assertEqual(choice["message"]["content"], "")
        self.assertEqual(choice["message"]["tool_calls"], [{"id": "call_x", "index": 0, "type": "function",
                         "function": {"name": "read_file", "arguments": '{"file_path": "/etc/hostname"}'}}])

    def test_reply_with_tool_calls_or_prose_is_untouched(self) -> None:
        native = [{"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
        for original in (completion("", native), completion("The file says carillon.")):
            before = json.dumps(original)
            out, n = shim.rewrite_completion(original, NAMES)
            self.assertEqual((n, json.dumps(out)), (0, before))

    def test_chunks_carry_the_call_finish_and_usage(self) -> None:
        out, _ = shim.rewrite_completion(completion(FENCED), NAMES, new_id=lambda: "call_x")
        chunks = shim.completion_to_chunks(out, include_usage=True)
        self.assertEqual(chunks[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "read_file")
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "tool_calls")
        self.assertEqual(chunks[2]["usage"]["total_tokens"], 12)
        self.assertEqual(len(shim.completion_to_chunks(out, include_usage=False)), 2)


class HistoryTests(unittest.TestCase):
    CALL = [{"id": "call_a", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]

    def test_text_beside_a_call_is_dropped_and_counted(self) -> None:
        request = {"messages": [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "I'll read the card.", "tool_calls": self.CALL},
            {"role": "tool", "tool_call_id": "call_a", "content": "card"},
        ]}
        out, n = shim.history_without_call_prose(request)
        self.assertEqual(n, 1)
        self.assertEqual(out["messages"][1], {"role": "assistant", "content": "", "tool_calls": self.CALL})
        self.assertEqual(request["messages"][1]["content"], "I'll read the card.")  # caller's copy untouched

    def test_other_turns_are_left_alone(self) -> None:
        request = {"messages": [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "Done: NO_TASK, waiting for a wake."},
            {"role": "assistant", "content": "", "tool_calls": self.CALL},
        ]}
        out, n = shim.history_without_call_prose(request)
        self.assertEqual((n, out), (0, request))


class FakeOllama(BaseHTTPRequestHandler):
    seen: list = []

    def log_message(self, *_a) -> None:
        pass

    def _reply(self, payload: dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._reply({"object": "list", "data": [{"id": "m"}], "path": self.path})

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        FakeOllama.seen.append((self.path, body))
        self._reply(completion(FENCED))


def serve(server: ThreadingHTTPServer) -> None:
    threading.Thread(target=server.serve_forever, daemon=True).start()


class LiveShimTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        serve(cls.upstream)
        cls.upstream_url = f"http://127.0.0.1:{cls.upstream.server_address[1]}/v1"
        cls.shim = shim.make_server(0, cls.upstream_url)
        serve(cls.shim)
        cls.base = f"http://127.0.0.1:{cls.shim.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.shim.shutdown()
        cls.upstream.shutdown()

    def post(self, body: dict) -> bytes:
        req = urllib.request.Request(self.base + "/v1/chat/completions", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read()

    def test_streamed_request_gets_a_real_tool_call(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        raw = self.post({"model": "m", "stream": True, "stream_options": {"include_usage": True},
                         "messages": [{"role": "user", "content": "read it"}], "tools": tools}).decode()
        events = [line[len("data: "):] for line in raw.splitlines() if line.startswith("data: ")]
        self.assertEqual(events[-1], "[DONE]")
        chunks = [json.loads(e) for e in events[:-1]]
        self.assertEqual(chunks[0]["choices"][0]["delta"]["tool_calls"][0]["function"]["name"], "read_file")
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "tool_calls")
        path, sent = FakeOllama.seen[-1]
        self.assertEqual((path, sent["stream"], "stream_options" in sent), ("/v1/chat/completions", False, False))

    def test_history_reaches_ollama_without_text_beside_calls(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        call = [{"id": "call_a", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
        self.post({"model": "m", "tools": tools, "messages": [
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "I'll read the card.", "tool_calls": call},
            {"role": "tool", "tool_call_id": "call_a", "content": "card"}]})
        _path, sent = FakeOllama.seen[-1]
        self.assertEqual(sent["messages"][1]["content"], "")

    def test_request_without_tools_and_other_paths_pass_through(self) -> None:
        out = json.loads(self.post({"model": "m", "messages": [{"role": "user", "content": "hi"}]}))
        self.assertEqual(out["choices"][0]["message"]["content"], FENCED)
        with urllib.request.urlopen(self.base + "/v1/models", timeout=10) as resp:
            self.assertEqual(json.loads(resp.read())["path"], "/v1/models")

    def test_health_names_the_shim_and_ensure_refuses_a_foreign_port(self) -> None:
        port = self.shim.server_address[1]
        self.assertEqual(shim.probe(port), {"shim": shim.NAME, "upstream": self.upstream_url})
        self.assertEqual(shim.ensure(port, self.upstream_url, "/dev/null"), 0)
        self.assertEqual(shim.ensure(self.upstream.server_address[1], self.upstream_url, "/dev/null"), 1)


if __name__ == "__main__":
    unittest.main()

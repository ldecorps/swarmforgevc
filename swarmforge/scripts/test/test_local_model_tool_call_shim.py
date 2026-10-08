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
import urllib.error
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
    def test_a_reply_of_many_calls_runs_only_the_first(self) -> None:
        # The live coder seat's ten-call reply on 2026-10-03 ran all ten blind.
        content = ("Here is the plan.\n"
                   '```json\n{"name": "read_file", "arguments": {"file_path": "a"}}\n```\n'
                   '```json\n{"name": "run_shell_command", "arguments": {"command": "git commit"}}\n```\n'
                   '```json\n{"name": "run_shell_command", "arguments": {"command": "done_with_current.sh"}}\n```')
        names = NAMES | {"run_shell_command"}
        out, n = shim.rewrite_completion(completion(content), names, new_id=lambda: "call_x")
        message = out["choices"][0]["message"]
        self.assertEqual(n, 1)
        self.assertEqual([c["function"]["name"] for c in message["tool_calls"]], ["read_file"])
        self.assertNotIn("git commit", message["content"])
        self.assertNotIn("done_with_current", message["content"])

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


class NudgeTests(unittest.TestCase):
    ANNOUNCE = "I will now run the ready_for_next.sh script to check for any new handoff mail."
    WAKE = {"role": "user", "content": "You have new handoff mail. If idle, run ready_for_next.sh."}

    def test_an_announcement_after_a_wake_is_nudged(self) -> None:
        self.assertTrue(shim.needs_nudge({"messages": [self.WAKE]}, completion(self.ANNOUNCE)))
        self.assertTrue(shim.needs_nudge({"messages": [self.WAKE]}, completion("Done reading. Let me run it.")))

    def test_a_lets_plan_is_nudged(self) -> None:
        # The live coder seat's own words on 2026-10-03, each the last turn before a stall.
        for text in ("It seems there are uncommitted changes in the repository that need to be addressed "
                     "before proceeding with the new handoff mail. Let's commit the changes first and then "
                     "run `ready_for_next.sh` again.\n\n1. Commit the uncommitted changes.\n2. Run "
                     "`ready_for_next.sh` again.\n\nLet's proceed with these steps.",
                     "Let’s add the entry.", "Here is the plan. Let us run the tests."):
            self.assertTrue(shim.needs_nudge({"messages": [self.WAKE]}, completion(text)), text)
        self.assertFalse(shim.needs_nudge({"messages": [self.WAKE]}, completion("The outlet's tests passed.")))

    def test_a_question_to_the_user_is_nudged(self) -> None:
        # The live coder seat's own last turns on 2026-10-03 before two stalls.
        for text in ("It seems that the task is already in progress, and I should focus on implementing "
                     "BL-1916. Before proceeding, I need to understand the specific details of BL-1916. "
                     "Could you please provide more information about the task or the specific changes required?",
                     "I have read the README.md file. Next, I will proceed with implementing BL-1916 from the "
                     "backlog/active/ directory. Please provide the specific instructions or tasks related to "
                     "BL-1916 so I can begin the implementation."):
            self.assertTrue(shim.needs_nudge({"messages": [self.WAKE]}, completion(text)), text)
        idle = {"messages": [{"role": "tool", "tool_call_id": "c1", "content": "NO_TASK"}]}
        self.assertFalse(shim.needs_nudge(idle, completion("No task. Could you send me one?")))
        self.assertFalse(shim.needs_nudge({"messages": [self.WAKE]}, completion("The parcel is forwarded.")))

    def test_an_idle_seat_is_never_nudged(self) -> None:
        idle = {"messages": [{"role": "tool", "tool_call_id": "c1", "content": "NO_TASK"}]}
        self.assertFalse(shim.needs_nudge(idle, completion(self.ANNOUNCE)))
        self.assertFalse(shim.needs_nudge({"messages": [self.WAKE]},
                                          completion("NO_TASK. I will wait for a wake-up.")))

    def test_calls_cut_off_replies_and_plain_statements_are_not_nudged(self) -> None:
        native = [{"id": "c", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
        cut = completion(self.ANNOUNCE)
        cut["choices"][0]["finish_reason"] = "length"
        for reply in (completion("", native), cut, completion("The parcel is complete and forwarded."),
                      completion("")):
            self.assertFalse(shim.needs_nudge({"messages": [self.WAKE]}, reply))

    def test_the_nudged_call_joins_the_original_text(self) -> None:
        call = [{"id": "c", "type": "function", "function": {"name": "run_shell_command", "arguments": "{}"}}]
        merged, ok = shim.merge_nudged(completion(self.ANNOUNCE), completion("", call))
        self.assertTrue(ok)
        self.assertEqual(merged["choices"][0]["message"]["content"], self.ANNOUNCE)
        self.assertEqual(merged["choices"][0]["message"]["tool_calls"], call)
        self.assertEqual(merged["choices"][0]["finish_reason"], "tool_calls")
        same, ok = shim.merge_nudged(completion(self.ANNOUNCE), completion("Still talking."))
        self.assertEqual((ok, same["choices"][0]["message"]["content"]), (False, self.ANNOUNCE))

    def test_the_nudged_request_ends_on_the_announcement_and_the_nudge(self) -> None:
        out = shim.nudged_request({"messages": [self.WAKE]}, self.ANNOUNCE)
        self.assertEqual(out["messages"][-2:], [{"role": "assistant", "content": self.ANNOUNCE},
                                                {"role": "user", "content": shim.NUDGE}])


class OutputBudgetTests(unittest.TestCase):
    """2026-10-03 hotfix: the Modelfile's num_predict binds over the client's max_tokens."""

    def test_num_predict_is_read_from_the_show_parameters(self) -> None:
        self.assertEqual(shim.num_predict_of({"parameters": "num_ctx     32768\nnum_predict 4096"}), 4096)
        self.assertIsNone(shim.num_predict_of({"parameters": "num_ctx 32768"}))
        self.assertIsNone(shim.num_predict_of({"parameters": "num_predict -1"}))
        self.assertIsNone(shim.num_predict_of({"error": "model not found"}))
        self.assertIsNone(shim.num_predict_of(None))

    def test_num_ctx_is_read_from_the_show_parameters(self) -> None:
        self.assertEqual(shim.num_ctx_of({"parameters": "num_ctx     73728\nnum_predict 4096"}), 73728)
        self.assertIsNone(shim.num_ctx_of({"parameters": "num_predict 4096"}))
        self.assertIsNone(shim.num_ctx_of(None))

    def test_window_full_flags_a_prompt_at_the_served_edge_only(self) -> None:
        edge = 73728 - shim.WINDOW_FULL_MARGIN
        self.assertEqual(shim.window_full({"usage": {"prompt_tokens": edge}}, 73728), edge)
        self.assertIsNone(shim.window_full({"usage": {"prompt_tokens": edge - 1}}, 73728))
        self.assertIsNone(shim.window_full({"usage": {"prompt_tokens": 80000}}, None))
        self.assertIsNone(shim.window_full({"choices": []}, 73728))
        self.assertIsNone(shim.window_full("not json", 73728))

    def test_a_budget_above_the_cap_is_lowered_and_nothing_else_moves(self) -> None:
        request = {"model": "x", "max_tokens": 13000, "max_completion_tokens": 9000, "temperature": 0.3}
        out, lowered = shim.clamp_output_budget(request, 4096)
        self.assertEqual((out["max_tokens"], out["max_completion_tokens"], out["temperature"], lowered),
                         (4096, 4096, 0.3, 13000))
        self.assertEqual(request["max_tokens"], 13000)

    def test_a_budget_is_never_raised_added_or_read_from_a_bool(self) -> None:
        for request in ({"max_tokens": 200}, {}, {"max_tokens": True}):
            self.assertEqual(shim.clamp_output_budget(request, 4096), (request, None))
        self.assertEqual(shim.clamp_output_budget({"max_tokens": 13000}, None), ({"max_tokens": 13000}, None))


SUMMARIZER = shim.COMPACTION_MARKERS[0] + " ... produce the summary."
CUT = "<state_snapshot>\n    <next_step>\n        Fix D1 in local_seat_report_lib.bb.\n    </next_step>\n    <current_work>\n        Reading"


def cut_completion(content: str) -> dict:
    out = completion(content)
    out["choices"][0]["finish_reason"] = "length"
    return out


class CompactionTests(unittest.TestCase):
    """2026-10-04: a compaction summary is capped, and closed when cut."""

    def test_the_summarizer_system_prompt_or_the_last_directive_marks_a_compaction(self) -> None:
        self.assertTrue(shim.is_compaction_request({"messages": [
            {"role": "system", "content": SUMMARIZER}, {"role": "user", "content": "history"}]}))
        self.assertTrue(shim.is_compaction_request({"messages": [
            {"role": "user", "content": "history"},
            {"role": "user", "content": [{"type": "text", "text": shim.COMPACTION_MARKERS[1]}]}]}))

    def test_a_marker_quoted_in_the_history_is_not_a_compaction(self) -> None:
        self.assertFalse(shim.is_compaction_request({"messages": [
            {"role": "system", "content": "You are a SwarmForge agent."},
            {"role": "user", "content": SUMMARIZER},
            {"role": "user", "content": "go on"}]}))
        self.assertFalse(shim.is_compaction_request({"messages": []}))

    def test_the_budget_is_capped_and_added_when_absent(self) -> None:
        capped, lowered = shim.compaction_budget({"max_tokens": 9000}, 1200)
        self.assertEqual((capped["max_tokens"], lowered), (1200, 9000))
        added, lowered = shim.compaction_budget({"messages": []}, 1200)
        self.assertEqual((added["max_tokens"], lowered), (1200, None))
        kept, lowered = shim.compaction_budget({"max_tokens": 800}, 1200)
        self.assertEqual((kept["max_tokens"], lowered), (800, None))

    def test_the_side_query_loses_its_ask_for_analysis(self) -> None:
        system = ("You are the component that summarizes a conversation.\n\n"
                  "First, wrap your reasoning in an <analysis> block. Inside it, walk through it all.\n\n"
                  "Then produce the final summary as the EXACT XML structure below.")
        request = {"max_tokens": 9000, "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": shim.COMPACTION_MARKERS[1] + " (history)"},
            {"role": "assistant", "content": "earlier"},
            {"role": "user", "content": [{"type": "text", "text": "Do not call tools. " + shim.COMPACTION_MARKERS[1]}]}]}
        out = shim.without_analysis_request(request)
        self.assertNotIn("wrap your reasoning", out["messages"][0]["content"])
        self.assertIn("Do not write an <analysis> block.\n\nThen produce the final summary", out["messages"][0]["content"])
        self.assertEqual(out["messages"][-1]["content"][0]["text"], "Do not call tools. " + shim.NO_ANALYSIS_DIRECTIVE)
        self.assertEqual(out["messages"][1:3], request["messages"][1:3])
        self.assertEqual(request["messages"][0]["content"], system)

    def test_an_analysis_only_reply_becomes_a_snapshot(self) -> None:
        wrapped, did = shim.salvage_analysis_only(cut_completion("<analysis>\nChronological: read D1, edited lib"))
        text = wrapped["choices"][0]["message"]["content"]
        self.assertTrue(did)
        self.assertEqual(text, "<state_snapshot>\n<current_work>\nChronological: read D1, edited lib\n</current_work>\n</state_snapshot>")
        for reply in (cut_completion(CUT), completion("no tags at all"), cut_completion("<analysis></analysis>")):
            self.assertEqual(shim.salvage_analysis_only(reply), (reply, False))

    def test_a_cut_snapshot_is_closed_and_nothing_else_is(self) -> None:
        closed, did = shim.close_cut_snapshot(cut_completion(CUT))
        self.assertTrue(did)
        self.assertTrue(closed["choices"][0]["message"]["content"].endswith("Reading\n</state_snapshot>"))
        for reply in (completion(CUT), cut_completion(CUT + "\n</state_snapshot>"), cut_completion("no snapshot")):
            self.assertEqual(shim.close_cut_snapshot(reply), (reply, False))


BAD_CALL_ERROR = {"error": {"message": 'llama-server returned invalid tool call arguments for "run_shell_command": unexpected end of JSON input'}}


class FakeOllama(BaseHTTPRequestHandler):
    seen: list = []
    bad_calls: dict = {}

    def log_message(self, *_a) -> None:
        pass

    def _reply(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._reply({"object": "list", "data": [{"id": "m"}], "path": self.path})

    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if self.path == "/api/show":
            params = "num_ctx 32768\nnum_predict 4096" if body.get("model") == "capped" else "num_ctx 32768"
            self._reply({"parameters": params})
            return
        FakeOllama.seen.append((self.path, body))
        last = (body.get("messages") or [{}])[-1]
        if shim.is_compaction_request(body):
            self._reply(cut_completion(CUT))
        elif last.get("content") == "announce, please":
            self._reply(completion("I will now run the ready_for_next.sh script."))
        elif last.get("content") in ("bad call once", "bad call always"):
            n = FakeOllama.bad_calls.get(last["content"], 0) + 1
            FakeOllama.bad_calls[last["content"]] = n
            if last["content"] == "bad call always" or n == 1:
                self._reply(BAD_CALL_ERROR, 500)
            else:
                self._reply(completion(FENCED))
        elif last.get("content") == "summarize, please":
            self._reply(cut_completion("A long summary of the history so far."))
        else:
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

    def test_an_announcement_is_nudged_once_into_a_call(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        before = len(FakeOllama.seen)
        out = json.loads(self.post({"model": "m", "tools": tools,
                                    "messages": [{"role": "user", "content": "announce, please"}]}))
        message = out["choices"][0]["message"]
        self.assertEqual(message["content"], "I will now run the ready_for_next.sh script.")
        self.assertEqual(message["tool_calls"][0]["function"]["name"], "read_file")
        self.assertEqual(len(FakeOllama.seen) - before, 2)
        self.assertEqual(FakeOllama.seen[-1][1]["messages"][-1], {"role": "user", "content": shim.NUDGE})

    def test_request_without_tools_and_other_paths_pass_through(self) -> None:
        out = json.loads(self.post({"model": "m", "messages": [{"role": "user", "content": "hi"}]}))
        self.assertEqual(out["choices"][0]["message"]["content"], FENCED)
        with urllib.request.urlopen(self.base + "/v1/models", timeout=10) as resp:
            self.assertEqual(json.loads(resp.read())["path"], "/v1/models")

    def test_a_tool_request_reaches_ollama_with_the_modelfile_cap(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        self.post({"model": "capped", "max_tokens": 13000, "tools": tools,
                   "messages": [{"role": "user", "content": "read it"}]})
        self.assertEqual(FakeOllama.seen[-1][1]["max_tokens"], 4096)

    def test_a_tool_less_compression_request_reaches_ollama_with_the_modelfile_cap(self) -> None:
        self.post({"model": "capped", "max_tokens": 13000,
                   "messages": [{"role": "system", "content": "summarize the history"}]})
        self.assertEqual(FakeOllama.seen[-1][1]["max_tokens"], 4096)

    def test_a_streamed_compaction_reaches_ollama_capped_and_comes_back_closed(self) -> None:
        raw = self.post({"model": "capped", "max_tokens": 9000, "stream": True,
                         "messages": [{"role": "system", "content": SUMMARIZER},
                                      {"role": "user", "content": "the history"}]}).decode()
        events = [line[len("data: "):] for line in raw.splitlines() if line.startswith("data: ")]
        self.assertEqual(events[-1], "[DONE]")
        chunks = [json.loads(e) for e in events[:-1]]
        self.assertTrue(chunks[0]["choices"][0]["delta"]["content"].endswith("</state_snapshot>"))
        self.assertEqual(chunks[1]["choices"][0]["finish_reason"], "length")
        _path, sent = FakeOllama.seen[-1]
        self.assertEqual((sent["max_tokens"], sent["stream"]), (shim.COMPACTION_OUTPUT_CAP, False))

    def test_a_compaction_reaches_ollama_without_the_analysis_directive(self) -> None:
        self.post({"model": "capped", "messages": [{"role": "system", "content": SUMMARIZER},
                                                   {"role": "user", "content": shim.COMPACTION_MARKERS[1]}]})
        _path, sent = FakeOllama.seen[-1]
        self.assertEqual(sent["messages"][-1]["content"], shim.NO_ANALYSIS_DIRECTIVE)

    def test_a_compaction_reaches_ollama_with_the_chats_stripped_history(self) -> None:
        call = [{"id": "call_a", "type": "function", "function": {"name": "read_file", "arguments": "{}"}}]
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        self.post({"model": "capped", "tools": tools, "messages": [
            {"role": "system", "content": "You are a SwarmForge agent."},
            {"role": "user", "content": "go"},
            {"role": "assistant", "content": "I'll read the card.", "tool_calls": call},
            {"role": "tool", "tool_call_id": "call_a", "content": "card"},
            {"role": "user", "content": "Do not call tools. " + shim.COMPACTION_MARKERS[1]}]})
        _path, sent = FakeOllama.seen[-1]
        self.assertEqual(sent["messages"][2]["content"], "")
        self.assertEqual(sent["messages"][-1]["content"], "Do not call tools. " + shim.NO_ANALYSIS_DIRECTIVE)
        self.assertEqual(sent["max_tokens"], shim.COMPACTION_OUTPUT_CAP)

    def test_a_compaction_reaches_ollama_with_thinking_off(self) -> None:
        self.post({"model": "capped", "think": True,
                   "messages": [{"role": "system", "content": SUMMARIZER}, {"role": "user", "content": "history"}]})
        _path, sent = FakeOllama.seen[-1]
        self.assertEqual((sent["think"], sent["reasoning_effort"]), (False, "none"))

    def test_a_tool_request_keeps_the_clients_thinking_knobs(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        self.post({"model": "m", "tools": tools, "messages": [{"role": "user", "content": "read it"}]})
        _path, sent = FakeOllama.seen[-1]
        self.assertNotIn("think", sent)
        self.assertNotIn("reasoning_effort", sent)

    def test_a_model_with_no_num_predict_keeps_the_client_budget(self) -> None:
        self.post({"model": "m", "max_tokens": 13000, "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(FakeOllama.seen[-1][1]["max_tokens"], 13000)

    def test_a_reply_cut_at_the_cap_reaches_the_client_as_length(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        out = json.loads(self.post({"model": "capped", "max_tokens": 13000, "tools": tools,
                                    "messages": [{"role": "user", "content": "summarize, please"}]}))
        self.assertEqual(out["choices"][0]["finish_reason"], "length")
        self.assertEqual(FakeOllama.seen[-1][1]["max_tokens"], 4096)

    def test_a_tool_less_reply_cut_at_the_cap_reaches_the_client_as_length(self) -> None:
        out = json.loads(self.post({"model": "capped", "max_tokens": 13000,
                                    "messages": [{"role": "user", "content": "summarize, please"}]}))
        self.assertEqual(out["choices"][0]["finish_reason"], "length")
        self.assertEqual(FakeOllama.seen[-1][1]["max_tokens"], 4096)

    def test_health_names_the_shim_and_ensure_refuses_a_foreign_port(self) -> None:
        port = self.shim.server_address[1]
        self.assertEqual(shim.probe(port), {"shim": shim.NAME, "upstream": self.upstream_url, "last_seat": "-"})
        self.assertEqual(shim.ensure(port, self.upstream_url, "/dev/null"), 0)
        self.assertEqual(shim.ensure(self.upstream.server_address[1], self.upstream_url, "/dev/null"), 1)


class SeatOfPathTests(unittest.TestCase):
    def test_a_seat_path_strips_to_the_v1_path(self) -> None:
        self.assertEqual(shim.seat_of_path("/seat/coder/v1/chat/completions"), ("coder", "/v1/chat/completions"))
        self.assertEqual(shim.seat_of_path("/seat/coder@2/v1/chat/completions"), ("coder@2", "/v1/chat/completions"))

    def test_a_plain_path_is_served_as_is_with_no_seat(self) -> None:
        self.assertEqual(shim.seat_of_path("/v1/chat/completions"), ("-", "/v1/chat/completions"))
        self.assertEqual(shim.seat_of_path("/v1/models"), ("-", "/v1/models"))

    def test_a_path_with_no_v1_segment_is_not_a_seat_path(self) -> None:
        self.assertEqual(shim.seat_of_path("/seat/coder/api/show"), ("-", "/seat/coder/api/show"))


class SeatNamedLiveTests(unittest.TestCase):
    """BL-2076: a completion sent at a seat's URL reaches Ollama unchanged
    and is logged with that seat; a switch of seat is logged as switch=1;
    the plain /v1 path is still served and logged with seat '-'."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.upstream = ThreadingHTTPServer(("127.0.0.1", 0), FakeOllama)
        serve(cls.upstream)
        cls.upstream_url = f"http://127.0.0.1:{cls.upstream.server_address[1]}/v1"
        cls.shim = shim.make_server(0, cls.upstream_url)
        cls.shim_handler = cls.shim.RequestHandlerClass
        cls.shim_handler.last_seat = "-"
        serve(cls.shim)
        cls.base = f"http://127.0.0.1:{cls.shim.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.shim.shutdown()
        cls.upstream.shutdown()

    def post(self, path: str, body: dict) -> bytes:
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read()

    def test_a_seat_url_reaches_ollama_unchanged_and_is_logged_with_the_seat(self) -> None:
        for seat in ("coder", "coder@2"):
            before = len(FakeOllama.seen)
            raw = self.post(f"/seat/{seat}/v1/chat/completions",
                            {"model": "m", "messages": [{"role": "user", "content": "read it"}]})
            path, sent = FakeOllama.seen[-1]
            self.assertEqual(path, "/v1/chat/completions")
            self.assertEqual(sent, {"model": "m", "messages": [{"role": "user", "content": "read it"}]})
            self.assertEqual(len(FakeOllama.seen) - before, 1)
            self.assertIn(f"chat seat={seat} duration_ms=", shim._log_lines[-1])
            self.assertIn("prompt_tokens=9", shim._log_lines[-1])
            self.assertIn("switch=", shim._log_lines[-1])
            self.assertEqual(json.loads(raw)["usage"]["prompt_tokens"], 9)

    def test_a_seat_switch_is_logged_as_a_switch(self) -> None:
        self.post("/seat/coder/v1/chat/completions",
                  {"model": "m", "messages": [{"role": "user", "content": "one"}]})
        self.post("/seat/coder/v1/chat/completions",
                  {"model": "m", "messages": [{"role": "user", "content": "two"}]})
        self.assertIn("switch=0", shim._log_lines[-1])
        self.post("/seat/QA/v1/chat/completions",
                  {"model": "m", "messages": [{"role": "user", "content": "three"}]})
        self.assertIn("switch=1", shim._log_lines[-1])
        self.assertIn("seat=QA", shim._log_lines[-1])

    def test_the_plain_v1_path_is_served_and_logged_with_no_seat(self) -> None:
        before = len(FakeOllama.seen)
        raw = self.post("/v1/chat/completions",
                        {"model": "m", "messages": [{"role": "user", "content": "read it"}]})
        path, sent = FakeOllama.seen[-1]
        self.assertEqual(path, "/v1/chat/completions")
        self.assertEqual(len(FakeOllama.seen) - before, 1)
        self.assertIn("chat seat=- duration_ms=", shim._log_lines[-1])
        self.assertIn("prompt_tokens=9", shim._log_lines[-1])
        self.assertEqual(json.loads(raw)["usage"]["prompt_tokens"], 9)

    def test_health_names_the_last_seat_served(self) -> None:
        self.post("/seat/coder/v1/chat/completions",
                  {"model": "m", "messages": [{"role": "user", "content": "read it"}]})
        health = shim.probe(self.shim.server_address[1])
        self.assertEqual(health["last_seat"], "coder")


class BadToolCallTests(unittest.TestCase):
    def test_only_a_parse_failure_counts(self) -> None:
        self.assertTrue(shim.is_bad_tool_call(500, BAD_CALL_ERROR))
        self.assertFalse(shim.is_bad_tool_call(500, {"error": {"message": "model not found"}}))
        self.assertFalse(shim.is_bad_tool_call(200, BAD_CALL_ERROR))


class BadToolCallLiveTests(LiveShimTests):
    def test_a_bad_tool_call_is_retried_and_the_seat_gets_a_real_call(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        FakeOllama.bad_calls.pop("bad call once", None)
        raw = self.post({"model": "m", "messages": [{"role": "user", "content": "bad call once"}], "tools": tools})
        reply = json.loads(raw)
        self.assertEqual(reply["choices"][0]["message"]["tool_calls"][0]["function"]["name"], "read_file")
        self.assertEqual(FakeOllama.bad_calls["bad call once"], 2)

    def test_a_bad_tool_call_that_persists_still_returns_the_error(self) -> None:
        tools = [{"type": "function", "function": {"name": "read_file", "parameters": {}}}]
        FakeOllama.bad_calls.pop("bad call always", None)
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.post({"model": "m", "messages": [{"role": "user", "content": "bad call always"}], "tools": tools})
        self.assertEqual(caught.exception.code, 500)
        self.assertEqual(FakeOllama.bad_calls["bad call always"], 1 + shim.BAD_TOOL_CALL_RETRIES)


if __name__ == "__main__":
    unittest.main()

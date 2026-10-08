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
And a reply that announces an action but calls no tool is asked once more,
"Call the tool now." (BL-1920) - never when the seat is idle on NO_TASK.

Every chat completion, with tools or without, has its max_tokens (and
max_completion_tokens) lowered to the num_predict the model's own Modelfile
declares, read from Ollama's /api/show (2026-10-03 hotfix). Ollama lets a
request's max_tokens override the Modelfile, and qwen sends a large one, so
iq3's declared 4096 never bound: its tool-less compression summaries ran 8-14k
tokens and took about 89% of the coder's wall clock. A model with no
num_predict, or an /api/show that fails, is left unclamped.

qwen's compression side-query (its summarizer system prompt, or the directive
it sends last) goes upstream unstreamed with its budget capped at
COMPACTION_OUTPUT_CAP, and a summary cut at that cap gets its
</state_snapshot> back (2026-10-04 hotfix). iq3 wrote 2.7-3.8k-token
summaries at about 26 tokens/s, so each compaction took 146-188 s and the
coder spent 76% of its model time compacting. The cap is the 900 words the
PreCompact hook asks for; the hook puts <next_step> first, so a cut loses
only the tail sections, and qwen's cache-sharing path drops a snapshot that
never closes. The side-query also goes up with thinking off: it reached
Ollama without the seat's think:false, iq3 spent all 1200 tokens in hidden
reasoning, five compactions in a row came back empty
(COMPRESSION_FAILED_EMPTY_SUMMARY), and the seat hit qwen's hard limit.
Replayed: 4329 chars of reasoning and no content with thinking on; a
<state_snapshot> opening with <next_step> with it off. qwen does send
think:false, though (the shim logs client_think=False): the empty summaries
were replies that opened with qwen's requested <analysis> block and spent
the cap on it, and qwen strips that block. So the side-query also loses
qwen's ask for <analysis> first, and a reply that is still analysis only is
wrapped as the snapshot's <current_work> rather than returned empty.

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
OUTPUT_BUDGET_KEYS = ("max_tokens", "max_completion_tokens")
OUTPUT_CAP_TTL_S = 300.0
COMPACTION_OUTPUT_CAP = 1200
# 2026-10-04: a prompt this close to the served window was cut, or nearly:
# Ollama drops the front of a prompt longer than num_ctx without an error.
WINDOW_FULL_MARGIN = 1024
COMPACTION_MARKERS = (
    "You are the component that summarizes a conversation",
    "First, reason in your <analysis> block. Then, produce the <state_snapshot> XML.",
)
SNAPSHOT_OPEN, SNAPSHOT_CLOSE = "<state_snapshot>", "</state_snapshot>"
COMPACTION_NO_THINKING = {"think": False, "reasoning_effort": "none"}
NO_ANALYSIS_DIRECTIVE = ("Produce the <state_snapshot> XML now: start your reply with <state_snapshot> "
                         "and then <next_step>, and write no <analysis> block.")
_ANALYSIS_PARAGRAPH = re.compile(r"First, wrap your reasoning in an <analysis> block\..*?(?=\n\nThen produce)", re.DOTALL)
_ANALYSIS_TAGS = re.compile(r"</?analysis>")

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
    """Turns the FIRST text tool call in a non-streamed chat completion into
    a tool_call, and drops the rest of them from the reply.

    A model that writes its whole plan as calls in one reply never sees a
    result before its next step: on 2026-10-03 the coder seat wrote ten
    (write the evidence, git add, commit, write the handoff draft, send it,
    done_with_current, ready_for_next) and all ten ran blind - a path with
    a literal $(date ...) in it, a draft reading "NONE", a commit of a file
    that did not exist. One call per reply, and it plans the next from
    what came back.

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
    calls = calls[:1]
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


_ANNOUNCE = re.compile(
    r"(?i)(?:^|[.!?:]\s+|\n)\s*(?:(?:now|next|first|then),?\s+)?"
    r"(?:i\s+will|i'll|i\s+am\s+going\s+to|i'm\s+going\s+to|let\s+me|let['’]s|let\s+us)\b"
)
# A seat has no one to answer it: "Could you please provide more
# information about the task?" stalls it exactly like an announcement does.
_ASKS_USER = re.compile(
    r"(?i)\b(?:could|can|would)\s+you\b|\bplease\s+(?:provide|clarify|specify|confirm|share|tell|let\s+me\s+know)\b"
)
NUDGE = "Call the tool now. Reply with the tool call only."


def needs_nudge(request: dict[str, Any], completion: dict[str, Any]) -> bool:
    """True when the reply announces an action, or asks the user for input,
    and calls no tool (BL-1920; the question case 2026-10-03).

    A seat that once ended a turn on "I will now run X" and no call saw that
    turn in its history and kept announcing: 3 of 3 replays of the live
    conversation. qwen's own "Please continue." still got prose 3 of 3;
    this nudge got the call 3 of 3. Never when the request ends on a tool
    result reading NO_TASK, or the reply itself says NO_TASK: an idle seat
    nudged into ready_for_next.sh again would spin, and handoffd halts the
    whole swarm on a NO_TASK spin."""
    choice = (completion.get("choices") or [{}])[0] or {}
    message = choice.get("message") or {}
    if message.get("tool_calls") or choice.get("finish_reason") not in (None, "stop"):
        return False
    text = str(message.get("content") or "")
    if not text.strip() or "NO_TASK" in text or not (_ANNOUNCE.search(text) or _ASKS_USER.search(text)):
        return False
    messages = request.get("messages") or []
    last = messages[-1] if messages else {}
    return not (isinstance(last, dict) and last.get("role") == "tool" and "NO_TASK" in str(last.get("content")))


def nudged_request(request: dict[str, Any], text: str) -> dict[str, Any]:
    """The request again, with the announcement as the model's turn and the nudge after it."""
    return {**request, "messages": [*(request.get("messages") or []),
                                    {"role": "assistant", "content": text}, {"role": "user", "content": NUDGE}]}


def merge_nudged(original: dict[str, Any], nudged: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """The original reply's text with the nudged reply's tool calls, or the
    original unchanged when the nudge got no call either."""
    nudged_message = ((nudged.get("choices") or [{}])[0] or {}).get("message") or {}
    if not nudged_message.get("tool_calls"):
        return original, False
    choice = original["choices"][0]
    choice["message"] = {**(choice.get("message") or {}), "tool_calls": nudged_message["tool_calls"]}
    choice["finish_reason"] = "tool_calls"
    return original, True


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


def _positive_param(show: Any, name: str) -> int | None:
    params = show.get("parameters") if isinstance(show, dict) else None
    for line in str(params or "").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[0] == name and re.fullmatch(r"-?\d+", parts[1]):
            value = int(parts[1])
            return value if value > 0 else None
    return None


def num_predict_of(show: Any) -> int | None:
    """The positive num_predict an Ollama /api/show answer declares, else None
    (absent, unreadable, or -1/-2, which Ollama reads as unlimited)."""
    return _positive_param(show, "num_predict")


def num_ctx_of(show: Any) -> int | None:
    """The window the model is served with (its Modelfile's num_ctx), else None."""
    return _positive_param(show, "num_ctx")


def window_full(completion: Any, num_ctx: int | None) -> int | None:
    """The completion's prompt_tokens when they reach WINDOW_FULL_MARGIN of the
    served window, else None. A seat behind the shim declares a larger window
    to qwen than Ollama serves (local_model_window_gate_lib.bb declared-window),
    so this is the one place an overshoot can be seen."""
    usage = completion.get("usage") if isinstance(completion, dict) else None
    prompt = usage.get("prompt_tokens") if isinstance(usage, dict) else None
    if not num_ctx or not isinstance(prompt, int):
        return None
    return prompt if prompt >= num_ctx - WINDOW_FULL_MARGIN else None


def clamp_output_budget(request: dict[str, Any], cap: int | None) -> tuple[dict[str, Any], int | None]:
    """The request with every output budget above cap lowered to cap, and the
    largest value lowered (None when nothing changed). Never raises a budget
    and never adds one: an absent max_tokens already falls back to the
    Modelfile."""
    if not cap:
        return request, None
    out, lowered = request, None
    for key in OUTPUT_BUDGET_KEYS:
        value = request.get(key)
        if isinstance(value, int) and not isinstance(value, bool) and value > cap:
            if out is request:
                out = dict(request)
            out[key] = cap
            lowered = max(lowered or 0, value)
    return out, lowered


def _message_text(message: Any) -> str:
    content = message.get("content") if isinstance(message, dict) else None
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(str(part.get("text") or "") for part in content if isinstance(part, dict))
    return ""


def is_compaction_request(request: dict[str, Any]) -> bool:
    """True for qwen's compression side-query: a system message carrying its
    summarizer prompt, or a last USER message carrying its request directive.
    The history in between is never read, since a summary or a file the seat
    read can quote either marker - and neither is a last message that is a
    tool result: on 2026-10-04 the coder read this file for BL-1936 and its
    next ordinary turn was capped as a compaction."""
    messages = [m for m in (request.get("messages") or []) if isinstance(m, dict)]
    last = [m for m in messages[-1:] if m.get("role") == "user"]
    candidates = [m for m in messages if m.get("role") == "system"] + last
    return any(marker in _message_text(m) for m in candidates for marker in COMPACTION_MARKERS)


def compaction_budget(request: dict[str, Any], cap: int) -> tuple[dict[str, Any], int | None]:
    """The request with every output budget at most cap, and max_tokens set to
    cap when it names none; the largest value lowered, as clamp_output_budget."""
    out, lowered = clamp_output_budget(request, cap)
    if not any(isinstance(request.get(k), int) and not isinstance(request.get(k), bool) for k in OUTPUT_BUDGET_KEYS):
        out = {**out, "max_tokens": cap}
    return out, lowered


def _rewritten_text(text: str) -> str:
    text = _ANALYSIS_PARAGRAPH.sub("Do not write an <analysis> block.", text)
    return text.replace(COMPACTION_MARKERS[1], NO_ANALYSIS_DIRECTIVE)


def without_analysis_request(request: dict[str, Any]) -> dict[str, Any]:
    """The side-query with qwen's ask for an <analysis> block first taken out
    of its system messages and its last message, where qwen puts it."""
    messages = list(request.get("messages") or [])
    for i, message in enumerate(messages):
        if not isinstance(message, dict) or (message.get("role") != "system" and i != len(messages) - 1):
            continue
        content = message.get("content")
        if isinstance(content, str):
            messages[i] = {**message, "content": _rewritten_text(content)}
        elif isinstance(content, list):
            messages[i] = {**message, "content": [
                {**part, "text": _rewritten_text(part["text"])} if isinstance(part, dict) and isinstance(part.get("text"), str) else part
                for part in content]}
    return {**request, "messages": messages}


def salvage_analysis_only(completion: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """A reply holding analysis and no <state_snapshot>, with that analysis
    wrapped as the snapshot's <current_work> (qwen strips an <analysis>
    block, so returned as is it summarises to nothing); True when wrapped."""
    choice = (completion.get("choices") or [{}])[0] or {}
    message = choice.get("message") or {}
    text = message.get("content")
    if not isinstance(text, str) or SNAPSHOT_OPEN in text or "<analysis>" not in text:
        return completion, False
    notes = _ANALYSIS_TAGS.sub("", text).strip()
    if not notes:
        return completion, False
    wrapped = f"{SNAPSHOT_OPEN}\n<current_work>\n{notes}\n</current_work>\n{SNAPSHOT_CLOSE}"
    return {**completion, "choices": [{**choice, "message": {**message, "content": wrapped}}] + list(completion["choices"][1:])}, True


def close_cut_snapshot(completion: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """A reply cut at its budget whose <state_snapshot> opened and never
    closed, with the closing tag appended; True when it was appended."""
    choice = (completion.get("choices") or [{}])[0] or {}
    message = choice.get("message") or {}
    text = message.get("content")
    if choice.get("finish_reason") != "length" or not isinstance(text, str):
        return completion, False
    if SNAPSHOT_OPEN not in text or SNAPSHOT_CLOSE in text[text.index(SNAPSHOT_OPEN):]:
        return completion, False
    closed = {**message, "content": text.rstrip() + "\n" + SNAPSHOT_CLOSE}
    return {**completion, "choices": [{**choice, "message": closed}] + list(completion["choices"][1:])}, True


# 2026-10-05: llama-server sometimes rejects a tool call the model wrote as
# broken JSON ("llama-server returned invalid tool call arguments for ...:
# unexpected end of JSON input") and Ollama answers 500. qwen then stops the
# turn at "Press Ctrl+Y to retry", which a one-shot seat can never press, so
# the iq3 coder sat halted on BL-1930 from 12:27Z. The model samples, so the
# same request usually comes back well formed: the shim retries it.
BAD_TOOL_CALL_RETRIES = 2


def is_bad_tool_call(status: int, payload: Any) -> bool:
    """True for an upstream failure caused by a tool call llama-server could
    not parse, never for any other error."""
    if status < 500:
        return False
    text = payload if isinstance(payload, str) else json.dumps(payload)
    return "invalid tool call arguments" in text


def upstream_root(upstream: str) -> str:
    root = upstream.rstrip("/")
    return root[: -len("/v1")] if root.endswith("/v1") else root


def seat_of_path(path: str) -> tuple[str, str]:
    """The seat a request path names and the path to forward upstream:
    /seat/<seat>/v1/... strips to /v1/...; any other path is served as-is
    with seat '-' (the plain /v1 path, BL-2076)."""
    parts = path.split("/")
    if len(parts) >= 4 and parts[1] == "seat" and parts[3] == "v1":
        return parts[2], "/" + "/".join(parts[3:])
    return "-", path


# The shim's own log lines, in order: the tests read the last one.
_log_lines: list[str] = []


def _log(message: str) -> None:
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {message}"
    _log_lines.append(line)
    print(line, file=sys.stderr, flush=True)


class ShimHandler(BaseHTTPRequestHandler):
    upstream = "http://127.0.0.1:11434/v1"
    timeout_s = 900.0
    keepalive_s = 15.0
    output_caps: dict[str, tuple[int | None, float]] = {}
    last_seat = "-"  # the seat the last forwarded chat completion came from

    def log_message(self, *_args: Any) -> None:  # the shim logs its own lines
        pass

    def do_GET(self) -> None:
        if self.path == HEALTH_PATH:
            self._send_json(200, {"shim": NAME, "upstream": self.upstream, "last_seat": self.last_seat})
            return
        self._passthrough(None)

    def do_HEAD(self) -> None:
        self._passthrough(None)

    def do_DELETE(self) -> None:
        self._passthrough(self._read_body())

    def do_POST(self) -> None:
        self._completion_started = time.monotonic()
        body = self._read_body()
        seat, upstream_path = seat_of_path(self.path)
        self.path = upstream_path
        if self.path.rstrip("/").endswith("/chat/completions"):
            try:
                request = json.loads(body or b"{}")
            except ValueError:
                request = None
            if isinstance(request, dict) and is_compaction_request(request):
                self._respond(request, self._compact)
                return
            if isinstance(request, dict) and declared_tool_names(request):
                self._shim_chat(request, seat)
                return
            if isinstance(request, dict):
                clamped, lowered = clamp_output_budget(request, self._output_cap(request.get("model")))
                if lowered is not None:
                    body = json.dumps(clamped).encode()
                    _log(f"passthrough model={request.get('model')} budget={lowered}->{clamped.get('max_tokens', clamped.get('max_completion_tokens'))}")
        self._passthrough(body, seat)

    def _limits(self, model: Any) -> tuple[int | None, int | None]:
        """The model's Modelfile (num_predict, num_ctx), cached for
        OUTPUT_CAP_TTL_S so an `ollama create` is picked up without a restart.
        A failed lookup is not cached and leaves the request unclamped."""
        if not isinstance(model, str) or not model:
            return None, None
        cached = self.output_caps.get(model)
        if cached and time.monotonic() - cached[1] < OUTPUT_CAP_TTL_S:
            return cached[0]
        req = urllib.request.Request(
            upstream_root(self.upstream) + "/api/show", data=json.dumps({"model": model}).encode(),
            method="POST", headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                show = json.loads(resp.read() or b"{}")
        except (urllib.error.URLError, OSError, ValueError):
            return None, None
        limits = (num_predict_of(show), num_ctx_of(show))
        self.output_caps[model] = (limits, time.monotonic())
        return limits

    def _output_cap(self, model: Any) -> int | None:
        return self._limits(model)[0]

    def _log_window_full(self, kind: str, model: Any, payload: Any) -> None:
        num_ctx = self._limits(model)[1]
        prompt = window_full(payload, num_ctx)
        if prompt is not None:
            _log(f"WINDOW_FULL {kind} model={model} prompt_tokens={prompt} num_ctx={num_ctx} "
                 "- Ollama may have cut the front of this prompt")

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

    def _passthrough(self, body: bytes | None, seat: str = "-") -> None:
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
            data = b""
            while True:
                piece = resp.read1(65536) if hasattr(resp, "read1") else resp.read(65536)
                if not piece:
                    break
                data += piece
                self.wfile.write(piece)
                self.wfile.flush()
        if self.command == "POST" and self.path.rstrip("/").endswith("/chat/completions"):
            self._log_chat_completion(seat, data)

    def _log_chat_completion(self, seat: str, raw: bytes) -> None:
        """One line per forwarded chat completion: the seat the request came
        from, its duration, the reply's prompt tokens, and switch=1 when the
        previous forwarded chat completion came from another seat (BL-2076)."""
        started = self._completion_started
        duration_ms = int((time.monotonic() - started) * 1000)
        switch = 0 if seat == self.last_seat else 1
        # A BaseHTTPRequestHandler instance is per-connection, discarded
        # after one request: `self.last_seat = seat` would only ever shadow
        # the class attribute on this instance, leaving every later request
        # reading back the unchanged class default and switch always 1.
        type(self).last_seat = seat
        prompt_tokens = None
        try:
            payload = json.loads(raw or b"{}")
            if isinstance(payload, dict):
                usage = payload.get("usage")
                if isinstance(usage, dict):
                    prompt_tokens = usage.get("prompt_tokens")
        except ValueError:
            pass
        _log(f"chat seat={seat} duration_ms={duration_ms} prompt_tokens={prompt_tokens} switch={switch}")

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

    @staticmethod
    def _parsed(status: int, raw: bytes) -> tuple[int, Any]:
        try:
            return status, json.loads(raw or b"{}")
        except ValueError:
            return status, {"error": {"message": raw.decode(errors="replace")[:500]}}

    def _complete(self, request: dict[str, Any]) -> tuple[int, Any]:
        """One chat completion for the seat: history without text beside its
        calls, text tool calls rewritten, and at most one nudge."""
        names = declared_tool_names(request)
        clamped, lowered = clamp_output_budget(request, self._output_cap(request.get("model")))
        upstream_request, stripped = history_without_call_prose(clamped)
        status, payload = self._parsed(*self._call_upstream(upstream_request))
        retries = 0
        while is_bad_tool_call(status, payload) and retries < BAD_TOOL_CALL_RETRIES:
            retries += 1
            status, payload = self._parsed(*self._call_upstream(upstream_request))
        rewritten, nudge = 0, "none"
        if status == 200 and isinstance(payload, dict):
            payload, rewritten = rewrite_completion(payload, names)
            if needs_nudge(upstream_request, payload):
                text = str(payload["choices"][0]["message"].get("content") or "")
                nudge_status, nudged = self._parsed(*self._call_upstream(nudged_request(upstream_request, text)))
                ok = False
                if nudge_status == 200 and isinstance(nudged, dict):
                    nudged, _ = rewrite_completion(nudged, names)
                    payload, ok = merge_nudged(payload, nudged)
                nudge = "ok" if ok else "no-call"
        finish = ((payload.get("choices") or [{}])[0] or {}).get("finish_reason") if isinstance(payload, dict) else None
        self._log_window_full("chat", request.get("model"), payload)
        _log(f"chat model={request.get('model')} status={status} tools={len(request.get('tools') or [])} "
             f"history_stripped={stripped} rewritten={rewritten} nudge={nudge} finish={finish}"
             + (f" bad_call_retries={retries}" if retries else "")
             + (f" budget={lowered}->{clamped.get('max_tokens', clamped.get('max_completion_tokens'))}" if lowered is not None else ""))
        return status, payload

    def _compact(self, request: dict[str, Any]) -> tuple[int, Any]:
        """qwen's compression side-query, its budget capped and a cut summary
        closed. Nothing else in the request changes."""
        model_cap = self._output_cap(request.get("model"))
        cap = min(COMPACTION_OUTPUT_CAP, model_cap) if model_cap else COMPACTION_OUTPUT_CAP
        # 2026-10-04: the same history the cached conversation was sent with
        # (text beside a tool call stripped, as _complete does), so qwen's
        # cache-shared compaction - eligible once the window passes ~61k -
        # reuses Ollama's prompt cache instead of re-reading ~20k tokens.
        shared, _ = history_without_call_prose(without_analysis_request(request))
        capped, lowered = compaction_budget(shared, cap)
        capped = {**capped, **COMPACTION_NO_THINKING}
        status, payload = self._parsed(*self._call_upstream(capped))
        closed = salvaged = False
        if status == 200 and isinstance(payload, dict):
            payload, salvaged = salvage_analysis_only(payload)
            payload, closed = close_cut_snapshot(payload)
        self._log_window_full("compaction", request.get("model"), payload)
        choice = ((payload.get("choices") or [{}])[0] or {}) if isinstance(payload, dict) else {}
        message = choice.get("message") or {}
        head = str(message.get("content") or "").lstrip()[:24].replace("\n", " ")
        reasoning = len(str(message.get("reasoning") or message.get("reasoning_content") or ""))
        _log(f"compaction model={request.get('model')} status={status} budget={lowered}->"
             f"{capped.get('max_tokens', capped.get('max_completion_tokens'))} client_think={request.get('think')!r} "
             f"finish={choice.get('finish_reason')} closed={closed} salvaged={salvaged} reasoning_chars={reasoning} head={head!r}")
        return status, payload

    def _shim_chat(self, request: dict[str, Any], seat: str) -> None:
        self._respond(request, self._complete, seat)

    def _respond(self, request: dict[str, Any], complete: Callable[[dict[str, Any]], tuple[int, Any]], seat: str = "-") -> None:
        if not request.get("stream"):
            status, payload = complete(request)
            self._send_json(status, payload)
            self._log_chat_completion(seat, json.dumps(payload).encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        box: dict[str, tuple[int, Any]] = {}
        worker = threading.Thread(target=lambda: box.setdefault("r", complete(request)), daemon=True)
        worker.start()
        while worker.is_alive():
            worker.join(self.keepalive_s)
            if worker.is_alive():
                self.wfile.write(b": keepalive\n\n")
                self.wfile.flush()
        status, payload = box["r"]
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
        self._log_chat_completion(seat, json.dumps(payload).encode())


def make_server(port: int, upstream: str, host: str = "127.0.0.1") -> ThreadingHTTPServer:
    handler = type("BoundShimHandler", (ShimHandler,), {"upstream": upstream, "output_caps": {}, "last_seat": "-"})
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

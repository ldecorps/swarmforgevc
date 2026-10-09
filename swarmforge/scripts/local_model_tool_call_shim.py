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
import collections
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


def seat_of_path(path: str) -> tuple[str, str, str]:
    """The seat a request path names, the DECODE-SLOT GROUP it contends
    under, and the path to forward upstream. /seat/<seat>/v1/... strips to
    /v1/... with seat and group both <seat> (BL-2076: no rotation, every
    seat its own group). /seat/<seat>/pane/<pane>/v1/... (BL-2077 D1) is the
    same strip with group <pane> instead - the writer emits this shape only
    for a rotating pack's one resident pane, so every role rotated through
    it shares one group (one decode-slot identity) while the seat segment
    still names whichever role is asking, right up to the shim's own
    health/log output. Any other path is served as-is with seat and group
    both '-' (the plain /v1 path, BL-2076)."""
    parts = path.split("/")
    if len(parts) >= 6 and parts[1] == "seat" and parts[3] == "pane" and parts[5] == "v1":
        return parts[2], parts[4], "/" + "/".join(parts[5:])
    if len(parts) >= 4 and parts[1] == "seat" and parts[3] == "v1":
        return parts[2], parts[2], "/" + "/".join(parts[3:])
    return "-", "-", path


# BL-2077: Ollama (OLLAMA_NUM_PARALLEL 1) serves one completion at a time;
# iq3's cache cannot rewind to a shared prefix (BL-1978), so a completion
# that follows another seat's is a full re-prefill (23-66 s against 4-7 s
# cached). DEFAULT_IDLE_GRACE_S/DEFAULT_HOLD_QUANTUM_S are the 2026-10-08
# measurements' starting values (notes): a 5 min quantum keeps a waiting
# seat's wait at a depth of 3 under qwen's 900 s streamIdleTimeoutMs even
# if a keepalive comment were not counted as activity.
DEFAULT_IDLE_GRACE_S = 30.0
DEFAULT_HOLD_QUANTUM_S = 300.0
# How often a blocked acquire() rechecks idle-grace/hold-quantum state -
# independent of the keepalive_s a streamed client sees comments at, and
# small enough that a short test idle_grace/hold_quantum (fractions of a
# second) is still observed promptly.
_SLOT_POLL_S = 0.02


class DecodeSlot:
    """BL-2077: one Ollama decode slot, held by one seat at a time across
    its burst of chat completions, with an injected clock for deterministic
    tests. The ONE invariant this class exists to keep: acquire() for two
    different GROUPS never both return before one of them calls release().

    - A seat with no current holder is granted at once.
    - The current holder re-asking within its hold quantum is granted at
      once, even with another seat waiting (the holder keeps its burst).
    - The current holder re-asking PAST its hold quantum, with a seat
      waiting, gives up the slot and queues behind the longest-waiting
      seat - "held quantum while another seat waits" (the ticket's own
      wording): a lone holder with no waiter is never forced to queue
      behind itself.
    - A seat that is not the holder waits, UNLESS the holder has been
      idle (no acquire/release activity) past the idle grace, in which
      case it takes over at once.
    - Among several waiters, the longest-waiting one is granted first.

    acquire() blocks the calling thread (never a callback or a second
    notion of "wait") - a streamed caller runs it on the SAME worker
    thread _respond's existing keepalive loop already polls, so a wait
    for the slot is kept alive exactly as a wait for Ollama already is.

    BL-2077 D1 (QA note 003953, 2026-10-09): `seat` and `group` are
    different things. `seat` is the DISPLAY name shown in health/log output
    - whichever role is actually asking. `group` is the decode-slot's own
    CONTENTION identity, defaulting to `seat` itself (every pre-D1 caller,
    and every standing-pack seat, is its own group - no behaviour change).
    A rotating pack's one resident pane gives every role rotated through it
    the SAME group (seat_of_path's /pane/<id>/ segment), so a role rotation
    there is treated exactly like the current holder re-asking - granted at
    once, never gated on the idle grace, while the display name still
    follows whichever role actually sent the request.

    BL-2077 D1 bounce (QA evidence BL-2077-QA-20261009.md): every waiter is
    tracked PER REQUEST (arrival, group, seat, a unique token), never one
    dict entry per group - a group can have several requests in flight of
    it at once (one actually running, the rest genuinely waiting their
    turn), and this predates the pane/group work: the first build's
    per-seat dict had the identical flaw for two concurrent requests from
    ONE seat. A request sharing the holder's group while a sibling of that
    SAME group is still in flight waits for its release rather than being
    granted alongside it - the slot's one invariant now reads: acquire()
    for two different REQUESTS of different groups, or two requests of the
    SAME group where one is already in flight, never both return before a
    release() separates them.
    """

    def __init__(
        self,
        idle_grace_s: float = DEFAULT_IDLE_GRACE_S,
        hold_quantum_s: float = DEFAULT_HOLD_QUANTUM_S,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self.idle_grace_s = idle_grace_s
        self.hold_quantum_s = hold_quantum_s
        self._now = now
        self._cv = threading.Condition()
        self._holder: str | None = None
        self._holder_group: str | None = None
        self._holder_since = 0.0
        self._last_activity = 0.0
        # True while some request of _holder_group is actually running
        # (between a grant and its release()) - the idle grace must never
        # fire while a completion is genuinely in flight, however long it
        # runs (a real re-prefill can take tens of seconds): "idle" means a
        # GAP between completions, measured from the last release(), never
        # from how long the current one has been running. Also what makes
        # a SECOND request of the SAME group wait for its sibling instead
        # of being granted alongside it (BL-2077 D1 bounce).
        self._in_flight = False
        # One entry per WAITING REQUEST, never per group - {arrival, group,
        # seat, token}. token is an object() identity sentinel so two
        # requests of the same group/seat never collide in this list
        # (BL-2077 D1 bounce: a dict keyed by group lost the second one).
        self._waiters: list[dict[str, Any]] = []
        # The seat that last gave the slot up via the hold-quantum queue
        # (never via idle-grace, which reads self._holder directly while
        # it is still set) - self._holder is nulled the INSTANT a holder
        # queues behind a waiter, before the waiter's own thread gets the
        # lock back to claim it, so "who held it before this grant" would
        # otherwise be lost between the two. Cleared the instant a grant
        # consumes it, so a later free slot with nothing vacated reads
        # back to None, never a stale seat name.
        self._vacated_by: str | None = None

    def _grant_locked(self, seat: str, group: str, now: float, reset_since: bool) -> None:
        self._holder = seat
        self._holder_group = group
        if reset_since:
            self._holder_since = now
        self._last_activity = now
        self._in_flight = True

    def _other_group_waiting_locked(self, group: str) -> bool:
        return any(w["group"] != group for w in self._waiters)

    def _winning_token_locked(self, now: float) -> object | None:
        """The ONE waiting request (by token) that may be granted right
        now, given current state, or None if nobody may proceed yet. A
        pure read of self._waiters/_holder_group/_in_flight/_last_activity/
        _holder_since - never mutates, and never itself decides to vacate
        a hold-quantum-spent holder (acquire()'s own loop does that,
        exactly once per discovery, since this function runs on every
        waiting thread's every poll tick)."""
        if not self._waiters:
            return None
        if self._holder_group is None:
            # A free slot: pure FIFO across every waiting request, any
            # group - "queues behind the longest-waiting seat" (the
            # original docstring's own words), never "the other group
            # always wins regardless of arrival order".
            return min(self._waiters, key=lambda w: w["arrival"])["token"]
        if self._in_flight:
            return None
        same_group = [w for w in self._waiters if w["group"] == self._holder_group]
        if same_group and not (
            self._other_group_waiting_locked(self._holder_group)
            and now - self._holder_since > self.hold_quantum_s
        ):
            # A continuation: the earliest-arrived request of the holder's
            # OWN group, waiting only because a sibling request of that
            # same group is (or was) ahead of it - never gated on the idle
            # grace, which is for a genuinely DIFFERENT group only.
            return min(same_group, key=lambda w: w["arrival"])["token"]
        if now - self._last_activity > self.idle_grace_s:
            # Idle takeover: among every OTHER group waiting (the holder's
            # own group is never a candidate here - a vacated holder's own
            # queued requests are handled above, or via the free-slot
            # branch once vacated), only the single longest-waiting group
            # may act, and only its own earliest-arrived request.
            others = [w for w in self._waiters if w["group"] != self._holder_group]
            if others:
                longest_group = min(others, key=lambda w: w["arrival"])["group"]
                candidates = [w for w in others if w["group"] == longest_group]
                return min(candidates, key=lambda w: w["arrival"])["token"]
        return None

    def acquire(self, seat: str, group: str | None = None) -> tuple[str | None, int]:
        """Blocks until `seat` (contending as `group`, default `seat`
        itself) may proceed. Returns (previous_holder, wait_ms) -
        previous_holder is None (wait_ms 0) for a grant that handed over
        nothing: the slot was free, or `group` already held it (with no
        sibling request of that group in flight) and kept it without
        having to wait."""
        group = seat if group is None else group
        with self._cv:
            token = object()
            arrival = self._now()
            self._waiters.append({"arrival": arrival, "group": group, "seat": seat, "token": token})
            try:
                while True:
                    now = self._now()
                    # The hold-quantum check runs only inside a request of
                    # the HOLDER's own group discovering it (never a
                    # timer) - now checked on every poll tick of such a
                    # request rather than only a brand-new call's entry,
                    # so a holder idle between completions with another
                    # group waiting is preempted as soon as ITS OWN
                    # queued continuation (if any) notices, not only when
                    # a fresh request happens to arrive.
                    if (
                        self._holder_group == group
                        and not self._in_flight
                        and self._other_group_waiting_locked(group)
                        and now - self._holder_since > self.hold_quantum_s
                    ):
                        self._vacated_by = self._holder
                        self._holder = None
                        self._holder_group = None
                        self._cv.notify_all()
                    winner = self._winning_token_locked(now)
                    if winner is token:
                        if self._holder_group is None:
                            previous = self._vacated_by
                            self._vacated_by = None
                            reset_since = True
                        elif self._holder_group == group:
                            previous = None
                            reset_since = False
                        else:
                            previous = self._holder
                            reset_since = True
                        self._grant_locked(seat, group, now, reset_since)
                        return previous, int((now - arrival) * 1000)
                    self._cv.wait(timeout=_SLOT_POLL_S)
            finally:
                self._waiters[:] = [w for w in self._waiters if w["token"] is not token]

    def release(self, seat: str, group: str | None = None) -> None:
        """Marks `group`'s activity and clears in-flight (so a waiter's
        idle-grace check starts counting from THIS moment, never from
        when the just-finished completion started) without giving up the
        slot - only a later acquire() (the holder's own group's, past its
        hold quantum, or a different group's, past the idle grace) ever
        hands it over. A sibling request of the SAME group already
        waiting (BL-2077 D1 bounce) is woken to take the slot next,
        exactly like any other waiter."""
        group = seat if group is None else group
        with self._cv:
            if self._holder_group == group:
                self._last_activity = self._now()
                self._in_flight = False
            self._cv.notify_all()

    def snapshot(self) -> dict[str, Any]:
        """GET /shim/health's own view: the holder, how long it has held
        the slot, every waiting REQUEST with its own wait so far (longest
        first, one entry per request even when several share a seat or
        group - BL-2077 D1 bounce), and the two configured durations."""
        with self._cv:
            now = self._now()
            waiters = sorted(self._waiters, key=lambda w: w["arrival"])
            return {
                "holder": self._holder,
                "held_ms": int((now - self._holder_since) * 1000) if self._holder is not None else None,
                "waiters": [{"seat": w["seat"], "wait_ms": int((now - w["arrival"]) * 1000)} for w in waiters],
                "idle_grace_ms": int(self.idle_grace_s * 1000),
                "hold_quantum_ms": int(self.hold_quantum_s * 1000),
            }


# The shim's own log lines, in order, bounded: the long-lived host-wide
# process must not grow unbounded state for a list only the unit tests
# read. The tests read the last one, which a deque still gives by index.
_LOG_LINES_MAX = 200
_log_lines: collections.deque[str] = collections.deque(maxlen=_LOG_LINES_MAX)


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
    slot: DecodeSlot = DecodeSlot()

    def log_message(self, *_args: Any) -> None:  # the shim logs its own lines
        pass

    def do_GET(self) -> None:
        if self.path == HEALTH_PATH:
            self._send_json(200, {
                "shim": NAME, "upstream": self.upstream, "last_seat": self.last_seat,
                "slot": self.slot.snapshot(),
            })
            return
        seat, _group, upstream_path = seat_of_path(self.path)
        self.path = upstream_path
        self._passthrough(None, seat)

    def do_HEAD(self) -> None:
        seat, _group, upstream_path = seat_of_path(self.path)
        self.path = upstream_path
        self._passthrough(None, seat)

    def do_DELETE(self) -> None:
        seat, _group, upstream_path = seat_of_path(self.path)
        self.path = upstream_path
        self._passthrough(self._read_body(), seat)

    def do_POST(self) -> None:
        self._completion_started = time.monotonic()
        body = self._read_body()
        seat, group, upstream_path = seat_of_path(self.path)
        self.path = upstream_path
        if self.path.rstrip("/").endswith("/chat/completions"):
            try:
                request = json.loads(body or b"{}")
            except ValueError:
                request = None
            if isinstance(request, dict) and is_compaction_request(request):
                self._respond(request, self._compact, seat, group)
                return
            if isinstance(request, dict) and declared_tool_names(request):
                self._shim_chat(request, seat, group)
                return
            if isinstance(request, dict):
                clamped, lowered = clamp_output_budget(request, self._output_cap(request.get("model")))
                if lowered is not None:
                    body = json.dumps(clamped).encode()
                    _log(f"passthrough model={request.get('model')} budget={lowered}->{clamped.get('max_tokens', clamped.get('max_completion_tokens'))}")
            self._passthrough_chat(body, seat, group)
            return
        self._passthrough(body, seat)

    def _passthrough_chat(self, body: bytes, seat: str, group: str) -> None:
        """BL-2077: a chat completion with no declared tools, and not a
        compaction side-query, still reaches Ollama's one decode slot -
        acquired synchronously around the raw relay, no keepalive during
        the wait (_passthrough writes response headers and body straight
        to self.wfile as they arrive from upstream, which the worker-
        thread keepalive loop _respond's other two paths use cannot share
        without corrupting the stream). Real local-model seats declare
        tools for every agent turn - the shim's whole reason to exist -
        so this is the rare toolless/health-check shape, never the burst
        a seat holds the slot across."""
        previous, wait_ms = self.slot.acquire(seat, group)
        if previous is not None:
            _log(f"slot_handover seat={seat} wait_ms={wait_ms} previous={previous}")
        try:
            self._passthrough(body, seat)
        finally:
            self.slot.release(seat, group)

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

    def _shim_chat(self, request: dict[str, Any], seat: str, group: str = "-") -> None:
        self._respond(request, self._complete, seat, group)

    def _complete_under_slot(
        self, complete: Callable[[dict[str, Any]], tuple[int, Any]], request: dict[str, Any], seat: str, group: str
    ) -> tuple[int, Any]:
        """BL-2077 invariant 1: one acquire() for the WHOLE client request,
        so complete()'s own extra upstream calls (BL-1920's nudge retry, a
        future BL-1978 warm-up) run under the SAME slot grant - never
        released and re-acquired between them, which would let another
        seat's completion land in the middle of this one's turn."""
        previous, wait_ms = self.slot.acquire(seat, group)
        if previous is not None:
            _log(f"slot_handover seat={seat} wait_ms={wait_ms} previous={previous}")
        try:
            return complete(request)
        finally:
            self.slot.release(seat, group)

    def _respond(
        self, request: dict[str, Any], complete: Callable[[dict[str, Any]], tuple[int, Any]], seat: str = "-", group: str = "-"
    ) -> None:
        guarded = lambda: self._complete_under_slot(complete, request, seat, group)
        if not request.get("stream"):
            status, payload = guarded()
            self._send_json(status, payload)
            self._log_chat_completion(seat, json.dumps(payload).encode())
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        box: dict[str, tuple[int, Any]] = {}
        # BL-2077: the worker thread that already runs complete() is where
        # a wait for the slot blocks too - this loop's own keepalive
        # comments cover both "waiting for the slot" and "waiting for
        # Ollama" identically, the same way they already cover a merely
        # slow upstream call (scenario 04).
        worker = threading.Thread(target=lambda: box.setdefault("r", guarded()), daemon=True)
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


def make_server(
    port: int,
    upstream: str,
    host: str = "127.0.0.1",
    idle_grace_s: float = DEFAULT_IDLE_GRACE_S,
    hold_quantum_s: float = DEFAULT_HOLD_QUANTUM_S,
    keepalive_s: float | None = None,
) -> ThreadingHTTPServer:
    handler = type("BoundShimHandler", (ShimHandler,), {
        "upstream": upstream, "output_caps": {}, "last_seat": "-",
        "slot": DecodeSlot(idle_grace_s, hold_quantum_s),
        **({"keepalive_s": keepalive_s} if keepalive_s is not None else {}),
    })
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
    parser.add_argument("--idle-grace-s", type=float, default=DEFAULT_IDLE_GRACE_S)
    parser.add_argument("--hold-quantum-s", type=float, default=DEFAULT_HOLD_QUANTUM_S)
    parser.add_argument("--keepalive-s", type=float, default=None)
    args = parser.parse_args(argv)
    if args.mode == "ensure":
        return ensure(args.port, args.upstream, args.log)
    server = make_server(
        args.port, args.upstream, idle_grace_s=args.idle_grace_s, hold_quantum_s=args.hold_quantum_s,
        keepalive_s=args.keepalive_s,
    )
    _log(f"{NAME}: serving 127.0.0.1:{args.port} -> {args.upstream}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

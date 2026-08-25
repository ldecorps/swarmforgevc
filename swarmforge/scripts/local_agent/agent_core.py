#!/usr/bin/env python3
"""Ollama tool-calling agent loop for the Local Agent Telegram topic."""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

from turn_gate import TurnAborted, TurnGate

DEFAULT_MODEL = os.environ.get("LOCAL_AGENT_MODEL", "qwen3:14b")
_raw_host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_HOST = _raw_host if "://" in _raw_host else f"http://{_raw_host}"
MAX_TOOL_ROUNDS = int(os.environ.get("LOCAL_AGENT_MAX_ROUNDS", "12"))
SHELL_TIMEOUT_S = int(os.environ.get("LOCAL_AGENT_SHELL_TIMEOUT", "60"))
# Bound per-/api/chat wait — a 600s hang parked Telegram mid-tool-round.
OLLAMA_TIMEOUT_S = int(os.environ.get("LOCAL_AGENT_OLLAMA_TIMEOUT", "90"))
# Wall clock for one Telegram turn (0 = disabled). Idle catches true hangs;
# this bound must allow multi-round CPU Qwen (was 120s and false-killed live turns).
TURN_DEADLINE_S = float(os.environ.get("LOCAL_AGENT_TURN_DEADLINE", "300") or 0)
# Ollama thinking dial for Qwen3: false | true | low | medium | high | max
_THINK_RAW = (os.environ.get("LOCAL_AGENT_THINK") or "false").strip().lower()
if _THINK_RAW in ("0", "false", "no", "off"):
    THINK: bool | str = False
elif _THINK_RAW in ("1", "true", "yes", "on"):
    THINK = True
else:
    THINK = _THINK_RAW  # low/medium/high/max
NUM_CTX = int(os.environ.get("LOCAL_AGENT_NUM_CTX", "2048"))
NUM_PREDICT = int(os.environ.get("LOCAL_AGENT_NUM_PREDICT", "256"))
KEEP_ALIVE = (os.environ.get("LOCAL_AGENT_KEEP_ALIVE") or "30m").strip() or "30m"
# No progress event for this long (outside fast-path) → abort. Covers wedged
# post-tool gaps; in-flight Ollama is bounded by OLLAMA_TIMEOUT_S separately.
TURN_IDLE_S = float(os.environ.get("LOCAL_AGENT_TURN_IDLE", "45") or 0)

ChatFn = Callable[..., dict[str, Any]]
NowFn = Callable[[], float]



class StreamBroken(Exception):
    """Telegram (or any) progress sink is gone — abort the turn, release the lock."""

_BLOCKED_SHELL = (
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    ":(){",
    "dd if=/dev/zero",
    "shutdown",
    "reboot",
    "poweroff",
)


def _resolve_root(root: str | Path | None = None) -> Path:
    raw = root or os.environ.get("LOCAL_AGENT_ROOT") or os.getcwd()
    return Path(raw).resolve()


def _safe_path(root: Path, rel: str) -> Path:
    candidate = (root / rel).resolve() if not os.path.isabs(rel) else Path(rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise PermissionError(f"path outside LOCAL_AGENT_ROOT: {rel}") from exc
    return candidate


def _blocked_shell_reason(command: str) -> str | None:
    lowered = command.strip().lower()
    for bad in _BLOCKED_SHELL:
        if bad in lowered:
            return f"refused: blocked shell pattern ({bad!r})"
    return None


def _clip_shell_out(text: str) -> str:
    if len(text) > 12_000:
        return text[:12_000] + "\n…(truncated)"
    return text


def run_shell(command: str, *, root: Path) -> str:
    """Run a bash command under LOCAL_AGENT_ROOT and return stdout+stderr."""
    blocked = _blocked_shell_reason(command)
    if blocked is not None:
        return blocked
    try:
        p = subprocess.run(
            ["bash", "-lc", command],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=SHELL_TIMEOUT_S,
        )
        out = (p.stdout or "") + (p.stderr or "")
        text = out.strip() or f"(exit {p.returncode}, empty output)"
        return _clip_shell_out(text)
    except Exception as e:  # noqa: BLE001 — surface to model
        return f"error: {e}"


def read_file(path: str, *, root: Path) -> str:
    """Read a UTF-8 text file under LOCAL_AGENT_ROOT."""
    try:
        p = _safe_path(root, path)
        data = p.read_text(encoding="utf-8", errors="replace")
        if len(data) > 12_000:
            data = data[:12_000] + "\n…(truncated)"
        return data
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def write_file(path: str, content: str, *, root: Path) -> str:
    """Write a UTF-8 text file under LOCAL_AGENT_ROOT (creates parents)."""
    try:
        p = _safe_path(root, path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return f"wrote {len(content)} bytes to {p}"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


def list_dir(path: str = ".", *, root: Path) -> str:
    """List a directory under LOCAL_AGENT_ROOT."""
    try:
        p = _safe_path(root, path)
        if not p.is_dir():
            return f"error: not a directory: {path}"
        names = sorted(os.listdir(p))
        return "\n".join(names) if names else "(empty)"
    except Exception as e:  # noqa: BLE001
        return f"error: {e}"


TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "run_shell",
            "description": "Run a bash command under the project root and return its output.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Bash command to execute"},
                },
                "required": ["command"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a text file relative to the project root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path under project root"},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write a text file relative to the project root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List directory entries relative to the project root.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative directory path"},
                },
            },
        },
    },
]

SYSTEM = (
    "/no_think\n"
    "You are Local Agent, a helpful coding assistant running on the user's WSL machine "
    "via Ollama. You can run shell commands and read/write files under the project root. "
    "Prefer tools over guessing. For counts (lines of code, file sizes, etc.) always use "
    "run_shell — never invent numbers and never reply with an empty message. "
    "Keep replies short for Telegram — answer first, no preamble. "
    "Do not refuse ordinary project work."
)

_EMPTY_NUDGE = (
    "Your last reply was empty. Use a tool (e.g. run_shell with find/wc) to answer, "
    "then give a short Telegram-ready result. Do not reply empty again."
)

# Cheap liveness / greeting replies — skip Ollama entirely.
_FAST_REPLIES: dict[str, str] = {
    "ping": "Pong",
    "pong": "Ping",
    "hi": "Hi — Local Agent here.",
    "hello": "Hello — Local Agent here.",
    "hey": "Hey — Local Agent here.",
    "status": "Local Agent online.",
    "health": "Local Agent online.",
    "are you there": "Yes — Local Agent online.",
    "are you working": "Yes — Local Agent online.",
    "are you working fine now": "Yes — Local Agent online.",
    "ok are you working fine now": "Yes — Local Agent online.",
    "you working": "Yes — Local Agent online.",
}


def _normalize_probe_key(user_text: str) -> str:
    key = "".join(ch for ch in user_text.strip().lower() if ch.isalnum() or ch.isspace())
    return " ".join(key.split())


def _soft_liveness_hit(key: str) -> bool:
    if key.startswith("ok ") and "working" in key:
        return True
    return "are you" in key and any(w in key for w in ("working", "there", "alive", "online", "up"))


def fast_path_reply(user_text: str) -> str | None:
    """Return an immediate reply for trivial probes, else None."""
    key = _normalize_probe_key(user_text)
    hit = _FAST_REPLIES.get(key)
    if hit is not None:
        return hit
    if _soft_liveness_hit(key):
        return "Yes — Local Agent online."
    return None


def _strip_think_artifacts(text: str) -> str:
    """Qwen3 sometimes leaves </think> markers even with think:false."""
    cleaned = text.replace("<think>", "").replace("</think>", "")
    return cleaned.strip()


def deadline_exceeded(now: float, *, start: float, limit_s: float | None) -> bool:
    """True when a positive wall-clock limit has elapsed since start."""
    if limit_s is None or limit_s <= 0:
        return False
    return (now - start) >= limit_s


def _is_stream_break(exc: BaseException) -> bool:
    if isinstance(exc, (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError)):
        return True
    # socket.timeout / blocking write deadline
    return isinstance(exc, OSError) and "timed out" in str(exc).lower()


def _note_if(gate: TurnGate | None) -> None:
    if gate is not None:
        gate.note_progress()


def _emit(
    on_event: Any,
    event_type: str,
    text: str,
    gate: TurnGate | None = None,
    **extra: Any,
) -> None:
    """Push a progress event. Stream breaks abort the turn; other sink errors are ignored.

    Progress is noted only *after* a successful sink write so a blocked TCP
    write cannot look like fresh progress and mask the idle watchdog.
    """
    if on_event is None:
        _note_if(gate)
        return
    try:
        on_event({"type": event_type, "text": text, **extra})
    except Exception as exc:  # noqa: BLE001
        if _is_stream_break(exc):
            raise StreamBroken(str(exc) or "client disconnected") from exc
        return
    _note_if(gate)


def _dispatch(name: str, args: dict[str, Any], root: Path) -> str:
    if name == "run_shell":
        return run_shell(str(args.get("command", "")), root=root)
    if name == "read_file":
        return read_file(str(args.get("path", "")), root=root)
    if name == "write_file":
        return write_file(str(args.get("path", "")), str(args.get("content", "")), root=root)
    if name == "list_dir":
        return list_dir(str(args.get("path", ".")), root=root)
    return f"error: unknown tool {name}"


def _ollama_chat(messages: list[dict[str, Any]], *, model: str, tools: bool) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": False,
        "think": THINK,
        "keep_alive": KEEP_ALIVE,
        "options": {
            "num_ctx": NUM_CTX,
            "num_predict": NUM_PREDICT,
            "temperature": 0.3,
        },
    }
    if tools:
        body["tools"] = TOOLS
    req = urllib.request.Request(
        f"{OLLAMA_HOST}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode())


def _clip(text: str, limit: int = 3500) -> str:
    text = text or ""
    return text if len(text) <= limit else text[:limit] + "\n…(truncated)"


def _deadline_message(limit_s: float) -> str:
    return f"Turn deadline exceeded ({limit_s:.0f}s). Try a shorter ask."


def _chat_with_gate(
    chat: ChatFn,
    gate: TurnGate,
    messages: list[dict[str, Any]],
    *,
    model: str,
    tools: bool,
) -> dict[str, Any]:
    """Run chat in a worker; poll gate so deadline/idle abort mid-/api/chat."""
    box: dict[str, Any] = {}
    done = threading.Event()

    def worker() -> None:
        try:
            box["r"] = chat(messages, model=model, tools=tools)
        except Exception as exc:  # noqa: BLE001 — re-raised on caller side
            box["e"] = exc
        finally:
            done.set()

    threading.Thread(target=worker, daemon=True).start()
    while not done.wait(0.05):
        gate.raise_if_aborted()
        # In-flight Ollama is real progress — idle is for stalls outside chat wait.
        gate.note_progress()
    if "e" in box:
        raise box["e"]
    gate.raise_if_aborted()
    gate.note_progress()
    return box["r"]


def _quick_turn(
    user_text: str,
    messages: list[dict[str, Any]],
    *,
    on_event: Any,
    gate: TurnGate,
) -> tuple[str, list[dict[str, Any]]] | None:
    quick = fast_path_reply(user_text)
    if quick is None:
        return None
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "assistant", "content": quick})
    _emit(on_event, "final", quick, gate=gate)
    return (quick, messages)


def _abort_turn_reply(
    exc: TurnAborted,
    messages: list[dict[str, Any]],
    *,
    on_event: Any,
    gate: TurnGate,
) -> tuple[str, list[dict[str, Any]]]:
    err = str(exc)
    try:
        _emit(on_event, "error", err, gate=gate)
    except StreamBroken:
        pass
    return (err, messages)


def _real_turn(
    messages: list[dict[str, Any]],
    *,
    user_text: str,
    model_name: str,
    project_root: Path,
    on_event: Any,
    chat: ChatFn,
    now: NowFn,
    started: float,
    limit: float | None,
    gate: TurnGate,
) -> tuple[str, list[dict[str, Any]]]:
    messages.append({"role": "user", "content": user_text})
    try:
        return _tool_loop(
            messages,
            model_name=model_name,
            project_root=project_root,
            on_event=on_event,
            chat=chat,
            now=now,
            started=started,
            limit=limit,
            gate=gate,
        )
    except StreamBroken as exc:
        return (f"stream broken: {exc}", messages)
    except TurnAborted as exc:
        return _abort_turn_reply(exc, messages, on_event=on_event, gate=gate)


def _ensure_system_messages(history: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = list(history or [])
    if not messages or messages[0].get("role") != "system":
        return [{"role": "system", "content": SYSTEM}, *messages]
    return messages


def _make_turn_gate(gate: TurnGate | None, now: NowFn) -> TurnGate:
    if gate is not None:
        return gate
    return TurnGate(now_fn=now, idle_s=TURN_IDLE_S)


def run_turn(
    user_text: str,
    *,
    history: list[dict[str, Any]] | None = None,
    model: str | None = None,
    root: str | Path | None = None,
    on_event: Any | None = None,
    chat_fn: ChatFn | None = None,
    now_fn: NowFn | None = None,
    deadline_s: float | None = None,
    gate: TurnGate | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Run one user turn (multi tool rounds). Returns (reply, updated_history).

    If on_event is set, it is called with dicts like:
      {"type":"status"|"assistant"|"tool_call"|"tool_result"|"final"|"error", "text": "..."}
      so Telegram (or any UI) can show temporary/intermediate output live.

    chat_fn / now_fn / deadline_s / gate are injectables for tests. Stream breaks
    on on_event abort the turn so the HTTP infer lock is released. ``gate.abort``
    from a deadline watchdog stops a wedged chat() that socket shutdown alone
    cannot interrupt.
    """
    chat = chat_fn or _ollama_chat
    now = now_fn or time.time
    limit = TURN_DEADLINE_S if deadline_s is None else deadline_s
    started = now()
    turn_gate = _make_turn_gate(gate, now)
    messages = _ensure_system_messages(history)

    quick = _quick_turn(user_text, messages, on_event=on_event, gate=turn_gate)
    if quick is not None:
        return quick

    return _real_turn(
        messages,
        user_text=user_text,
        model_name=model or DEFAULT_MODEL,
        project_root=_resolve_root(root),
        on_event=on_event,
        chat=chat,
        now=now,
        started=started,
        limit=limit,
        gate=turn_gate,
    )


def _emit_deadline(
    on_event: Any,
    gate: TurnGate,
    messages: list[dict[str, Any]],
    limit: float | None,
) -> tuple[str, list[dict[str, Any]]]:
    err = _deadline_message(float(limit or 0))
    _emit(on_event, "error", err, gate=gate)
    return (err, messages)


def _deadline_hit(
    now: NowFn,
    started: float,
    limit: float | None,
    gate: TurnGate,
) -> bool:
    gate.raise_if_stale()
    return deadline_exceeded(now(), start=started, limit_s=limit)


def _continue_after_tools(
    messages: list[dict[str, Any]],
    *,
    on_event: Any,
    gate: TurnGate,
    round_i: int,
) -> None:
    if messages and messages[-1].get("role") == "tool":
        _emit(
            on_event,
            "status",
            f"continuing after tools (round {round_i + 1})…",
            gate=gate,
        )


def _tool_loop(
    messages: list[dict[str, Any]],
    *,
    model_name: str,
    project_root: Path,
    on_event: Any,
    chat: ChatFn,
    now: NowFn,
    started: float,
    limit: float | None,
    gate: TurnGate,
) -> tuple[str, list[dict[str, Any]]]:
    _emit(on_event, "status", f"thinking… ({model_name})", gate=gate)
    tool_notes: list[str] = []
    empty_nudges = 0
    for round_i in range(MAX_TOOL_ROUNDS):
        if _deadline_hit(now, started, limit, gate):
            return _emit_deadline(on_event, gate, messages, limit)
        reply_or_none, empty_nudges = _one_model_round(
            messages,
            model_name=model_name,
            project_root=project_root,
            on_event=on_event,
            chat=chat,
            round_i=round_i,
            tool_notes=tool_notes,
            gate=gate,
            empty_nudges=empty_nudges,
        )
        if reply_or_none is not None:
            return (reply_or_none, messages)
        if _deadline_hit(now, started, limit, gate):
            return _emit_deadline(on_event, gate, messages, limit)
        _continue_after_tools(messages, on_event=on_event, gate=gate, round_i=round_i)

    final = "Stopped: tool-round limit reached. Try a narrower request."
    _emit(on_event, "final", final, gate=gate)
    return (final, messages)


def _recover_empty_reply(
    messages: list[dict[str, Any]],
    *,
    on_event: Any,
    gate: TurnGate,
    empty_nudges: int,
) -> tuple[str | None, int]:
    """Empty content with no tools: nudge once, else fail closed for Telegram."""
    if empty_nudges < 1:
        _emit(on_event, "status", "empty reply — nudging model to use tools…", gate=gate)
        messages.append({"role": "user", "content": _EMPTY_NUDGE})
        return (None, empty_nudges + 1)
    err = (
        "Model returned an empty reply twice (no tools, no text). "
        "Please retry — for counts, ask it to run a shell wc/find."
    )
    _emit(on_event, "error", err, gate=gate)
    return (err, empty_nudges)


def _ollama_fail(
    on_event: Any,
    gate: TurnGate,
    empty_nudges: int,
    err: str,
) -> tuple[str | None, int]:
    _emit(on_event, "error", err, gate=gate)
    return (err, empty_nudges)


def _chat_round_or_error(
    chat: ChatFn,
    gate: TurnGate,
    messages: list[dict[str, Any]],
    *,
    model_name: str,
    on_event: Any,
    empty_nudges: int,
) -> tuple[dict[str, Any] | None, tuple[str | None, int] | None]:
    """Returns (resp, None) on success or (None, error_tuple) on soft failure."""
    gate.raise_if_aborted()
    try:
        return (
            _chat_with_gate(chat, gate, messages, model=model_name, tools=True),
            None,
        )
    except TurnAborted:
        raise
    except urllib.error.URLError as e:
        return (None, _ollama_fail(on_event, gate, empty_nudges, f"Ollama unreachable at {OLLAMA_HOST}: {e}"))
    except TimeoutError as e:
        return (None, _ollama_fail(on_event, gate, empty_nudges, f"Ollama timeout after {OLLAMA_TIMEOUT_S}s: {e}"))
    except Exception as e:  # noqa: BLE001
        return (None, _ollama_fail(on_event, gate, empty_nudges, f"Ollama error: {e}"))


def _normalize_assistant_msg(msg: dict[str, Any]) -> tuple[list[Any], str]:
    if isinstance(msg.get("content"), str):
        msg["content"] = _strip_think_artifacts(msg["content"])
    tool_calls = msg.get("tool_calls") or []
    interim = (msg.get("content") or "").strip()
    return tool_calls, interim


def _finalize_text_reply(
    messages: list[dict[str, Any]],
    *,
    interim: str,
    tool_notes: list[str],
    on_event: Any,
    gate: TurnGate,
    empty_nudges: int,
) -> tuple[str | None, int]:
    if not interim:
        return _recover_empty_reply(
            messages, on_event=on_event, gate=gate, empty_nudges=empty_nudges
        )
    _emit(on_event, "final", _clip(interim), gate=gate)
    if not tool_notes:
        return (interim, empty_nudges)
    preface = "\n".join(tool_notes[:6])
    return (f"{preface}\n\n{interim}" if preface else interim, empty_nudges)


def _run_tool_calls(
    tool_calls: list[Any],
    *,
    messages: list[dict[str, Any]],
    project_root: Path,
    on_event: Any,
    gate: TurnGate,
    tool_notes: list[str],
    round_i: int,
) -> None:
    for tc in tool_calls:
        gate.raise_if_aborted()
        name, args, short_args = _tool_call_bits(tc)
        _emit(on_event, "tool_call", f"{name}({short_args})", gate=gate, round=round_i + 1)
        result = _dispatch(name, args, project_root)
        _emit(on_event, "tool_result", _clip(result), gate=gate, tool=name, round=round_i + 1)
        tool_notes.append(f"• {name}({short_args})")
        messages.append({"role": "tool", "tool_name": name, "content": result})


def _emit_round_progress(
    on_event: Any,
    gate: TurnGate,
    *,
    round_i: int,
    thinking: str,
    interim: str,
    tool_calls: list[Any],
) -> None:
    if thinking:
        _emit(on_event, "status", f"reasoned {len(thinking)} chars…", gate=gate, round=round_i + 1)
    if interim and tool_calls:
        _emit(on_event, "assistant", _clip(interim), gate=gate, round=round_i + 1)


def _one_model_round(
    messages: list[dict[str, Any]],
    *,
    model_name: str,
    project_root: Path,
    on_event: Any,
    chat: ChatFn,
    round_i: int,
    tool_notes: list[str],
    gate: TurnGate,
    empty_nudges: int,
) -> tuple[str | None, int]:
    """One Ollama call + optional tools. Returns (final reply or None to continue, empty_nudges)."""
    resp, err_tuple = _chat_round_or_error(
        chat,
        gate,
        messages,
        model_name=model_name,
        on_event=on_event,
        empty_nudges=empty_nudges,
    )
    if err_tuple is not None:
        return err_tuple

    gate.raise_if_aborted()
    msg = (resp or {}).get("message") or {}
    tool_calls, interim = _normalize_assistant_msg(msg)
    _emit_round_progress(
        on_event,
        gate,
        round_i=round_i,
        thinking=(msg.get("thinking") or "").strip(),
        interim=interim,
        tool_calls=tool_calls,
    )
    messages.append(msg)
    if not tool_calls:
        return _finalize_text_reply(
            messages,
            interim=interim,
            tool_notes=tool_notes,
            on_event=on_event,
            gate=gate,
            empty_nudges=empty_nudges,
        )

    _run_tool_calls(
        tool_calls,
        messages=messages,
        project_root=project_root,
        on_event=on_event,
        gate=gate,
        tool_notes=tool_notes,
        round_i=round_i,
    )
    return (None, empty_nudges)


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return raw if isinstance(raw, dict) else {}


def _tool_call_bits(tc: dict[str, Any]) -> tuple[str, dict[str, Any], str]:
    fn = tc.get("function") or {}
    name = fn.get("name") or ""
    args = _parse_tool_args(fn.get("arguments") or {})
    short_args = json.dumps(args, ensure_ascii=False)
    if len(short_args) > 120:
        short_args = short_args[:120] + "…"
    return name, args, short_args

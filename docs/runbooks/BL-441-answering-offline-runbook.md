# Answering the Swarm Offline

**A short runbook for a human away from Telegram who needs to read a pending
question and answer it, using nothing but a plain git checkout.**

## 1. Reading pending questions offline

The swarm's asks are already durable outside Telegram — you don't need the
bot running to see what's waiting:

- **Git-committed BL topics** (`backlog/topics/*.json`, BL-329) — every
  ticket's own conversation record, one JSON file per `BL-###`, committed and
  pushed like any other file. `git pull` and read the file for the ticket
  you care about; the swarm's own outbound question is the latest message in
  it.
- **The PWA dashboard** (`pwa/index.html` → `pwa/app.js`) — a static,
  git-SHA-reproducible projection of the same backlog state, viewable from a
  phone or any browser without a live bridge connection. It surfaces which
  tickets are waiting on a human at a glance.

## 2. Composing an answer

Write your reply as a plain text/Markdown file named `ANSWER-<anything>.md`,
committed at the **backlog root** (`backlog/ANSWER-*.md` — the top level, not
`backlog/active/` or any subfolder), and push it. Symmetric with the
existing `INTAKE-*.md` convention for raw human requests.

The schema is deliberately forgiving — this is meant to be written on a
plane, not filled out like a form:

- Mention the ticket you're answering somewhere in the file — a bare
  `BL-###` anywhere in the text is enough to resolve it.
- The rest of the file is just your own words. There is no required header
  syntax; the whole trimmed file content is carried through as your answer.

Example:

```markdown
ANSWER-standup-question.md
---
BL-512: yes, go with the shorter retention window. No need to keep 90 days.
```

Commit and push it like any other change:

```sh
git add backlog/ANSWER-standup-question.md
git commit -m "Answer BL-512: shorter retention window"
git push
```

The swarm's own daemon drains `ANSWER-*.md` files automatically on its
regular sweep cycle — no CLI to run by hand. A successfully-drained file is
archived to `backlog/answers-archive/`, not deleted, so your answer stays in
history.

## 3. The stale-premise caveat

An answer is only acted on if the question it answers is still live: the
ticket must still be open (not shipped to `backlog/done/`, not itself marked
`status: done`), and the *specific* pending question it references must not
have since been retracted or superseded by the swarm asking something else.

If the premise has moved on by the time your answer arrives, it is **never**
blind-executed against a stale question. Instead it is recorded as "arrived
late, not executed" in the ticket's own BL-topic record, so you can see what
happened and re-ask if it's still relevant.

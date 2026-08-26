# Using the Operator Telegram Console

The operator Telegram console is a separate, allowlisted bot for checking the
swarm from a phone and running a guarded `./swarm ensure`. It is not the
front-desk/support bot. The operator runtime supervises it on each tick, the
same way it supervises the tunnel helper.

## Configure the Bot

Provide these environment variables to the operator runtime:

- `OPERATOR_TELEGRAM_BOT_TOKEN`: the token for the dedicated operator bot;
- `OPERATOR_TELEGRAM_ALLOWED_USER_ID`: the single Telegram user id allowed to
  receive swarm data and run `/ensure`.

Do not commit either value. If either variable is missing, the console disables
cleanly and the operator daemon keeps running. To disable the console
intentionally, set `SWARMFORGE_SKIP_TELEGRAM=1`.

Runtime state is written under `.swarmforge/operator/`, including
`telegram-console.status.json`, `telegram-console.pid`, and
`telegram-console.log`.

## Commands

Send commands from the allowlisted Telegram account:

- `/status` returns overall health, active roles, tunnel URL, and status
  freshness.
- `/tunnel` returns only the tunnel URL and tunnel state.
- `/help` lists the supported commands.
- `/ensure` asks for confirmation before running `./swarm ensure`.

The `/ensure` path is deliberately two-step. The first `/ensure` message only
sets a pending confirmation and replies with instructions. Reply `confirm` to
run `./swarm ensure` once and receive its exit code plus a short output tail.
If an ensure is already running, a second `/ensure` is rejected as busy.

Messages from non-allowlisted Telegram users receive no swarm data. They are
logged as ignored.

## Supervision and Recovery

The operator daemon calls `ensure-telegram!` during its normal tick. That check:

- starts the poller when the token and allowlisted user id are configured;
- leaves the console disabled when `SWARMFORGE_SKIP_TELEGRAM=1` or credentials
  are absent;
- relaunches a dead poller on the next tick;
- records `telegram_console.state` in operator `status.json`.

If Telegram rejects the token with a 401, the console records
`telegram_console.state: auth_lost` and backs off instead of crash-looping.
Fix the bot token configuration, then let the operator tick restart the poller
or stop it explicitly:

```sh
swarmforge/scripts/operator_telegram.bb stop <project-root>
```

The next healthy tick starts it again when credentials are present and the kill
switch is unset.

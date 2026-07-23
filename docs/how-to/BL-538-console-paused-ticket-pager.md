# Reviewing Paused Tickets in the Mini App Console

Use the paused-ticket pager when you need to triage `backlog/paused/` from a
phone without opening the repository. It is part of the Telegram Mini App
console and runs on the existing bridge host.

## Open the Pager

Open the allowlisted SwarmForge console Mini App and choose **Paused tickets**.
The console links to `/paused-pager` on the bridge server. The HTML shell is
publicly reachable like the other Mini App shells, but the JSON feed and
control route require the console token.

The pager shows one paused ticket at a time:

- the ticket id and title at the top;
- the ticket YAML in the middle;
- a **Set highest priority, expedite** control at the bottom.

When `backlog/paused/` is empty, the pager shows an empty state and no
expedite control.

## Move Between Tickets

Use the previous and next controls, or swipe on a phone, to move through the
paused queue. Tickets are ordered by numeric priority ascending, then ticket id
ascending. Navigation stops at the first and last ticket; it does not wrap.

## Expedite a Ticket

Use **Set highest priority, expedite** only for work that should jump to the
front of the swarm queue. The control uses the same two-tap discipline as the
operator console's destructive actions: the first tap asks for confirmation and
does not change the ticket.

After confirmation, the bridge reuses the existing promote path:

- sets the ticket priority to `0`;
- moves the ticket from `backlog/paused/` to `backlog/active/`;
- leaves the pager on the next remaining paused ticket, or the empty state.

The pager is not a general YAML editor. It only supports reviewing paused
tickets and expediting one ticket at a time.

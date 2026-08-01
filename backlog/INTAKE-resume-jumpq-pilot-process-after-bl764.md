# Raw intake — Resume JumpQ pilot-process after BL-764

Human via Let's Talk 2026-08-01 morning.

When the current active ticket (BL-764 front-desk/Host bridge adopt) leaves
`active/`, promote the JumpQ **pilot-process** slice next — the priority-0
evidence-gate tickets from the BL-723 review batch, then BL-758 (real role
prompt at each hat change).

Do not keep pulling Bubble/adopt or ordinary paused work ahead of that
hardening. Goal: restore a safe `/pilot` / `/pilot safe` resume path sooner.

This is promotion steering for the coordinator, not a new feature to spec.

---

## specifier_disposition

**2026-08-01 — DRAINED into `backlog/STEERING.md`, not minted as a ticket.**

The intake says so itself: "This is promotion steering for the coordinator, not
a new feature to spec." There is no behavior to specify, so no ticket is
written and no Gherkin exists to write.

The gate it names has opened — BL-764 closed to `backlog/done/M8/` earlier
today. But the batch is not merely un-promoted by oversight: it is starved by
construction. The pilot-process tickets are `severity: low`/`medium`, fifteen
approved `severity: high` defects sit ahead of them in `paused/` by Article
3.2.4, and the pack runs one ticket at a time. Since this is the human's SECOND
ask for the same batch, STEERING.md's own rule makes it a steering review
rather than a promotion nudge.

Recorded in full in `backlog/STEERING.md`: the 2026-08-01 review row, the
now-defined `queue-jump` class, the explicit Full rank order the coordinator
applies, and the four options only the human can choose between. Queued as the
specifier's next `role_ask` when the question slot frees.

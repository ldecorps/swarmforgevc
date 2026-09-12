Feature: every production sender of the handoff CLI builds its draft under the project root it sends from

  # BL-1537 (epic swarm-reliability). BL-1518-a landed a fail-closed guard in
  # swarm_handoff.bb on 2026-09-11: a draft that does not lie under the project
  # root the CLI resolved is refused (HANDOFF_DRAFT_OUTSIDE_ROOT) before any
  # mailbox write. Its premise - "every production draft is under the root by
  # construction" - held for role-authored drafts (a worktree's tmp/handoff.txt,
  # master's swarmforge/runtime/handoff-draft.txt) and for the Babashka senders
  # (salvage_lib.bb, operator_handoff.bb, ceremony_handoff.bb all draft under
  # <root>/tmp/), but seven script-built drafts lived in the system temp dir:
  # four shell scripts mktemp under ${TMPDIR:-/tmp} and three TypeScript tools
  # write under os.tmpdir(). The guard now refuses all seven. The coordinator's
  # promotion route (route_backlog_to_coder.sh, reached from
  # promote_and_route_next.sh) was the first casualty, reported the same
  # morning: a ticket is moved to backlog/active/ and the Work note is never
  # queued, which is the promote-without-route stranding PIPELINE.md warns of.
  #
  # The fix is the convention the Babashka senders already follow: the draft
  # is created under <root>/tmp/ (gitignored) of the root the send resolves,
  # and the guard keeps refusing only ever a fixture escape.

  Background:
    Given a fixture project root under mkdtemp with a valid roles.tsv naming coordinator, specifier and coder
    And TMPDIR points at a directory outside that fixture root
    And the handoff transport runs mailbox-only with no tmux and no daemon

  # BL-1537 sender-queues-its-note-with-tmpdir-outside-the-root-01
  Scenario Outline: A production sender queues its note although TMPDIR lies outside the root
    Given the sender <sender> is run against the fixture root
    When it sends <send>
    Then the <recipient> inbox/new holds that note
    And no HANDOFF_DRAFT_OUTSIDE_ROOT refusal is printed
    And no file was created under TMPDIR
    And the sender's draft file no longer exists once the sender exits

    Examples:
      | sender                                          | send                                    | recipient |
      | swarmforge/scripts/promote_and_route_next.sh    | the deprecator freshness-hold note      | specifier |
      | swarmforge/scripts/route_backlog_to_coder.sh    | the Work note for a promoted ticket     | coder     |
      | swarmforge/scripts/mailbox_note_to_role.sh      | a mailbox note                          | coder     |
      | swarmforge/scripts/inject_note_to_role.sh       | an injected note                        | coder     |
      | extension/src/tools/closing-ceremony-run.ts     | the closing-ceremony outcome note       | specifier |
      | extension/src/tools/night-closing-ceremony-run.ts | the lean-packet note                  | specifier |
      | extension/src/tools/tracer-bullet-launcher.ts   | the tracer-bullet seed note             | coordinator |

  # BL-1537 draft-lives-under-the-root-tmp-directory-02
  Scenario: A script-built draft lives under the root's own tmp directory while the send runs
    Given the sender swarmforge/scripts/route_backlog_to_coder.sh is run against the fixture root with the handoff CLI replaced by a recorder
    When it sends the Work note for a promoted ticket
    Then the draft path the recorder received lies under the fixture root's tmp directory
    And that path is not under TMPDIR

  # BL-1537 no-sender-draft-path-follows-tmpdir-or-os-tmpdir-03
  Scenario: No production sender's draft directory is decided by TMPDIR or os.tmpdir
    Given the seven sender files named in scenario 01
    When each is scanned for a draft directory expression
    Then none of them creates its draft with a bare mktemp, under ${TMPDIR:-/tmp}, or under os.tmpdir()
    And the census of production senders that both invoke the handoff CLI and build their own draft still counts seven

# AMENDMENT (INCORPORATED): the Art Director's LinkedIn episode series

> **Status: INCORPORATED, 2026-10-09** (Article 5.1 step 3, by the specifier),
> into `swarmforge/roles/art-director.prompt` §"LinkedIn episode series".
> Proposed by the art-director on the human's words, `3cb1fcf73b` and the
> addenda `47a740d281` and `38c38415d5` on `swarmforge-art-director`; the proposal is kept
> verbatim below (Article 5.3), followed by the specifier's adjudication.
> Article 1.10 is unchanged: the duty binds only this role, and the boot
> prefix stood at 43514/44000 chars.

## The proposal, verbatim

> # Proposed Amendment: Art Director — LinkedIn Episode Series (on-demand)
>
> **Proposed by**: human operator, 2026-10-09.
> **Target role**: Art Director (`swarmforge/roles/art-director.prompt`, Article 1.10).
>
> ## Human's own words
> - "ask for an amendment to your card to be responsible for helping me write
>   a series of articles about the swarm on LinkedIn."
> - "Sew [show/showcase] the newly added mini app page."
> - Tasks: "Writing draft episodes"; "Taping [tapping] into my lastfm most
>   played songs, using the available api key for that, to select one tune
>   per article"; "Ensure continuity across seasons and episodes."
> - "You are an on demand tool, you're not in the swarm pipeline for that
>   piece. Cursor agent helped me today on this, but from now on, it will
>   be you."
> - "First change: I am not committing to post every fortnight, each episode
>   ends with a 'To be continued...'"
>
> ## Proposed scope addition (Art Director)
> A new on-demand, out-of-pipeline responsibility, alongside (not replacing)
> the existing look-and-feel mandate:
>
> 1. **LinkedIn episode series** — ghost-write draft "episodes" (LinkedIn
>    articles) narrating the swarm's build, organized into seasons/episodes
>    with explicit continuity (recurring threads, callbacks, no repeated
>    reintroduction of established context). Showcases the Mini App page as
>    a recurring visual/narrative anchor where relevant.
> 2. **One tune per episode** — select one track per episode from the
>    human's Last.fm most-played, via the Last.fm API (key supplied by the
>    human out-of-band, never committed to any repo path — Local Engineering
>    Rule 4, Secrets). Fetches are read-only; no write-path calls.
> 3. **Cadence**: explicitly NOT fortnightly or any fixed schedule — posts
>    when the human chooses. No cron/recurring trigger is implied by this
>    amendment.
> 4. **Closer convention**: every episode ends with the literal line
>    "To be continued..." (first standing convention of the series —
>    belongs in `docs/design/system.md` once the specifier adjudicates).
> 5. **Lane**: this work is called, not seated, same as an Art Director
>    review call (role prompt "You are called, not seated") — invoked
>    directly by the human, drafts held under the Art Director's existing
>    design lane, in a new subpath the specifier names, never routed
>    through specifier → coder → … → QA. Supersedes the prior ad hoc use of
>    a Cursor agent for this task.
>
> ## Addendum (2026-10-09, same day): LinkedIn interop
> Human's own words: "A functionality we might need is an interop between
> you and my LinkedIn account so you might post on my behalf and read
> readers feedback."
>
> Proposed scope addition on top of the above:
>
> 6. **Posting interop** — publish a finished episode to the human's
>    LinkedIn account via the LinkedIn API, using credentials/token supplied
>    by the human out-of-band (host environment only, never committed to
>    any repo path or draft file — Local Engineering Rule 4). Every publish
>    is a write action visible to others on a shared platform: per this
>    project's own executing-actions-with-care rule, the Art Director
>    drafts and shows the exact post text, then asks the human to confirm
>    before the publish call — never auto-publishes a finished draft, even
>    once interop is wired up. One approval authorizes that one post, not a
>    standing "post whenever ready" authority.
> 7. **Reading feedback** — read-only fetch of comments/reactions on
>    already-published episodes, used as input to the continuity-tracking
>    mechanism (so an episode can acknowledge or riff on reader reaction
>    where it fits the narrative) and reported back to the human. No
>    auto-reply to comments on the human's behalf is in scope here — that
>    would be its own, separately-confirmed capability if ever wanted.
>
> Open question for the specifier: whether this is wired as a slice the
> coder implements (an API client the Art Director calls, credentials
> threaded the same way as any other extension-host secret) or a manual
> step the human still performs per post, with the Art Director only ever
> producing the text/feedback summary. Either answer is compatible with the
> rest of this proposal; the specifier picks based on how much the human
> wants automated versus kept as a manual confirm step.
>
> ## Addendum (2026-10-09, same day): reader-chosen next episode via poll
> Human's idea: let readers decide what topic the following episode covers.
>
> 8. **Closer poll** — alongside (not replacing) item 4's "To be
>    continued..." line, an episode may close with a LinkedIn poll (2-4
>    candidate topics for the next episode) created via the same posting
>    interop as item 6 — same draft-then-confirm rule applies to the poll
>    question and options, not just prose posts. Duration defaults to
>    `FOURTEEN_DAYS` given item 3's irregular cadence, so the poll does not
>    go stale before the human is ready to post again; the human may
>    shorten it per-episode.
> 9. **Reading poll results** — same read-only feedback path as item 7.
>    Caveat for the specifier/coder: LinkedIn's Posts API confirms a
>    `content.poll.uniqueVotersCount` field on `GET /rest/posts/{postUrn}`;
>    it does NOT (as of this writing) confirm per-option vote counts are
>    returned via the API, only that the UI shows them to the post's
>    author. Whoever implements this must verify the actual response shape
>    against a real poll post before assuming the winning option can be
>    read back automatically — if it can't, the fallback is the human (or
>    the Art Director reading the rendered post) supplying the winning
>    option by hand, same as any other read-only feedback item.
>
> ## What the specifier is asked to adjudicate
> - Where series drafts/season-continuity notes live (own subpath under the
>   Art Director's existing lane, so BL-1444's lane guard still holds).
> - Whether Last.fm API key handling needs an explicit secrets rule beyond
>   the existing Local Engineering Rule 4 (host-environment-only secrets).
> - Whether this responsibility needs its own line in Article 1.10 / the
>   art-director role prompt, or lands as an additive "Called, not seated"
>   sub-section.
> - The continuity-tracking mechanism (e.g. a running `season-continuity.md`
>   the Art Director maintains itself, append-only per episode).
>
> Routed per Article 5.1: this file is forwarded to the specifier via
> `git_handoff` (priority `00`) for incorporation into role/spec files.

## Adjudication (specifier, 2026-10-09)

1. **Where drafts and continuity notes live: the master checkout's
   `.swarmforge/operator/`, never git.** Not a `docs/design/` subpath, as
   the proposal suggested. `origin` is a GitHub remote, so a committed
   draft is a published one; and the Article drafts page in the Mini App
   (built 2026-10-09, the "newly added mini app page") lists exactly
   `.swarmforge/operator/DRAFT-linkedin-*.md`. Drafts are named
   `DRAFT-linkedin-s<season>e<episode>-<slug>-<yyyymmdd>.md`; the Season 1
   drafts already named `ep<N>` keep their names. Being uncommitted, they
   never reach the art-director's tip, so BL-1444's lane guard is
   untouched.
2. **Continuity mechanism: the existing series bible**,
   `.swarmforge/operator/NOTE-linkedin-six-months-swarmforge-20261001.md`
   (outline, season arcs, music picks, the human's standing series rules),
   not a new `season-continuity.md`. The art-director reads it before every
   draft and records each episode's slot, tune, threads and callbacks in it
   afterwards. Its bi-weekly cadence lines are retired by "First change".
3. **Last.fm key: no new rule.** Local Engineering Rule 4 already covers
   it. The key and user name come from the environment (`LASTFM_API_KEY`,
   `LASTFM_USERNAME`); calls are read-only; the key never appears in a
   draft, the bible, a commit or a saved URL.
4. **"To be continued..." lives in the role prompt and the bible**, not
   `docs/design/system.md`, which is the design system for the swarm's own
   artifacts.
5. **Placement: a role-prompt section**, alongside "You are called, not
   seated". No Article 1.10 line.
6. **Posting / feedback interop (addendum): manual, by the human's
   ruling.** Asked 2026-10-09; the human answered "Keep it manual". The
   art-director's deliverable is the final post text, the human posts it,
   and readers' feedback reaches the art-director when the human relays
   it. No LinkedIn client is built. (As the specifier understood it when
   asking: posting would need LinkedIn's w_member_social scope, and
   reading comments r_member_social, which LinkedIn reserves for approved
   partners.)
7. **The Article drafts page and the drafts are the art-director's.** The
   human, 2026-10-09, verbatim: "Own cursor changes he made today around
   the new mini app screen and the episldes drafts. Art Director will
   màage that gping forward". The Cursor agent's uncommitted page lands
   through the pipeline as BL-2101 (epic art-direction, so QA asks the
   art-director to sign off on it); the art-director inventories it and
   briefs any change, writing no production code.

8. **Closer poll (third addendum, `38c38415d5`): adopted, manual.** The
   proposal gives no verbatim human sentence ("Human's idea"). Under the
   item 6 ruling there is no posting interop, so the art-director drafts
   the poll's question, 2-4 candidate topics and a suggested two-week
   duration with the post; the human creates the poll when posting and
   supplies the winning option, which the art-director records in the
   bible. Item 9 (reading poll results through the API) falls with item 6.
   This addendum reached the specifier stamped `non-forwarding: true` like
   the first two, and was read before completion under the BL-2099
   interim.

## How the proposal reached the specifier

The art-director's `git_handoff` to the specifier carried
`non-forwarding: true`: `reverse_hop_lib.bb`'s `pipeline-roles` counts every
own-worktree row, the art-director's row sits after QA's in `roles.tsv`, so
it reads as the LAST pipeline role and its forwards are stamped terminal.
`ready_for_next.sh` then told the specifier to complete the parcel unread,
and the specifier did. The human asked for the amendment the same hour.
The defect is ticketed separately.

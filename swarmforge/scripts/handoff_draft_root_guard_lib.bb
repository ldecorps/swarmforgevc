;; handoff_draft_root_guard_lib.bb — BL-1518: refuses a swarm_handoff.bb
;; invocation whose draft file lies outside the project root the CLI
;; resolved, BEFORE any mailbox write - the fail-closed fix for a mutation
;; run that emptied (or dropped `cwd` from) the options object one BL-607
;; unit test passes to `execFileAsync('bb', [cli, draftPath], {...})`.
;;
;; Under that mutant the child process inherits the TEST PROCESS's real
;; cwd and environment (a coder-pane mutation run's own worktree and
;; `SWARMFORGE_ROLE=coder`), so `swarm_handoff.bb`'s own `project-root`
;; resolves to a REAL, valid SwarmForge project - the coder worktree - and
;; happily delivered a live handoff whose draft actually lived under an
;; unrelated mkdtemp fixture. Four such notes reached the live specifier
;; inbox on 2026-09-10 before this was traced (backlog/active/BL-1518-a...
;; has the full incident).
;;
;; The check asked here is deliberately NOT "is `cwd` correct" (unfixable
;; from inside the CLI - the CLI never learns what its caller meant to
;; pass) but "does the draft this invocation was actually given live under
;; the root this invocation actually resolved" - a question answerable
;; from data the CLI already has in hand, regardless of how it got there.
;; Every production draft (a worktree role's own `tmp/handoff.txt`,
;; master's `swarmforge/runtime/handoff-draft.txt`, and the Babashka
;; senders' own `<root>/tmp/` drafts) is under its role's resolved root by
;; construction, so this refuses only ever a fixture escape, never a live
;; send (BL-1518-a's own "What is wanted" #1). Seven script-built senders
;; (four shell, three TypeScript) drafted under `${TMPDIR:-/tmp}` /
;; `os.tmpdir()` instead and were refused after this guard landed; BL-1537
;; moved all seven under `<root>/tmp/` to match.
;;
;; PURE: both functions below take already-resolved, already-canonical
;; absolute path strings - the impure caller (swarm_handoff.bb) does the
;; one `fs/canonicalize` each side needs (resolving `..`/symlinks so a
;; relative draft arg or a symlinked worktree can't slip past a naive
;; string compare) and this lib never touches the filesystem itself,
;; keeping the decision testable with plain strings and no fixture tree.

(ns handoff-draft-root-guard-lib
  (:require [clojure.string :as str]))

(defn outside-root?
  "True when `draft-real` does not lie AT or UNDER `root-real` - both
   already absolute and symlink-resolved. Exact equality counts as inside
   (a root's own draft file, once canonicalized, is never outside itself).
   Containment is checked at a path-separator boundary so a sibling whose
   name merely shares `root-real` as a text prefix (root `/a/b` vs draft
   `/a/bc/x`) is never mistaken for containment."
  [draft-real root-real]
  (not (or (= draft-real root-real)
           (str/starts-with? draft-real (str root-real "/")))))

(defn refusal-message
  "Names both paths (invariant 1's own wording), so the reader can tell at
   a glance whether the DRAFT or the RESOLVED ROOT is the surprising one -
   a fixture escape almost always shows an unrelated mkdtemp path on one
   side and a real worktree on the other."
  [draft-real root-real]
  (str "HANDOFF_DRAFT_OUTSIDE_ROOT\n"
       "draft: " draft-real "\n"
       "root:  " root-real "\n"
       "Refusing: the draft file does not lie under the project root this "
       "invocation resolved. Run swarm_handoff.sh with a draft that lives "
       "under your own worktree (or master's swarmforge/runtime/), or from "
       "the correct project directory."))

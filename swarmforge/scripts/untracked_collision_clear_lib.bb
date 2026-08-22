;; BL-924: pure decision logic for "given the untracked paths a worktree
;; merge would collide with, which are safe to clear before the merge
;; runs". Loaded via load-file, not required on a classpath:
;;   (load-file (str (fs/path (fs/parent *file*) "untracked_collision_clear_lib.bb")))
;; and referred to as untracked-collision-clear-lib/foo.
;;
;; THE INVARIANT (BL-924, ticket's own wording). A merge is refused only
;; when completing it would lose content that exists nowhere else. An
;; untracked copy byte-identical to the tracked version being merged in
;; can lose nothing, and never blocks. No file whose content exists on no
;; branch is ever removed to clear a collision - proving identity per file
;; is the whole safety argument, never widened to "looks like a synced
;; script".
;;
;; ALL-OR-NOTHING BY DESIGN. If even one candidate differs, nothing is
;; cleared and the merge is refused - a genuinely stale/differing untracked
;; copy might be the ONLY reason it exists at all, so a partial clear that
;; silently drops some collisions while blocking on others would still be
;; guessing which untracked bytes matter. The caller (a thin CLI script)
;; is what actually reads the untracked file's own bytes and the incoming
;; ref's tracked content and decides :identical? per candidate - this
;; namespace never touches a filesystem or git itself.

(ns untracked-collision-clear-lib)

(defn plan-untracked-collision-clear
  "collisions: a seq of {:path str :identical? bool} - the FULL set of
   untracked paths the merge would overwrite, each already compared
   against the incoming ref's tracked content by the caller. Returns
   {:ok? true :clear-paths [...]} when every candidate is byte-identical
   (safe to remove, then let the merge proceed), or {:ok? false
   :blocking-paths [...]} naming EVERY differing path at once when any
   is not - never a partial clear, never an elided report."
  [collisions]
  (let [differing (remove :identical? collisions)]
    (if (seq differing)
      {:ok? false :blocking-paths (mapv :path differing)}
      {:ok? true :clear-paths (mapv :path collisions)})))

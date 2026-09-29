#!/usr/bin/env bb
;; BL-1795 coder pass (BL-654 Invariants): PROPERTY tests over
;; land_step_lib.bb's new ancestor-of-owner-abandoned? ground, encoding the
;; ticket's two declared invariants against the REAL functions
;; (ancestor-of-owner-abandoned?, land-plan), never a reimplementation.
;;
;; Invariant 1 ("A stray is recorded superseded on the owner-land ground
;; only when it is an ancestor of a commit that its own closed owner's
;; abandoned_commits names; any other closed-owner commit keeps today's
;; handling.") - P1 builds a randomized DAG: a chain of the closed owner's
;; own commits (some of which end up named in abandoned_commits, some not)
;; plus distractor commits on unrelated branches, all naming the SAME
;; owner, and asserts ancestor-of-owner-abandoned?'s answer for EVERY one
;; of them matches ground truth (`git merge-base --is-ancestor` against
;; each recorded entry directly), never approximated.
;;
;; Invariant 2 ("The ground never changes what lands: a stray superseded
;; this way is never cherry-picked, and the replay branch's tree is
;; byte-identical to its tree before the stray was considered.") - P2 is a
;; DIFFERENTIAL property: for a randomized (shared-file content, action)
;; pair, land-plan runs TWICE against the real land-plan/replay!
;; machinery - once with the superseded draft present in history, once
;; with it ARTIFICIALLY ABSENT (the role branch built without it at all,
;; starting straight from the rewrite/removal) - and asserts the two
;; resulting replay trees are byte-identical. If the ground ever let the
;; draft's own lines influence the tree, or skipped the pick without also
;; skipping its EFFECT, the two runs would diverge.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners (e.g. bl1806_land_plan_fat_tip_detection_property_runner.bb).
;; Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time (mutant restored before
;; this commit; `git diff` against the pre-break copy confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken ancestor-of-owner-
;;     abandoned? (hardcoded to always return true) - failed on every
;;     generated case with at least one distractor/non-ancestor commit.
;;   - P2 was run against a deliberately broken replay loop that cherry-
;;     picked the stray REGARDLESS of ancestor-of-owner-abandoned?'s
;;     answer (the pre-BL-1795 shape) - failed on every generated
;;     "rewrites" case (the with-draft tree diverged from the without-
;;     draft tree, or the replay escalated instead of completing).

(ns bl1795-owner-land-superseded-stray-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[i s'] (gen-int s 2)] [(= i 1) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(defn- head [root] (:out (sh! root "git" "rev-parse" "HEAD")))

(defn- mark-origin-main-here! [root]
  (sh! root "git" "update-ref" "refs/remotes/origin/main" (head root)))

(defmacro with-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1795-prop-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (sh! ~root-sym "git" "commit" "-q" "--allow-empty" "-m" "seed")
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

;; ── P1: ancestor-of-owner-abandoned? matches ground truth, over a ──────
;; randomized DAG of chain + distractor commits ─────────────────────────

(def OWNER "BL-9787")

(defn gen-p1 [s]
  (let [[chain-len s1] (gen-int s 4)     ; 1..4 commits in the owner's own chain
        [n-abandoned s2] (gen-int s1 3)  ; 1..3 abandoned_commits entries (from the chain, by index)
        [n-distractors s3] (gen-int s2 3)] ; 0..2 unrelated distractor commits
    [{:chain-len (inc chain-len) :n-abandoned (inc n-abandoned) :n-distractors n-distractors} s3]))

(defn- p1-case [{:keys [chain-len n-abandoned n-distractors]}]
  (with-fixture [root]
    (mark-origin-main-here! root)
    (let [seed (head root)
          ;; The owner's own linear chain: chain[i] is an ancestor of every
          ;; chain[j], j > i.
          chain (loop [i 0 acc []]
                  (if (= i chain-len)
                    acc
                    (do (commit! root (str "docs/chain-" i ".md") (str "line " i "\n") (str OWNER ": chain commit " i))
                        (recur (inc i) (conj acc (head root))))))
          n-abandoned (min n-abandoned chain-len)
          abandoned-idxs (vec (take n-abandoned (reverse (range chain-len)))) ; the LAST n-abandoned chain commits
          abandoned (mapv chain abandoned-idxs)
          distractors (loop [i 0 acc []]
                        (if (= i n-distractors)
                          acc
                          (do (sh! root "git" "checkout" "-q" "-b" (str "distractor-" i "-" (System/nanoTime)) seed)
                              (commit! root (str "docs/distractor-" i ".md") (str "distractor " i "\n") (str OWNER ": distractor " i))
                              (let [c (head root)]
                                (sh! root "git" "checkout" "-q" "main")
                                (recur (inc i) (conj acc c))))))
          origin-main (:out (sh! root "git" "rev-parse" "origin/main"))
          all-candidates (concat chain distractors)]
      ;; The abandoned_commits list itself never needs to exist as a real
      ;; ticket file here - ancestor-of-owner-abandoned? takes the entry
      ;; list directly via ticket-abandoned-commits, which this property
      ;; drives by writing the ticket file once, after the chain/distractors
      ;; are built (so every sha is known).
      (commit! root (str "backlog/active/" OWNER "-sib.yaml")
               (str "id: " OWNER "\nabandoned_commits: [" (str/join ", " abandoned) "]\n")
               (str OWNER ": closed, records " n-abandoned " abandoned commit(s)"))
      (let [bad
            (keep
             (fn [candidate]
               (let [expected (boolean (some #(zero? (:exit (sh! root "git" "merge-base" "--is-ancestor" candidate %))) abandoned))
                     actual (land-step-lib/ancestor-of-owner-abandoned? root origin-main candidate OWNER)]
                 (when (not= expected actual)
                   (str "candidate " candidate " expected " expected ", got " actual))))
             all-candidates)]
        (if (seq bad) (str/join "; " bad) true)))))

;; ── P2: the superseded ground never changes what lands (differential) ──

(def BASE-LINE "base line\n")
(def LANDING "BL-9785")

;; Path choice mirrors the acceptance feature's own two scenarios exactly:
;; "rewrites" uses a SHARED path (the landing ticket also edits it, so the
;; owner's own net contribution there is non-empty and reads as landed -
;; no unrelated entangled-siblings/passenger-consistency concern, BL-1375,
;; a separate mechanism this ticket does not touch); "removes" uses a
;; SIBLING-ONLY path the landing ticket never touches, since a fully
;; retracted contribution (added-then-removed nets to nothing) always
;; reads as unlanded/vacuous there regardless of this ticket's own fix -
;; sharing that path with the landing ticket would trip the SAME
;; passenger guard on every draw, with or without this ticket's change,
;; and prove nothing about it either way.
(defn- docs-path [rewrites?] (if rewrites? "docs/shared.md" "docs/sibling-only.md"))

(defn gen-p2 [s]
  (let [[rewrites? s1] (gen-bool s)]
    [{:rewrites? rewrites?} s1]))

;; Builds the fixture with the draft PRESENT (draft commit + rewrite/remove
;; commit, both ancestors of the role branch) or ABSENT (the role branch
;; starts straight from a commit carrying the rewrite/remove's own final
;; content, with no draft commit anywhere in history) - returns the
;; replay's own tree content at the scenario's own docs path, or an error
;; string. land-plan's :land and :replay both build the same kind of
;; fresh-off-origin-main commit (BL-1678) - either is a valid outcome
;; here; only the final TREE is what this invariant is about.
(defn- p2-run [draft-present? rewrites?]
  (with-fixture [root]
    (mark-origin-main-here! root)
    (let [docs-path (docs-path rewrites?)]
    (commit! root docs-path BASE-LINE "seed docs")
    (let [origin (head root)
          landed-content (if rewrites? (str BASE-LINE "rewritten entry\n") BASE-LINE)
          role-start
          (if draft-present?
            (do (sh! root "git" "checkout" "-q" "-b" "sibling-work" origin)
                (commit! root docs-path (str BASE-LINE "draft entry\n") (str OWNER ": pre-land draft entry"))
                (commit! root docs-path landed-content (str OWNER ": rewrite/remove before landing"))
                (head root))
            (do (sh! root "git" "checkout" "-q" "-b" "sibling-work" origin)
                (commit! root docs-path landed-content (str OWNER ": rewrite/remove before landing, no draft in history"))
                (head root)))
          approved-tip role-start]
      (sh! root "git" "checkout" "-q" "main")
      ;; Untagged subject, deliberately: a tagged subject here would let the
      ;; PRE-EXISTING grounds (b)/(c) - a HEAD-side conflicting line last
      ;; written by a commit naming the owner, or descending from one that
      ;; does - independently supersede the same stray, which would make
      ;; this property pass even with THIS ticket's own check disabled and
      ;; prove nothing about it. A tip-pure land's own freshly-built commit
      ;; is exactly this shape in production: it is not itself authored
      ;; "as" the sibling ticket.
      (when-not (= landed-content BASE-LINE)
        (commit! root docs-path landed-content "docs: sync shared content"))
      ;; backlog/done/, never active/ - closed-owner-pure-evidence-stray?
      ;; (the gate that puts a commit in the cherry-pick loop AT ALL)
      ;; requires closed-on-main? to be true; filing this under active/
      ;; would silently make stray-commits EMPTY and this whole property
      ;; vacuous, never touching the mechanism under test either way.
      (commit! root (str "backlog/done/" OWNER "-sib.yaml")
               (str "id: " OWNER "\nabandoned_commits: [" approved-tip "]\n")
               (str OWNER ": closed, records the approved tip"))
      (mark-origin-main-here! root)
      (let [origin-main (:out (sh! root "git" "rev-parse" "origin/main"))]
        (sh! root "git" "checkout" "-q" "-b" "role" role-start)
        (if rewrites?
          ;; "shared": the landing ticket ALSO edits this same path.
          (let [abs (str (fs/path root docs-path))]
            (spit abs (str (slurp abs) "landing ticket entry\n"))
            (sh! root "git" "add" "-A"))
          ;; "removes": the landing ticket never touches docs-path at all -
          ;; its own work is a wholly unrelated file.
          (do (fs/create-dirs (fs/path root "backlog" "active"))
              (spit (str (fs/path root "backlog" "active" (str LANDING "-fixture.yaml"))) (str "id: " LANDING "\n"))
              (sh! root "git" "add" "-A")))
        (sh! root "git" "commit" "-q" "-m" (str LANDING ": own entry"))
        (let [tip (head root)
              plan (land-step-lib/land-plan {:root root :commit tip :task-ticket-id LANDING :origin-main origin-main})]
          (if-not (contains? #{:land :replay} (:action plan))
            {:error (str "expected :land or :replay, got " (pr-str plan))}
            (let [content (:out (sh! root "git" "show" (str (:commit plan) ":" docs-path)))]
              {:content content}))))))))

(defn- p2-case [{:keys [rewrites?]}]
  (let [with-draft (p2-run true rewrites?)
        without-draft (p2-run false rewrites?)]
    (cond
      (:error with-draft) (str "with-draft run: " (:error with-draft))
      (:error without-draft) (str "without-draft run: " (:error without-draft))
      (not= (:content with-draft) (:content without-draft))
      (str "rewrites?=" rewrites? ": tree diverged with the draft present vs absent - "
           "with=" (pr-str (:content with-draft)) " without=" (pr-str (:content without-draft)))
      :else true)))

;; ── runner ─────────────────────────────────────────────────────────────

(defn- check-all [prop gen-fn pred-fn seed0]
  (loop [i 0 s seed0]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(check-all "P1: ancestor-of-owner-abandoned? matches ground truth over a randomized DAG" gen-p1 p1-case 1795)
;; P2 builds two full real replays per draw - kept small.
(check-all "P2: the superseded ground never changes what lands (differential)" gen-p2 p2-case 1795)

(println (str "bl1795 owner-land-superseded-stray properties: P1 " runs " runs, P2 " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))

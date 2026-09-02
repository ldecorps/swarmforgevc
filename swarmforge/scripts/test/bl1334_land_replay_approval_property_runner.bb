#!/usr/bin/env bb
;; BL-1334 property tests (coder-authored, THREE declared invariants) over the
;; REAL shared approval predicate, is_qa_ancestor.sh, and the REAL writer,
;; land_step_lib.bb - never a Clojure restatement of either, because the
;; predicate IS the thing all three invariants quantify over.
;;
;;   Invariant 1: "A commit the land step publishes to main reads as
;;   QA-approved at the moment it lands: no later, unrelated merge is required
;;   to make the shared predicate answer approved."
;;
;;   Invariant 2: "Approval never spreads: only the commit the land step
;;   landed for an approved parcel gains it, never an unrelated commit that
;;   happens to sit on the same branch."
;;
;;   Invariant 3: "A bounce verdict on file still vetoes approval, whatever
;;   the land step did to the ref or the store (BL-952)."
;;
;; The state space is small and fully enumerable, so this sweeps it
;; EXHAUSTIVELY rather than sampling: 4 commit shapes x 4 land-store states x
;; 3 bounce states = 48 cases, every one driven through a real
;; `bash is_qa_ancestor.sh` in a real git fixture. An exhaustive sweep needs
;; no reachability floor argument: every state IS reached, once, by
;; construction - which is the honest answer to BL-654's generator-reach
;; clause for a space this shape.
;;
;; Records are written by the REAL writer (land-step-lib/record-land-approval!)
;; so the sweep's store lines are the ones production writes - never a
;; hand-built JSON line that could agree with the reader while the writer
;; disagrees with both.
;;
;; The expected outcome is derived from the CONSTITUTIONAL rules - a bounce
;; vetoes everything; unknown is never approved; a land record approves only
;; when the SOURCE it names is itself approved; ancestry approves; nothing
;; else does - rather than from reading the script, so agreeing with the
;; implementation is a real result and not a tautology.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def predicate (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "is_qa_ancestor.sh")))
(def failures (atom []))
(def coverage (atom {}))
(def root (str (fs/create-temp-dir {:prefix "bl1334-prop-"})))

;; BL-1033 / BL-971 temp-dir trap: the end-of-run delete-tree is top level and
;; is reached only when every preceding form completes, so a throw would leak
;; the root permanently. Reclaim it on every exit path.
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? root) (fs/delete-tree root)))))

(defn- g [& args]
  (let [{:keys [exit out err]}
        (apply process/sh {:dir root :continue true}
               "git" "-c" "user.email=t@t" "-c" "user.name=t" args)]
    (when-not (zero? exit)
      (throw (ex-info (str "git failed: " (str/join " " args) " - " err) {})))
    (str/trim (str out))))

(defn- commit! [file subject]
  (fs/create-dirs (fs/path root "extension" "src"))
  (spit (str (fs/path root "extension" "src" file)) (str subject "\n"))
  (g "add" "-A")
  (g "commit" "-q" "-m" subject)
  (g "rev-parse" "HEAD"))

;; ── the fixture ───────────────────────────────────────────────────────────
;; swarmforge-QA is pinned at the approved SOURCE and never moves again: every
;; commit after it is drift, exactly like a freshly landed replay.
(g "init" "-q" "-b" "main")
(g "commit" "-q" "--allow-empty" "-m" "seed")
(def approved-source (commit! "source.ts" "BL-9001: the parcel QA approved"))
(g "branch" "swarmforge-QA")

(def bounced-source (commit! "bounced.ts" "BL-9002: a parcel QA sent back"))
(def replay-of-approved (commit! "replay-a.ts" "BL-9001: tip-pure replay onto origin/main"))
(def replay-of-bounced (commit! "replay-b.ts" "BL-9002: tip-pure replay onto origin/main"))
(def unrelated (commit! "unrelated.ts" "pipeline code belonging to no approved parcel"))

;; Four shapes: what the predicate is asked about.
;;   :source-of  - the source this shape's land record names, nil for none
(def commit-shapes
  [{:label :replay-of-approved :sha replay-of-approved :source-of approved-source :ancestor? false}
   {:label :replay-of-bounced  :sha replay-of-bounced  :source-of bounced-source  :ancestor? false}
   {:label :unrelated          :sha unrelated          :source-of nil             :ancestor? false}
   {:label :approved-source    :sha approved-source    :source-of nil             :ancestor? true}])

(def land-states [:recorded :absent :unreadable :corrupt])
;; :approved-source-bounced is the BL-952 shape and the reason it is here.
;; Bouncing a source that is NOT reachable from the QA ref proves nothing
;; about the veto - the source fails the ancestry test anyway, so removing
;; the bounce check entirely leaves every answer unchanged (measured: it
;; did, and this sweep passed a deliberately broken predicate until this
;; state was added). Only a source that IS reachable and IS bounced can
;; tell a live veto from a dead one.
(def bounce-states [:clean :source-bounced :approved-source-bounced])

(def land-dir (fs/path root ".swarmforge" "land-approvals"))
(def bounce-dir (fs/path root ".swarmforge" "bounces"))
(def bounce-file (fs/path bounce-dir "2026-09.jsonl"))

(defn- reset-land-store! [state]
  (when (fs/exists? land-dir) (fs/delete-tree land-dir))
  (case state
    :absent nil
    :recorded
    ;; The REAL writer, for every replay shape that has a source.
    (doseq [shape commit-shapes :when (:source-of shape)]
      (land-step-lib/record-land-approval! {:root root :commit (:sha shape)
                              :source (:source-of shape)
                              :task-ticket-id (name (:label shape))}))
    :unreadable
    (do (doseq [shape commit-shapes :when (:source-of shape)]
          (land-step-lib/record-land-approval! {:root root :commit (:sha shape)
                                  :source (:source-of shape)
                                  :task-ticket-id (name (:label shape))}))
        (doseq [f (fs/list-dir land-dir)] (fs/set-posix-file-permissions f "---------")))
    :corrupt
    (do (fs/create-dirs land-dir)
        (spit (str (fs/path land-dir "2026-09.jsonl")) "this is not a record\n"))))

(defn- reset-bounce-store! [state]
  (when (fs/exists? bounce-dir) (fs/delete-tree bounce-dir))
  (let [target (case state
                 :source-bounced bounced-source
                 :approved-source-bounced approved-source
                 nil)]
    (when target
      (fs/create-dirs bounce-dir)
      (spit (str bounce-file)
            (str "{\"at\":\"2026-09-02T00:00:00Z\",\"by\":\"QA\",\"commit\":\""
                 (subs target 0 10) "\",\"evidence\":\"x\"}\n")))))

;; The CONSTITUTIONAL expectation, derived from the rules rather than the code.
;;   0 approved, 1 clean no, 2 undeterminable.
(defn- expected [shape land bounce]
  (let [bounced-sha (case bounce
                      :source-bounced bounced-source
                      :approved-source-bounced approved-source
                      nil)
        ;; A bounce on the sha being ASKED about vetoes it outright - that is
        ;; the first thing the predicate does, before any approval path.
        self-bounced? (and bounced-sha (= (:sha shape) bounced-sha))
        ;; A bounce on the SOURCE a land record names means the mapping
        ;; resolves to something unapproved, so it grants nothing (BL-952:
        ;; reachability is not approval, and neither is a record).
        source-bounced? (and bounced-sha (= (:source-of shape) bounced-sha))]
    (cond
      ;; A store that exists and cannot be consulted is undeterminable for
      ;; every sha at once - it is a STORE-level problem, raised before any
      ;; per-sha answer (invariant 3 of BL-925: unknown is never approved).
      ;; ORDER IS THE RULE, not an accident. A bounce on the sha itself is
      ;; answered BEFORE an unconsultable store is raised: the predicate
      ;; documents this deliberately for the expedite store ("a sha with a
      ;; bounce on file answers a clean no even when this store is
      ;; unreadable"), and the land store inherits the same posture. A
      ;; bounced sha is knowably not approved whatever else cannot be read.
      self-bounced? 1
      ;; Only now does a store that exists and cannot be consulted make the
      ;; answer undeterminable (BL-925 invariant 3: unknown is never approved).
      (#{:unreadable :corrupt} land) 2
      ;; A record whose source was bounced grants nothing, even though that
      ;; source is reachable from the QA ref. This is BL-952's whole point.
      source-bounced? 1
      ;; Ancestry still approves on its own, land store or not.
      (:ancestor? shape) 0
      ;; A land record approves only when the source it names is itself
      ;; approved: reachable from the QA ref and not bounced.
      (and (= land :recorded)
           (= (:source-of shape) approved-source)) 0
      ;; Everything else - no record, a record naming a bounced source, a
      ;; record naming a source that is not approved - is a clean no.
      :else 1)))

(defn- run-predicate [sha]
  (let [{:keys [exit]} (process/sh {:dir root :continue true} "bash" predicate sha)]
    exit))

(doseq [shape commit-shapes
        land land-states
        bounce bounce-states]
  (reset-land-store! land)
  (reset-bounce-store! bounce)
  (let [want (expected shape land bounce)
        got (run-predicate (:sha shape))
        label (str (name (:label shape)) " / land=" (name land) " / bounce=" (name bounce))]
    (swap! coverage update [(:label shape) land bounce] (fnil inc 0))
    (when-not (= want got)
      (swap! failures conj (str "FAIL " label " - expected exit " want ", got " got)))))

;; Restore permissions so the temp tree can be reclaimed.
(when (fs/exists? land-dir)
  (doseq [f (fs/list-dir land-dir)] (fs/set-posix-file-permissions f "rw-r--r--")))

(println (str "bl1334 land-replay-approval properties: " (count @coverage)
              " cases, exhaustive"))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " failure(s)"))
      (fs/delete-tree root)
      (System/exit 1))
  (do (println "ALL PROPERTIES HOLD")
      (fs/delete-tree root)))

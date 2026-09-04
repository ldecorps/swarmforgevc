#!/usr/bin/env bb
;; BL-1374: PROPERTY tests over the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 a-genuine-entanglement-is-still-refused - whenever this ticket's own
;;      NON-MERGE commit changed a path an unlanded sibling also changed, the
;;      land is refused and the refusal names that sibling. Narrowing the path
;;      set must not let real shared-file work ride into main unnoticed
;;      (BL-1332, the whole reason the refusal exists).
;;   P2 detection-stays-as-wide - every sibling whose work is on the tip and
;;      not on origin/main is still REPORTED as unlanded, whether or not its
;;      paths are credited to this ticket (BL-1308 invariant 2, widened
;;      deliberately).
;;   P3 no-own-path-is-dropped - every path this ticket's own non-merge
;;      commits changed is either in the replay set or the run refused. The
;;      narrowing may never silently lose the ticket's own content.
;;
;; Toolchain: the .bb property-runner precedent (expedite_lib_property_runner.bb,
;; bl1131_ticket_land_property_runner.bb next door); BL-472 defers property
;; tooling for Babashka and BL-654's *.property.test.js home is the TypeScript
;; lane.
;;
;; GENERATOR REACH is asserted, not hoped for, and the reach that matters here
;; is a SHARED path - a passenger and this ticket touching the same file. Two
;; independently drawn filenames would collide essentially never, so the shared
;; case is CONSTRUCTED: when the shape calls for it, this ticket's own edit is
;; derived from the passenger's own file rather than drawn beside it. The run
;; fails unless every shape, and specifically the shared-and-refused case, was
;; generated.
;;
;; Each case builds a real git repository, so the run is deliberately small.
;; PROPERTY_RUNS raises it.

(ns bl1374-sync-merge-passengers-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "land_step_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 24))
(def failures (atom []))
(def reached (atom #{}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

;; BL-971: a killed run traps nothing, so the prefix is swept before this run
;; as well as torn down after each case.
(def tmp-prefix "bl1374-prop-")
(doseq [d (fs/list-dir (fs/temp-dir))]
  (when (str/starts-with? (fs/file-name d) tmp-prefix)
    (try (fs/delete-tree d) (catch Exception _ nil))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defn- commit! [root path content message]
  (fs/create-dirs (fs/parent (fs/path root path)))
  (spit (str (fs/path root path)) content)
  (sh! root "git" "add" "-A")
  (sh! root "git" "commit" "-q" "-m" message))

(def shapes
  ;; :passenger-only  - the sync carries a sibling's file this ticket never touched
  ;; :shared          - this ticket's OWN commit edits the file the sibling also edits
  ;; :auto-merge      - two SIBLINGS edit one file from opposite ends; the sync
  ;;                    merge naming this ticket combines them and owns nothing
  ;; :resolved-merge  - the sync merge resolves a conflict by hand, so it really
  ;;                    did author a line
  [:passenger-only :shared :auto-merge :resolved-merge])

(defn- build!
  "One fixture. Returns {:root :commit :own-paths-authored :unlanded-expected}."
  [shape]
  (let [root (str (fs/create-temp-dir {:prefix tmp-prefix}))]
    (sh! root "git" "init" "-q" "-b" "main" ".")
    (sh! root "git" "config" "user.email" "t@t")
    (sh! root "git" "config" "user.name" "t")
    (sh! root "git" "config" "commit.gpgsign" "false")
    (commit! root "shared.txt" "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n" "seed")
    (sh! root "git" "update-ref" "refs/remotes/origin/main" "HEAD")
    ;; the sibling's unlanded work, on local main
    (commit! root "shared.txt" "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nBL-9002 tail\n" "BL-9002: sibling appends")
    (sh! root "git" "checkout" "-q" "-b" "tA"
         (:out (sh! root "git" "rev-parse" "refs/remotes/origin/main")))
    (let [own (case shape
                :passenger-only (do (commit! root "own.txt" "own\n" "BL-9001: own work") ["own.txt"])
                ;; CONSTRUCTED collision: this ticket's edit is derived from the
                ;; passenger's own file, never drawn beside it.
                :shared (do (commit! root "shared.txt" "BL-9001 head\nb\nc\nd\ne\nf\ng\nh\ni\nj\n"
                                     "BL-9001: own edit to the shared file")
                            ["shared.txt"])
                :auto-merge (do (commit! root "shared.txt" "BL-9003 head\nb\nc\nd\ne\nf\ng\nh\ni\nj\n"
                                         "BL-9003: another sibling edits the top")
                                (commit! root "own.txt" "own\n" "BL-9001: own work")
                                ["own.txt"])
                :resolved-merge (do (commit! root "shared.txt" "a\nb\nc\nd\ne\nf\ng\nh\ni\nBL-9003 tail\n"
                                              "BL-9003: another sibling edits the tail")
                                    (commit! root "own.txt" "own\n" "BL-9001: own work")
                                    ["own.txt"]))]
      (sh! root "git" "merge" "--no-ff" "-q" "-m" "BL-9001: sync main into the branch" "main")
      (when (= shape :resolved-merge)
        ;; a conflict this ticket resolved by hand: content NEITHER parent holds
        (spit (str (fs/path root "shared.txt")) "a\nb\nc\nd\ne\nf\ng\nh\nRESOLVED\nBOTH\n")
        (sh! root "git" "add" "-A")
        (sh! root "git" "commit" "-q" "-m" "BL-9001: sync main into the branch"))
      {:root root
       :commit (:out (sh! root "git" "rev-parse" "HEAD"))
       :own-authored own
       ;; Whether a refusal is CORRECT for this shape, stated by the fixture
       ;; rather than inferred from the answer under test. Without it every
       ;; property that only asserts on a replay is skipped the moment the
       ;; code wrongly refuses - which is exactly how the pre-fix behaviour
       ;; slipped past an earlier draft of this runner.
       :entanglement-expected? (contains? #{:shared :resolved-merge} shape)
       :siblings (case shape
                   (:auto-merge :resolved-merge) #{"BL-9002" "BL-9003"}
                   #{"BL-9002"})})))

(loop [i 0 s 913740]
  (when (< i runs)
    (let [[shape s'] (gen-pick s shapes)
          {:keys [root commit own-authored siblings entanglement-expected?]} (build! shape)]
      (try
        (let [{:keys [unlanded warning]} (land-step-lib/entangled-siblings root commit "BL-9001")
              result (land-step-lib/own-paths root commit "BL-9001" (or unlanded #{}))
              refused? (nil? (:paths result))
              input {:shape shape :siblings siblings}]
          (swap! reached conj [shape refused?])

          ;; ── P2: detection stays as wide as it was ─────────────────────
          (when warning
            (report! "P2" s input (str "detection could not run: " warning)))
          (doseq [sib siblings]
            (when-not (contains? (set unlanded) sib)
              (report! "P2" s input (str "sibling " sib " stopped being reported as unlanded; got "
                                         (pr-str unlanded)))))

          ;; ── P1: a genuine entanglement is still refused - and ONLY a
          ;;        genuine one. Both directions, because a fix that refuses
          ;;        everything satisfies the first half perfectly.
          (if entanglement-expected?
            (do
              (when-not refused?
                (report! "P1" s input (str "a real shared-file edit was allowed to replay: " (pr-str result))))
              (when (and refused? (not (some #(str/includes? (str (:warning result)) %) siblings)))
                (report! "P1" s input (str "the refusal named no sibling: " (:warning result)))))
            (when refused?
              (report! "P1" s input (str "a land was refused with no genuine entanglement in it - "
                                         "this ticket's own commits touched no shared path: "
                                         (:warning result)))))

          ;; ── P3: no own path is dropped ────────────────────────────────
          (when-not refused?
            (doseq [p own-authored]
              (when-not (contains? (set (:paths result)) p)
                (report! "P3" s input (str "this ticket's own path " p
                                           " was dropped from the replay: " (pr-str (:paths result)))))))

          ;; And the ticket's own remedy, stated as a property rather than as
          ;; one example: a path NO own non-merge commit touched is never this
          ;; ticket's own path.
          (when (and (not refused?) (not (some #{"shared.txt"} own-authored)))
            (when (contains? (set (:paths result)) "shared.txt")
              (report! "P1" s input "a passenger the merge merely carried became this ticket's own path"))))
        (finally (fs/delete-tree root)))
      (recur (inc i) s'))))

;; ── the reachability floor ───────────────────────────────────────────────

(doseq [shape shapes]
  (when-not (some #(= shape (first %)) @reached)
    (swap! failures conj (str "FAIL generator reach: shape " shape " was never generated in " runs " runs."))))
;; The case P1 exists for: a shared path that really is entangled and really is
;; refused. Without it P1 would pass on shapes that never enter its branch.
(when-not (contains? @reached [:shared true])
  (swap! failures conj "FAIL generator reach: the shared-and-refused case, the only one P1's first half asserts on, was never generated."))
(when-not (contains? @reached [:passenger-only false])
  (swap! failures conj "FAIL generator reach: a passenger-only case that actually replayed was never generated - P1's second half asserted on nothing."))
;; ...and its opposite: a run that actually replayed, or P3 asserts on nothing.
(when-not (some #(false? (second %)) @reached)
  (swap! failures conj "FAIL generator reach: no run replayed at all, so P3 asserted on nothing."))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println (str "bl1374 sync merge passengers: ALL PROPERTIES HOLD (" runs " fixture runs)")))

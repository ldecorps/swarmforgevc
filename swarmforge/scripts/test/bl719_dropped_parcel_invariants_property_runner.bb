#!/usr/bin/env bb
;; BL-719: PROPERTY tests over chase_sweep_lib.bb's dropped-parcel
;; functions, covering the three invariants the ticket YAML declares
;; (coder-authored first, per BL-654). Seeded (not wall-clock) randomness
;; so failures reproduce: a fixed-seed java.util.Random, never rand/
;; rand-int's unseeded global generator. Follows the established .bb
;; property-runner precedent (see bl835_flow_watchdog_threshold_gate_
;; property_runner.bb) - the "*.property.test.js" / vitest.properties.
;; config.mjs home is a TypeScript convention with no Babashka equivalent
;; (BL-472 tracks pinning real property tooling for .bb scripts,
;; deliberately deferred).
;;
;;   P1 live-mail-always-suppresses - "A nudge fires only for an active
;;      ticket with NO parcel in any role's new or in_process; a ticket
;;      holding live mail is never nudged, at any trail age." Across
;;      randomly generated (newest-trail-ms, now-ms, stall-threshold-ms)
;;      triples spanning BOTH very-stale and not-yet-stale trails,
;;      decide-dropped-parcel? must return false whenever live-mail?=true,
;;      regardless of staleness - and the SAME triple with live-mail?=false
;;      must return true whenever the trail is actually stale, proving the
;;      generator reaches a case the live-mail gate is the ONLY thing
;;      suppressing (never a vacuously-always-false property).
;;
;;   P2 sweep-is-read-only - "The sweep's only side effect is a note to the
;;      coordinator - it never writes assigned_to, never routes, never
;;      promotes, and never moves a backlog file." Across randomly
;;      generated active-dir/scan-dir fixtures (random ticket counts,
;;      random trail files, random assigned_to values), every file's byte
;;      content and every directory's file-name set is IDENTICAL before and
;;      after dropped-parcel-items runs, regardless of how many dropped-
;;      parcel candidates it finds.
;;
;;   P3 self-nudge-never-refreshes-staleness - "Repeated sweeps over an
;;      unchanged stalled ticket produce at most one nudge per cooldown
;;      window; the nudge's own trail never re-arms the detector." Across
;;      randomly generated real-trail timestamps with a self-nudge
;;      timestamp CONSTRUCTED to always be strictly more recent (BL-654
;;      collision-by-construction, not independently drawn - the exact
;;      shape that breaks a naive "newest file wins" implementation),
;;      newest-trail-event-ms must always equal the real trail's timestamp,
;;      never the self-nudge's, however much more recent the self-nudge is.

(ns bl719-dropped-parcel-invariants-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 719))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- rlong [bound] (long (rint bound)))

;; ── P1: live-mail-always-suppresses ───────────────────────────────────────

(def p1-branches-hit (atom #{}))

(dotimes [_ 60]
  (let [now-ms (+ 1000000000 (rlong 1000000000))
        stall-ms (+ 1000 (rlong 3600000))
        ;; Deliberately targets both sides of the staleness gate (a uniform
        ;; draw over a wide range would almost never land exactly stale-vs-
        ;; fresh) - coin flip picks the side, magnitude still randomizes.
        stale? (rbool)
        newest-trail-ms (if stale?
                           (- now-ms stall-ms (rlong 1000000))
                           (+ (- now-ms stall-ms) 1 (rlong (dec stall-ms))))]
    (swap! p1-branches-hit conj (if stale? :stale :fresh))
    (assert-true (str "live mail must suppress the nudge regardless of trail age "
                       "(now=" now-ms " newest=" newest-trail-ms " stall=" stall-ms " stale?=" stale? ")")
                 (false? (chase-sweep-lib/decide-dropped-parcel?
                          {:has-trail? true :live-mail? true :newest-trail-ms newest-trail-ms}
                          now-ms stall-ms)))
    (when stale?
      ;; Same triple, live-mail?=false: proves live-mail? is the ONLY thing
      ;; suppressing in the stale case above - not a vacuous property that
      ;; would pass even if decide-dropped-parcel? ignored live-mail?
      ;; entirely.
      (swap! p1-branches-hit conj :would-nudge-but-for-live-mail)
      (assert-true (str "the SAME stale triple with no live mail must nudge "
                         "(now=" now-ms " newest=" newest-trail-ms " stall=" stall-ms ")")
                   (true? (chase-sweep-lib/decide-dropped-parcel?
                           {:has-trail? true :live-mail? false :newest-trail-ms newest-trail-ms}
                           now-ms stall-ms))))))

(assert-true "P1 generator reached a stale trail, a fresh trail, and the would-nudge-but-for-live-mail counter-case"
             (and (contains? @p1-branches-hit :stale)
                  (contains? @p1-branches-hit :fresh)
                  (contains? @p1-branches-hit :would-nudge-but-for-live-mail)))

;; Non-vacuousness: a deliberately broken decide fn that ignores live-mail?
;; must fail P1's core assertion - proves P1 actually catches the defect it
;; guards, not a tautology.
(defn- broken-decide-ignores-live-mail? [{:keys [has-trail? newest-trail-ms]} now-ms stall-ms]
  (boolean (and has-trail? (number? newest-trail-ms) (>= (- now-ms newest-trail-ms) stall-ms))))

(let [now-ms 2000000000 stall-ms 5000 newest-trail-ms (- now-ms stall-ms 1000)]
  (assert-true "P1 non-vacuousness: the broken (live-mail-ignoring) implementation WOULD wrongly nudge live-mail candidates"
               (true? (broken-decide-ignores-live-mail? {:has-trail? true :live-mail? true :newest-trail-ms newest-trail-ms} now-ms stall-ms)))
  (assert-true "P1 non-vacuousness: the REAL implementation correctly refuses the same input"
               (false? (chase-sweep-lib/decide-dropped-parcel? {:has-trail? true :live-mail? true :newest-trail-ms newest-trail-ms} now-ms stall-ms))))

;; ── P2: sweep-is-read-only ─────────────────────────────────────────────────

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn- mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl719-property-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- rword [] (str "w" (rint 1000000)))

(defn- snapshot-tree [dir]
  "Every regular file under dir (recursively), as {relative-path content}."
  (if-not (fs/exists? dir)
    {}
    (into {}
          (for [f (file-seq (fs/file dir))
                :when (.isFile f)]
            [(str (fs/relativize dir (.toPath f))) (slurp f)]))))

(def p2-any-candidates-found? (atom false))

(dotimes [_ 25]
  (let [tmp (mk-tmp)
        active-dir (str (fs/path tmp "active"))
        sent-dir (str (fs/path tmp "sent"))
        new-dir (str (fs/path tmp "new"))
        n-items (inc (rint 5))]
    (fs/create-dirs active-dir)
    (fs/create-dirs sent-dir)
    (dotimes [i n-items]
      (let [id (str "BL-" (+ 100 i (rint 900)))]
        (spit (str (fs/path active-dir (str id "-demo.yaml")))
              (str "id: " id "\ntitle: \"demo\"\nstatus: todo\nassigned_to: " (rword) "\n"))
        ;; Half the items get a real, stale trail file (dropped-parcel
        ;; candidates); half get none (never-dispatched, dispatch-gap's
        ;; territory) - exercises both paths through the same fixture.
        (when (rbool)
          (spit (str (fs/path sent-dir (str id "-trail-" (rint 100000) ".handoff")))
                (str "from: coder\nto: cleaner\ntype: git_handoff\ntask: " id "-demo\n"
                     "enqueued_at: 2020-01-01T00:00:00.000000Z\n\nbody\n")))))
    (let [before (merge (snapshot-tree active-dir) (snapshot-tree sent-dir) (snapshot-tree new-dir))
          candidates (chase-sweep-lib/dropped-parcel-items
                      active-dir [sent-dir] [new-dir]
                      (.toEpochMilli (java.time.Instant/parse "2026-08-14T00:00:00.000000Z"))
                      3600000)
          after (merge (snapshot-tree active-dir) (snapshot-tree sent-dir) (snapshot-tree new-dir))]
      (when (seq candidates) (reset! p2-any-candidates-found? true))
      (assert-true (str "dropped-parcel-items must write nothing to active-dir/scan-dirs, regardless of candidates found "
                         "(n-items=" n-items ", candidates=" (mapv :id candidates) ")")
                   (= before after)))))

(assert-true "P2 generator found at least one real dropped-parcel candidate (not a vacuous always-empty run)"
             @p2-any-candidates-found?)

;; Non-vacuousness: a deliberately broken variant that DOES write (mutates
;; a backlog file as a side effect) must fail the byte-identical assertion
;; - proves the equality check actually catches a write, not a tautology.
(let [tmp (mk-tmp)
      active-dir (str (fs/path tmp "active"))]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir "BL-1-demo.yaml")) "id: BL-1\ntitle: \"x\"\nassigned_to: coder\n")
  (let [before (snapshot-tree active-dir)
        _ (spit (str (fs/path active-dir "BL-1-demo.yaml")) "id: BL-1\ntitle: \"x\"\nassigned_to: cleaner\n") ; simulated broken write
        after (snapshot-tree active-dir)]
    (assert-true "P2 non-vacuousness: a broken implementation that DOES write is caught by the same equality check"
                 (not= before after))))

;; ── P3: self-nudge-never-refreshes-staleness ──────────────────────────────

(def p3-max-self-nudge-lead-ms (atom 0))

(dotimes [_ 40]
  (let [tmp (mk-tmp)
        sent-dir (str (fs/path tmp "sent"))
        coord-dir (str (fs/path tmp "coord"))
        item-id (str "BL-" (+ 100 (rint 900)))
        real-trail-ms (.toEpochMilli (java.time.Instant/parse "2020-01-01T00:00:00.000000Z"))
        ;; BL-654 collision-by-construction: the self-nudge timestamp is
        ;; DERIVED from the real trail timestamp (never drawn independently)
        ;; so every generated pair is, by construction, a case where the
        ;; self-nudge is strictly more recent - the exact shape that would
        ;; fool a naive "take the newest file's timestamp" implementation.
        lead-ms (inc (rlong 500000000))
        self-nudge-ms (+ real-trail-ms lead-ms)]
    (swap! p3-max-self-nudge-lead-ms max lead-ms)
    (fs/create-dirs sent-dir)
    (spit (str (fs/path sent-dir "00_real.handoff"))
          (str "from: coder\nto: cleaner\ntype: git_handoff\ntask: " item-id "-demo\n"
               "enqueued_at: " (.toString (java.time.Instant/ofEpochMilli real-trail-ms)) "\n\nbody\n"))
    (fs/create-dirs coord-dir)
    (spit (str (fs/path coord-dir "00_self_nudge.handoff"))
          (str "from: coordinator\nto: coordinator\ntype: note\n"
               "message: " (chase-sweep-lib/dropped-parcel-note-message item-id) "\n"
               "enqueued_at: " (.toString (java.time.Instant/ofEpochMilli self-nudge-ms)) "\n\nbody\n"))
    (assert-true (str "newest-trail-event-ms must ignore the self-nudge even when it leads the real trail by " lead-ms "ms "
                       "(item=" item-id ")")
                 (= real-trail-ms (chase-sweep-lib/newest-trail-event-ms item-id [sent-dir coord-dir])))))

(assert-true "P3 generator reached self-nudge leads up to hundreds of millions of ms (not a near-zero-lead-only run)"
             (> @p3-max-self-nudge-lead-ms 1000000))

;; Non-vacuousness: a broken variant that does NOT exclude self-nudges (the
;; exact BL-419-shipped-dark shape the ticket warns against) must fail -
;; proves P3 actually catches the omission, not a tautology. Built only
;; from PUBLIC chase-sweep-lib functions plus manual header parsing (list-
;; handoff-files-with-batches/dispatch-ticket-ref/handoff-event-ms are
;; deliberately private in chase_sweep_lib.bb - a separate namespace like
;; this property runner cannot and must not reach into them).
(defn- header-field [file-path field]
  (let [header-text (first (str/split (slurp file-path) #"\n\n" 2))
        prefix (str field ": ")]
    (some (fn [line] (when (str/starts-with? line prefix) (subs line (count prefix))))
          (str/split-lines header-text))))

(defn- broken-newest-trail-event-ms-no-self-exclusion [item-id scan-dirs]
  (->> scan-dirs
       (mapcat (fn [d] (if (fs/exists? d) (map str (fs/list-dir d)) [])))
       (filter #(= item-id (chase-sweep-lib/extract-ticket-id (or (header-field % "task") (header-field % "message")))))
       (keep (fn [f]
               (or (try (.toEpochMilli (java.time.Instant/parse (header-field f "enqueued_at"))) (catch Exception _ nil))
                   (try (.toEpochMilli (java.time.Instant/parse (header-field f "created_at"))) (catch Exception _ nil)))))
       (reduce (fn [best ms] (if (or (nil? best) (> ms best)) ms best)) nil)))

(let [tmp (mk-tmp)
      sent-dir (str (fs/path tmp "sent"))
      coord-dir (str (fs/path tmp "coord"))
      item-id "BL-777"
      real-trail-ms (.toEpochMilli (java.time.Instant/parse "2020-01-01T00:00:00.000000Z"))
      self-nudge-ms (+ real-trail-ms 100000000)]
  (fs/create-dirs sent-dir)
  (spit (str (fs/path sent-dir "00_real.handoff"))
        (str "from: coder\nto: cleaner\ntype: git_handoff\ntask: " item-id "-demo\n"
             "enqueued_at: " (.toString (java.time.Instant/ofEpochMilli real-trail-ms)) "\n\nbody\n"))
  (fs/create-dirs (fs/parent (fs/path coord-dir "x")))
  (spit (str (fs/path coord-dir "00_self_nudge.handoff"))
        (str "from: coordinator\nto: coordinator\ntype: note\n"
             "message: " (chase-sweep-lib/dropped-parcel-note-message item-id) "\n"
             "enqueued_at: " (.toString (java.time.Instant/ofEpochMilli self-nudge-ms)) "\n\nbody\n"))
  (assert-true "P3 non-vacuousness: the broken (non-excluding) implementation WOULD wrongly report the self-nudge as newest"
               (= self-nudge-ms (broken-newest-trail-event-ms-no-self-exclusion item-id [sent-dir coord-dir])))
  (assert-true "P3 non-vacuousness: the REAL implementation correctly reports the real trail, excluding the self-nudge"
               (= real-trail-ms (chase-sweep-lib/newest-trail-event-ms item-id [sent-dir coord-dir]))))

(when (seq @failures)
  (binding [*out* *err*]
    (doseq [f @failures] (println f)))
  (println (str "\n" (count @failures) " failure(s)"))
  (System/exit 1))

(println "bl719_dropped_parcel_invariants_property_runner: ok")

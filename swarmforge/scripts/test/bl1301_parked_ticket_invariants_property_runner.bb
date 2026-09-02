#!/usr/bin/env bb
;; BL-1301: PROPERTY tests over chase_sweep_lib.bb's park-aware
;; dropped-parcel decision, covering the three invariants the ticket YAML
;; declares (coder-authored first, per BL-654). Seeded (not wall-clock)
;; randomness so failures reproduce: a fixed-seed java.util.Random, never
;; rand/rand-int's unseeded global generator. Follows the established .bb
;; property-runner precedent (see bl719_dropped_parcel_invariants_property_
;; runner.bb) - the "*.property.test.js" / vitest.properties.config.mjs home
;; is a TypeScript convention with no Babashka equivalent (BL-472 tracks
;; pinning real property tooling for .bb scripts, deliberately deferred).
;;
;;   P1 suppression-is-opt-in-and-fails-closed - "Suppression is opt-in and
;;      fails closed: an active ticket with no status field, or any status
;;      other than blocked, is nudged exactly as it is today." Across
;;      randomly generated (newest-trail-ms, now-ms, stall-threshold-ms,
;;      status) tuples, decide-dropped-parcel? must equal the pre-BL-1301
;;      decision AND-ed with "not exactly blocked". The status generator
;;      draws its near-misses BY CONSTRUCTION from the marker itself
;;      (re-cased, padded with inner space, prefixed, suffixed, embedded) -
;;      the BL-654 collision shape, and exactly what a str/includes? or
;;      lower-case-normalising implementation would conflate - never
;;      independently drawn strings that would rarely collide.
;;
;;   P2 blast-radius-is-one-decision - "The suppression lives in the
;;      dropped-parcel decision only - read-active-items stays shared, and
;;      the candidate sets of the BL-222 dispatch-gap and unassigned-active
;;      sweeps are unchanged." Across randomly generated active-dir fixtures
;;      (random ticket counts, random statuses including blocked, random
;;      assignees including the nobody spellings), the dispatch-gap and
;;      unassigned-active candidate ID sets must be IDENTICAL to those for
;;      the same tree with every status: line stripped out - a park marker
;;      may not move one ticket between those two sweeps.
;;
;;   P3 a-suppression-is-never-invisible - "A suppressed ticket is never
;;      invisible: every suppression is logged with the ticket id and the
;;      reason." Across randomly generated mailbox+backlog fixtures, the
;;      status-blind candidate set must always partition EXACTLY into
;;      dropped-parcel-evaluation's :items and :suppressed - no ticket the
;;      park silences may vanish from both - and every :suppressed entry
;;      must carry an id the caller can name alongside the reason constant.

(ns bl1301-parked-ticket-invariants-property-runner
  (:require [babashka.fs :as fs]
            [clojure.set :as set]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def failures (atom []))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(def ^:private rng (java.util.Random. 1301))
(defn- rbool [] (.nextBoolean rng))
(defn- rint [bound] (.nextInt rng (int bound)))
(defn- pick [coll] (nth (vec coll) (rint (count coll))))

(def ^:private marker chase-sweep-lib/dropped-parcel-park-status)

;; Near-misses derived FROM the marker by the transformations an
;; over-permissive matcher would conflate (BL-654: constructed collisions,
;; not independently drawn strings).
(defn- near-miss-status []
  (let [m marker]
    (pick [(str/upper-case m)
           (str/capitalize m)
           (str m "-on-BL-1297")
           (str "not-" m)
           (str (subs m 0 (dec (count m))))
           (str/join " " [m "on" "BL-1297"])
           (str m "ed")])))

;; Real statuses the live corpus carries, plus the marker itself, plus a
;; constructed near-miss, plus the two absence shapes.
(defn- gen-status []
  (case (rint 5)
    0 marker
    1 (near-miss-status)
    2 (pick ["todo" "needs_design" "superseded" "paused" "in_progress"])
    3 nil
    4 (pick ["" "   "])))

;; ── P1: suppression is opt-in and fails closed ────────────────────────────

(let [nudged-non-blocked (atom 0)
      suppressed-blocked (atom 0)
      near-miss-nudged (atom 0)]
  (dotimes [_ 800]
    (let [stall (inc (rint 100000))
          now 1000000
          ;; Weighted to straddle the threshold in BOTH directions, so the
          ;; run reaches genuinely-dropped states rather than only fresh
          ;; ones (BL-654 generator reach, asserted below).
          newest (if (rbool) (- now stall (rint 50000)) (- now (rint stall)))
          status (gen-status)
          has-trail? (or (rbool) true)
          live? (and (rbool) (rbool) (rbool))
          facts {:has-trail? has-trail? :live-mail? live? :newest-trail-ms newest :status status}
          baseline (chase-sweep-lib/decide-dropped-parcel? (dissoc facts :status) now stall)
          actual (chase-sweep-lib/decide-dropped-parcel? facts now stall)
          parked? (= marker status)]
      (assert-true (str "P1: decision must be the pre-BL-1301 decision minus an exact park marker, facts=" (pr-str facts))
                   (= actual (and baseline (not parked?))))
      (when (and baseline (not parked?)) (swap! nudged-non-blocked inc))
      (when (and baseline parked?) (swap! suppressed-blocked inc))
      (when (and baseline (string? status) (not= marker status) (str/includes? (str/lower-case status) marker))
        (swap! near-miss-nudged inc))))
  ;; Generator reach, asserted rather than hoped for: the run must actually
  ;; visit a genuinely-dropped ticket of each shape, or P1 passes vacuously.
  (assert-true (str "P1 reach: dropped non-blocked tickets nudged (got " @nudged-non-blocked ")")
               (pos? @nudged-non-blocked))
  (assert-true (str "P1 reach: dropped blocked tickets suppressed (got " @suppressed-blocked ")")
               (pos? @suppressed-blocked))
  (assert-true (str "P1 reach: dropped tickets whose status CONTAINS the marker but is not it, still nudged (got "
                    @near-miss-nudged ")")
               (pos? @near-miss-nudged)))

;; ── P2: blast radius is one decision ──────────────────────────────────────

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                  (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

;; BL-971: a killed run traps nothing, so the prefix is also swept BEFORE
;; this run - the shutdown hook above only covers the paths that exit
;; normally.
(let [base (fs/path (System/getProperty "java.io.tmpdir"))]
  (doseq [d (fs/list-dir base "bl1301-property-*")]
    (try (fs/delete-tree d) (catch Exception _ nil))))

(defn- mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "bl1301-property-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn- write-ticket! [active-dir id assignee status]
  (fs/create-dirs active-dir)
  (spit (str (fs/path active-dir (str id ".yaml")))
        (str "id: " id "\ntitle: \"demo\"\n"
             (when status (str "status: " status "\n"))
             "assigned_to: " assignee "\n")))

(defn- strip-status-tree!
  "The same tree with every status: line removed - the pre-BL-1301 input."
  [active-dir]
  (let [out (str (fs/path (mk-tmp) "active"))]
    (fs/create-dirs out)
    (doseq [f (fs/list-dir active-dir)]
      (spit (str (fs/path out (fs/file-name f)))
            (->> (str/split-lines (slurp (str f)))
                 (remove #(str/starts-with? % "status: "))
                 (str/join "\n"))))
    out))

(let [blocked-seen (atom 0)]
  (dotimes [_ 60]
    (let [active-dir (str (fs/path (mk-tmp) "active"))
          n (inc (rint 6))]
      (fs/create-dirs active-dir)
      (dotimes [i n]
        (let [status (gen-status)]
          (when (= marker status) (swap! blocked-seen inc))
          (write-ticket! active-dir (str "BL-" (+ 900 i))
                         (pick ["coder" "cleaner" "QA" "none" "unassigned" ""])
                         status)))
      (let [blind (strip-status-tree! active-dir)
            ids (fn [f dir] (set (map :id (f dir))))]
        (assert-true "P2: the dispatch-gap candidate set is unchanged by the park marker"
                     (= (ids chase-sweep-lib/read-active-items active-dir)
                        (ids chase-sweep-lib/read-active-items blind)))
        (assert-true "P2: the unassigned-active candidate set is unchanged by the park marker"
                     (= (ids chase-sweep-lib/read-unassigned-active-items active-dir)
                        (ids chase-sweep-lib/read-unassigned-active-items blind)))
        (assert-true "P2: dispatch-gap-items over the same tree is unchanged by the park marker"
                     (= (set (map :id (chase-sweep-lib/dispatch-gap-items active-dir [])))
                        (set (map :id (chase-sweep-lib/dispatch-gap-items blind []))))))))
  (assert-true (str "P2 reach: the generated trees actually contain blocked tickets (got " @blocked-seen ")")
               (pos? @blocked-seen)))

;; ── P3: a suppression is never invisible ──────────────────────────────────

(defn- write-handoff! [dir filename headers]
  (fs/create-dirs dir)
  (spit (str (fs/path dir filename))
        (str (str/join "\n" (map (fn [[k v]] (str (name k) ": " v)) headers)) "\n\nbody\n")))

(def ^:private now-ms (.toEpochMilli (java.time.Instant/parse "2026-08-14T00:00:00.000000Z")))
(def ^:private stall-ms 60000)

(let [suppressed-total (atom 0)
      nudged-total (atom 0)]
  (dotimes [_ 60]
    (let [tmp (mk-tmp)
          active-dir (str (fs/path tmp "active"))
          sent-dir (str (fs/path tmp "sent"))
          live-dir (str (fs/path tmp "coder-new"))
          n (inc (rint 5))]
      (fs/create-dirs active-dir)
      (fs/create-dirs live-dir)
      (dotimes [i n]
        (let [id (str "BL-" (+ 800 i))
              status (gen-status)]
          (write-ticket! active-dir id "coder" status)
          (when (rbool)
            (write-handoff! sent-dir (str "t-" i ".handoff")
                            {:from "documenter" :to "QA" :type "git_handoff" :task (str id "-demo")
                             :enqueued_at (if (rbool) "2020-01-01T00:00:00.000000Z" "2026-08-13T23:59:50.000000Z")}))
          (when (and (rbool) (rbool))
            (write-handoff! live-dir (str "l-" i ".handoff")
                            {:from "documenter" :to "coder" :type "git_handoff" :task (str id "-demo")}))))
      (let [ev (chase-sweep-lib/dropped-parcel-evaluation active-dir [sent-dir live-dir] [live-dir] now-ms stall-ms)
            blind-dir (strip-status-tree! active-dir)
            blind (set (map :id (chase-sweep-lib/dropped-parcel-items blind-dir [sent-dir live-dir] [live-dir] now-ms stall-ms)))
            items (set (map :id (:items ev)))
            suppressed (set (map :id (:suppressed ev)))]
        (swap! nudged-total + (count items))
        (swap! suppressed-total + (count suppressed))
        (assert-true (str "P3: nudged and suppressed must partition the status-blind candidate set exactly, tree=" active-dir)
                     (and (= blind (into items suppressed))
                          (empty? (set/intersection items suppressed))))
        (assert-true "P3: every suppressed entry carries a ticket id to log"
                     (every? #(and (string? (:id %)) (seq (:id %))) (:suppressed ev)))
        (assert-true "P3: every suppressed entry is genuinely parked"
                     (every? #(chase-sweep-lib/parked-ticket? (:status %)) (:suppressed ev))))))
  (assert-true (str "P3 reach: the run produced real suppressions (got " @suppressed-total ")")
               (pos? @suppressed-total))
  (assert-true (str "P3 reach: the run produced real nudges too (got " @nudged-total ")")
               (pos? @nudged-total)))

(assert-true "P3: the logged reason names the marker, so a log line says WHY"
             (str/includes? chase-sweep-lib/dropped-parcel-park-suppression-reason marker))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: BL-1301 parked-ticket invariants (P1 opt-in/fail-closed, P2 blast radius, P3 never invisible)"))

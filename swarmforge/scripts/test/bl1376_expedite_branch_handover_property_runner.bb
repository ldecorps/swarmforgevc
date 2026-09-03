#!/usr/bin/env bb
;; BL-1376: PROPERTY tests over the two invariants the ticket YAML declares
;; (coder-authored first, per BL-654).
;;
;;   P1 silent-only-on-a-definite-nothing - across every branch fact a run can
;;      produce, the handover omits the branch ONLY when the answer is a
;;      definite zero, the branch does not exist, or the run was a dry run.
;;      Every unreadable answer reports the branch, with a reason and without
;;      an invented distance.
;;   P2 naming-is-not-landing - no handover text a run can produce ever claims
;;      a land happened, and every reported leaving carries an owner. The
;;      shape of the branch item matches the two items already there.
;;
;; Toolchain: the .bb property-runner precedent (expedite_lib_property_runner.bb,
;; ambulance_lib_property_runner.bb); BL-472 defers real property tooling for
;; Babashka, and the BL-654 contract's *.property.test.js home is the
;; TypeScript lane.
;;
;; GENERATOR REACH is asserted, not hoped for. The states this quantifies over
;; are the ones a real run produces - ahead/level/absent/unreadable, crossed
;; with parked and moved - and the run fails outright unless each was actually
;; generated. A property that never generated "level" would pass forever while
;; the silent half was broken.

(ns bl1376-expedite-branch-handover-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "expedite_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))
(def reached (atom #{}))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

;; ── seeded generator (the LCG shape the other .bb property runners use) ──

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[v s'] (gen-int s 2)] [(= 1 v) s']))
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def branch-shapes [:ahead :level :absent :unreadable :none])

(defn- gen-branch
  "The branch facts a run can actually hand the handover: ahead by some
   amount, level, not created at all, an ancestry read that could not answer,
   and (the pre-BL-1376 shape) no branch fact whatsoever."
  [s ticket]
  (let [[shape s1] (gen-pick s branch-shapes)
        name (expedite-lib/run-branch-name ticket)]
    (case shape
      :ahead (let [[n s2] (gen-int s1 40)] [{:name name :ahead (inc n)} shape s2])
      :level [{:name name :ahead 0} shape s1]
      :absent [{:name name :absent? true} shape s1]
      :unreadable (let [[n s2] (gen-int s1 3)]
                    [{:name name :reason (nth ["origin/main could not be resolved"
                                               "git rev-list origin/main.. could not answer"
                                               ""] n)}
                     shape s2])
      :none [nil shape s1])))

(defn- branch-item [items]
  (first (filter #(= "the run branch" (:subject %)) items)))

(loop [i 0 s 913761]
  (when (< i runs)
    (let [[n1 s1] (gen-int s 4)
          ticket (str "BL-" (+ 1000 n1))
          [branch shape s2] (gen-branch s1 ticket)
          [parked-n s3] (gen-int s2 4)
          parked (vec (map #(str "BL-" (+ 500 %)) (range parked-n)))
          [moved? s4] (gen-bool s3)
          [dry? s5] (gen-bool s4)
          facts {:ticket ticket :parked parked :ticket-moved? moved?
                 :dry-run? dry? :branch branch}
          items (expedite-lib/outstanding-work facts)
          item (branch-item items)
          text (expedite-lib/format-outstanding-summary {:items items :parked parked})]
      (swap! reached conj [shape dry?])

      ;; ── P1 ────────────────────────────────────────────────────────────
      (let [should-report? (and (not dry?)
                                (some? branch)
                                (not (:absent? branch))
                                (not (= 0 (:ahead branch))))]
        (when (and should-report? (nil? item))
          (report! "P1" s facts "the branch had something to land and was omitted"))
        (when (and (not should-report?) (some? item))
          (report! "P1" s facts "the branch was reported when there was genuinely nothing to land"))
        (when item
          ;; An unreadable read never invents a distance, and never stays mute
          ;; about why - a check that cannot answer must not read as a clean one.
          (when (and (nil? (:ahead item)) (not (seq (str (:reason item)))))
            (report! "P1" s facts "an unreadable read gave neither a distance nor a reason"))
          (when (and (nil? (:ahead item)) (str/includes? text "commits ahead of origin/main"))
            (report! "P1" s facts (str "a distance was rendered for a read that had none:\n" text)))
          (when (and (:ahead item) (not= (:ahead item) (:ahead branch)))
            (report! "P1" s facts "the reported distance is not the one measured"))))

      ;; ── P2 ────────────────────────────────────────────────────────────
      (when (re-find #"(?i)\b(landed|merged|pushed|published)\b" text)
        (report! "P2" s facts (str "the handover claims an action it did not take:\n" text)))
      (doseq [{:keys [subject owner]} items]
        (when-not (seq (str owner))
          (report! "P2" s facts (str "the leaving " (pr-str subject) " has no owner"))))
      (when item
        (when-not (str/includes? text (:branch item))
          (report! "P2" s facts (str "the branch item never reached the rendered text:\n" text)))
        (when-not (str/includes? (:owner item) "QA")
          (report! "P2" s facts "the branch's owner is not the integration point the constitution names")))
      ;; The two pre-existing leavings are untouched by this ticket, whatever
      ;; the branch does.
      (when (and (not dry?) (seq parked)
                 (nil? (first (filter #(= "the parked tickets" (:subject %)) items))))
        (report! "P2" s facts "the parked-tickets leaving was lost"))

      (recur (inc i) s5))))

;; The reachability floor.
(doseq [shape branch-shapes]
  (when-not (some #(= shape (first %)) @reached)
    (swap! failures conj (str "FAIL generator reach: branch shape " shape
                              " was never generated in " runs " runs."))))
(doseq [dry? [true false]]
  (when-not (some #(= dry? (second %)) @reached)
    (swap! failures conj (str "FAIL generator reach: dry-run? " dry? " was never generated."))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println (str (count @failures) " PROPERTY FAILURE(S)"))
      (System/exit 1))
  (println (str "bl1376 expedite branch handover: ALL PROPERTIES HOLD (" runs " runs)")))

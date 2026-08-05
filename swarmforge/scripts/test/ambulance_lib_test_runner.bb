#!/usr/bin/env bb
;; TDD runner for ambulance_lib.bb (BL-655) - pure assertions over
;; already-parsed envelopes/marker values, plus fixture-based tests for the
;; impure read-ambulance-state/engage!/release! (real fs I/O against a temp
;; dir, no live swarm). Modeled on backlog_depth_test_runner.bb's own split.
(ns ambulance-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "ambulance_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp []
  (let [d (str (fs/create-temp-dir {:prefix "ambulance-lib-test-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-ticket! [root subdir ticket-id]
  (fs/create-dirs (fs/path root "backlog" subdir))
  (spit (str (fs/path root "backlog" subdir (str ticket-id "-demo.yaml")))
        (str "id: " ticket-id "\ntitle: \"demo\"\nstatus: " subdir "\n")))

(defn write-marker-raw! [root content]
  (fs/create-dirs (fs/parent (ambulance-lib/marker-path root)))
  (spit (str (ambulance-lib/marker-path root)) content))

;; ── marker-path ──────────────────────────────────────────────────────────

(assert= "marker-path matches the ticket's own spec shape"
         (str (fs/path "/proj" ".swarmforge" "operator" "control-ambulance.json"))
         (str (ambulance-lib/marker-path "/proj")))

;; ── attributed-tickets (pure) ────────────────────────────────────────────

(assert= "task header alone attributes to that ticket"
         #{"BL-654"}
         (ambulance-lib/attributed-tickets {:headers {"task" "BL-654"} :body ""}))

(assert= "message header alone attributes to that ticket"
         #{"BL-660"}
         (ambulance-lib/attributed-tickets {:headers {"message" "bounce for BL-660"} :body ""}))

(assert= "body text alone attributes to every mentioned ticket"
         #{"BL-654" "BL-660"}
         (ambulance-lib/attributed-tickets {:headers {} :body "cites BL-654 and BL-660"}))

(assert= "no ticket id anywhere attributes to nothing (empty set)"
         #{}
         (ambulance-lib/attributed-tickets {:headers {"task" ""} :body "no ticket id here"}))

(assert= "nil headers/body never throws - attributes to nothing"
         #{}
         (ambulance-lib/attributed-tickets {:headers {} :body nil}))

;; ── parcel-held? (pure) ──────────────────────────────────────────────────

(assert= "ambulance-hold-08 shape: an inactive ambulance never holds anything"
         false
         (ambulance-lib/parcel-held? {:active false} {:headers {"task" "BL-660"} :body ""}))

(assert= "ambulance-hold-03: a parcel attributed only to the ambulance ticket is not held"
         false
         (ambulance-lib/parcel-held? {:active true :ticket "BL-654"} {:headers {"task" "BL-654"} :body ""}))

(assert= "ambulance-hold-03: a parcel attributed only to a DIFFERENT ticket is held"
         true
         (ambulance-lib/parcel-held? {:active true :ticket "BL-654"} {:headers {"task" "BL-660"} :body ""}))

(assert= "ambulance-hold-03: a parcel mentioning no ticket id fails OPEN - it moves"
         false
         (ambulance-lib/parcel-held? {:active true :ticket "BL-654"} {:headers {} :body "no ticket id"}))

(assert= "ambulance-hold-03: a parcel mentioning BOTH tickets moves - positive attribution to the ambulance ticket is present"
         false
         (ambulance-lib/parcel-held? {:active true :ticket "BL-654"} {:headers {} :body "both BL-654 and BL-660"}))

;; ── ticket-has-file? (fixture-based fs I/O) ────────────────────────────────

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-654")
  (assert= "ticket-has-file?: finds a ticket filed under backlog/active/"
           true
           (ambulance-lib/ticket-has-file? root "BL-654")))

(let [root (mk-tmp)]
  (write-ticket! root "hold" "BL-654")
  (assert= "ticket-has-file?: finds a ticket filed under backlog/hold/ too (anywhere under backlog/, not just active/paused/done)"
           true
           (ambulance-lib/ticket-has-file? root "BL-654")))

(let [root (mk-tmp)]
  (fs/create-dirs (fs/path root "backlog" "done" "M8-milestone"))
  (spit (str (fs/path root "backlog" "done" "M8-milestone" "BL-654-demo.yaml")) "id: BL-654\n")
  (assert= "ticket-has-file?: finds a ticket nested one level under a done/ milestone subdir"
           true
           (ambulance-lib/ticket-has-file? root "BL-654")))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-999")
  (assert= "ticket-has-file?: a ticket with no file anywhere under backlog/ is false"
           false
           (ambulance-lib/ticket-has-file? root "BL-654")))

(let [root (mk-tmp)]
  (assert= "ticket-has-file?: no backlog/ dir at all degrades to false, not a crash"
           false
           (ambulance-lib/ticket-has-file? root "BL-654")))

;; BL-813: fs/glob lists a path, then the file is moved/deleted before this
;; code slurps it - the exact race that crashed handoffd on BL-812 (promoted
;; active/ -> done/ mid-poll). with-redefs calls the REAL glob first (real
;; matches), deletes the matched file, THEN returns the now-stale match list -
;; reproducing "glob saw it, slurp won't" deterministically, no real race.
(let [root (mk-tmp)
      real-glob fs/glob]
  (write-ticket! root "active" "BL-812")
  (with-redefs [fs/glob (fn [dir pattern]
                          (let [matches (real-glob dir pattern)]
                            (doseq [p matches] (fs/delete-if-exists p))
                            matches))]
    (assert= "BL-813: ticket-has-file? does not throw when a globbed yaml vanishes mid-read; degrades to false"
             false
             (ambulance-lib/ticket-has-file? root "BL-812"))))

;; BL-813: same race, but a DIFFERENT non-vanishing file for the same ticket
;; still gets found - the fix skips only the vanished glob entry, not the
;; whole search.
(let [root (mk-tmp)
      real-glob fs/glob]
  (write-ticket! root "active" "BL-812")
  (write-ticket! root "hold" "BL-812")
  (with-redefs [fs/glob (fn [dir pattern]
                          (let [matches (real-glob dir pattern)]
                            (doseq [p matches :when (str/includes? (str p) "/active/")]
                              (fs/delete-if-exists p))
                            matches))]
    (assert= "BL-813: a vanished glob entry is skipped, but a surviving copy of the same ticket elsewhere is still found"
             true
             (ambulance-lib/ticket-has-file? root "BL-812"))))

;; ── read-ambulance-state / describe-status (fixture-based fs I/O) ─────────
;; ambulance-hold-08: every one of these degrades to mode OFF.

(let [root (mk-tmp)]
  (assert= "ambulance-hold-08: an absent marker reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root "")
  (assert= "ambulance-hold-08: an empty marker file reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root "not json{{{")
  (assert= "ambulance-hold-08: unparseable JSON reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root (json/generate-string {:active true}))
  (assert= "ambulance-hold-08: JSON carrying no ticket id reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root (json/generate-string {:active true :ticket "not-a-ticket-id"}))
  (assert= "ambulance-hold-08: JSON naming a syntactically invalid ticket id reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root (json/generate-string {:active true :ticket "BL-654"}))
  (assert= "ambulance-hold-08: naming a ticket with no file anywhere under backlog/ reads as inactive - the deadlock guard"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root (json/generate-string {:active false}))
  (assert= "an explicit active:false marker reads as inactive"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-654")
  (write-marker-raw! root (json/generate-string {:active true :ticket "BL-654" :engagedAtMs 123 :by "cli"}))
  (assert= "a well-formed marker naming a REAL ticket reads as active"
           {:active true :ticket "BL-654"}
           (ambulance-lib/read-ambulance-state root))
  (assert= "describe-status keeps the raw engagedAtMs/by fields for humans"
           {:active true :ticket "BL-654" :engagedAtMs 123 :by "cli"}
           (ambulance-lib/describe-status root)))

;; ── engage!/release! (fixture-based fs I/O, ambulance-hold-09 idempotency) ──

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-654")
  (let [first-write (ambulance-lib/engage! root "BL-654" "cli")]
    (assert= "engage! activates the named ticket"
             {:active true :ticket "BL-654"}
             (ambulance-lib/read-ambulance-state root))
    (let [second-write (ambulance-lib/engage! root "BL-654" "cli")]
      (assert= "ambulance-hold-09: a repeated engage of the SAME ticket is a true no-op - engagedAtMs is not bumped"
               first-write
               second-write))))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-654")
  (write-ticket! root "active" "BL-660")
  (ambulance-lib/engage! root "BL-654" "cli")
  (Thread/sleep 5)
  (ambulance-lib/engage! root "BL-660" "cli")
  (assert= "engaging a DIFFERENT ticket replaces the marker outright"
           {:active true :ticket "BL-660"}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (assert= "ambulance-hold-09: releasing with no mode set is a true no-op - no marker file is created"
           false
           (fs/exists? (ambulance-lib/marker-path root)))
  (ambulance-lib/release! root)
  (assert= "release! with an already-absent marker leaves it absent"
           false
           (fs/exists? (ambulance-lib/marker-path root))))

(let [root (mk-tmp)]
  (write-ticket! root "active" "BL-654")
  (ambulance-lib/engage! root "BL-654" "cli")
  (ambulance-lib/release! root)
  (assert= "release! clears an active marker"
           {:active false}
           (ambulance-lib/read-ambulance-state root)))

(let [root (mk-tmp)]
  (write-marker-raw! root (json/generate-string {:active false}))
  (let [before (slurp (str (ambulance-lib/marker-path root)))]
    (ambulance-lib/release! root)
    (assert= "ambulance-hold-09: releasing an already-inactive marker leaves the file byte-identical"
             before
             (slurp (str (ambulance-lib/marker-path root))))))

;; ── report ────────────────────────────────────────────────────────────────
(if (seq @failures)
  (do
    (doseq [f @failures] (binding [*out* *err*] (println f)))
    (println (str "\n" (count @failures) " failure(s)"))
    (System/exit 1))
  (println "ALL PASS: ambulance_lib.bb"))

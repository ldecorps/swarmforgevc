#!/usr/bin/env bb
;; BL-1494 declared invariants, coder-first (BL-654):
;;
;;   Invariant 1 (no injection on any path, for as long as the note sits
;;     unread; read only on the recipient's own next ready_for_next):
;;     PROPERTY A below. The (type, wake-field) -> deferred? decision is
;;     made in exactly ONE place (handoff-lib/deferred-note?) that every
;;     wake-suppressing call site (handoffd.bb's maybe-notify!,
;;     chase_sweep_lib.bb's item-deferred-note-held?, and
;;     swarm_handoff.bb's skip-sync-inject?) delegates to - proving that
;;     predicate exact over its domain, PLUS proving the REAL CLI honours
;;     it at send time (skip-sync-inject?), is the load-bearing property:
;;     the delivery-hop and chase-sweep halves are each covered by their
;;     own real-process e2e (test_bl1494_deferred_note_no_wake.sh scenario
;;     01, test_chase_sweep.sh scenario 17 - acceptance scenarios 01/03),
;;     which both call this SAME predicate, so a break here fails there too.
;;
;;   Invariant 2 (deferral changes only the wake - delivered, filed,
;;     audited, deduplicated, dequeued exactly as an undeferred note of the
;;     same type): PROPERTY B below. Drives the REAL swarm_handoff.bb
;;     validate() over a base draft, twice - once bare and once with a
;;     drawn wake header added - and asserts the two error sets differ by
;;     AT MOST the one wake-refusal line, which is present iff NOT(type =
;;     note AND wake = defer). Holds regardless of what else is wrong with
;;     the base draft, since anything else is identical between the two
;;     runs by construction.
;;
;; Reach floors (absolute): PROPERTY A pure sweep - exact-match positive
;;   >= 20, near-miss (right type wrong value, wrong type right value,
;;   both wrong) >= 20 each, fully random >= 20; PROPERTY A CLI acceptance
;;   (varied recipient/priority/message, always note+defer) >= 15; PROPERTY
;;   B - exact >= 8, wrong-type >= 8, wrong-value >= 8, both-wrong >= 8,
;;   unknown-type >= 5.
;;
;; Non-vacuity: PROPERTY A's pure half is self-proving every run (with-redefs
;;   two deliberately broken deferred-note? implementations below; the
;;   property harness must catch both). PROPERTY A's CLI half and PROPERTY B
;;   were proven red-then-green BY HAND (swarm_handoff.bb's BL-1494 diff
;;   `git stash`'d, both re-run, restored) - recorded in the parcel commit,
;;   not re-run here: mutating the real script mid-run is the wrong shape
;;   for a repeatable process-spawning check (BL-992's own runner makes the
;;   same call for the CLI it drives).

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def swarm-handoff (str (fs/path scripts-dir "swarm_handoff.bb")))

(load-file (str (fs/path scripts-dir "handoff_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 120))
;; Pure, in-process draws are cheap - a larger, independent count so the
;; four-way shape split reliably clears its floor without depending on the
;; (subprocess-bounded) `runs` default above.
(def pure-runs 240)
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj msg))

;; ═══════════════════════════════════════════════════════════════════════
;; PROPERTY A (invariant 1) - part 1: the pure predicate, exact over its
;; domain. Both TRUE and FALSE are constructed by design (BL-654: derive
;; one side from the other, never draw independently and hope), plus fully
;; random noise so the property is not merely checking the constructions
;; back at themselves.
;; ═══════════════════════════════════════════════════════════════════════

(def coverage-a-pure (atom {:exact 0 :wrong-value 0 :wrong-type 0 :random 0}))

(def types ["note" "git_handoff" "rule_proposal" "awake" "bogus_type" "" nil])
;; No blank string here: an empty header VALUE is refused by parse-draft's
;; own generic "field and value must both be non-empty" rule before it ever
;; reaches the wake-specific check this ticket adds - a real but DIFFERENT
;; invariant, out of this ticket's scope, and drawing it here would assert
;; the wrong refusal reason.
(def near-miss-wakes ["Defer" "DEFER" "deferred" "yes" "no" "bogus_wake"])

;; Reach floors are ASSERTED, never hoped for (BL-654): `stratified-shapes`
;; guarantees at least `floor` of each shape by construction (a plain
;; `rand-nth*` over categories drifted a shape below its floor at random on
;; a live run - flaky by design, not a real gap), then tops up to `total`
;; with additional random shapes for extra noise, then shuffles so shape
;; order itself carries no signal.
(defn stratified-shapes [shapes floor total]
  (let [guaranteed (mapcat #(repeat floor %) shapes)
        extra (repeatedly (max 0 (- total (count guaranteed))) #(rand-nth* shapes))]
    (shuffle (concat guaranteed extra))))

(doseq [[i shape] (map-indexed vector
                    (stratified-shapes [:exact :wrong-value :wrong-type :random] 20 pure-runs))]
  (let [[type wake] (case shape
                      ;; Constructed TRUE: the one shape the predicate must
                      ;; accept - derived from the exact strings it checks,
                      ;; not drawn independently.
                      :exact ["note" "defer"]
                      ;; Constructed FALSE, right type wrong value: a note
                      ;; whose wake is anything but the literal "defer".
                      :wrong-value ["note" (rand-nth* near-miss-wakes)]
                      ;; Constructed FALSE, wrong type right value: "defer"
                      ;; on every OTHER type, including invalid ones.
                      :wrong-type [(rand-nth* (remove #{"note"} types)) "defer"]
                      ;; Fully random noise over both axes - independent
                      ;; draws, may coincidentally land on :exact.
                      :random [(rand-nth* types) (rand-nth* (conj near-miss-wakes "defer" nil))])
        expected (and (= type "note") (= wake "defer"))
        actual (handoff-lib/deferred-note? {:parcel-type type :wake-field wake})]
    (swap! coverage-a-pure update shape inc)
    (when-not (= expected actual)
      (fail! (str "PROPERTY A pure draw " i " (" shape "): type=" (pr-str type) " wake=" (pr-str wake)
                  " expected " expected " got " actual)))))

(doseq [[k floor] {:exact 20 :wrong-value 20 :wrong-type 20 :random 20}]
  (when (< (get @coverage-a-pure k) floor)
    (fail! (str "PROPERTY A pure generator coverage: " (name k) " reached only "
                (get @coverage-a-pure k) " of " pure-runs " (floor " floor ")"))))

;; Non-vacuity, embedded and self-proving every run: two deliberately wrong
;; implementations must both fail this exact property.
(let [broken-or (fn [{:keys [parcel-type wake-field]}]
                  (boolean (or (= "note" parcel-type) (= "defer" wake-field))))
      broken-always-true (fn [_] true)
      broken-drops-value-check (fn [{:keys [parcel-type]}] (boolean (= "note" parcel-type)))]
  (doseq [[label broken] [["or-instead-of-and" broken-or]
                          ["always-true" broken-always-true]
                          ["drops-value-check" broken-drops-value-check]]]
    (with-redefs [handoff-lib/deferred-note? broken]
      (let [broke? (atom false)]
        (dotimes [_ 30]
          (let [type (rand-nth* types) wake (rand-nth* (conj near-miss-wakes "defer" nil))
                expected (and (= type "note") (= wake "defer"))
                actual (handoff-lib/deferred-note? {:parcel-type type :wake-field wake})]
            (when-not (= expected actual) (reset! broke? true))))
        (when-not @broke?
          (fail! (str "PROPERTY A non-vacuity: broken implementation \"" label
                      "\" was not caught by 30 draws - the property is vacuous")))))))

(println (str "  PROPERTY A pure generator coverage: " (pr-str @coverage-a-pure)))

;; ═══════════════════════════════════════════════════════════════════════
;; PROPERTY A (invariant 1) - part 2: the REAL swarm_handoff.bb CLI honours
;; wake: defer at SEND time (skip-sync-inject?) - varied recipient,
;; priority and message content, always type=note wake=defer, always a
;; clean accept with the mailbox-only marker (no tmux touched, no
;; SWARMFORGE_SKIP_* env set).
;; ═══════════════════════════════════════════════════════════════════════

(def work (str (fs/create-temp-dir {:prefix "bl1494-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook (Thread. #(when (fs/exists? work) (fs/delete-tree work)))))

(defn sh [opts & args] (apply process/sh (merge {:continue true} opts) args))
(defn git! [dir & args] (apply sh {:dir dir} "git" "-c" "user.email=t@t" "-c" "user.name=t" args))

(def root (str (fs/path work "root")))
(fs/create-dirs (fs/path root ".swarmforge"))
(git! root "init" "-q" ".")
(spit (str (fs/path root "f.txt")) "x")
(git! root "add" "-A")
(git! root "commit" "-q" "-m" "seed")

(def recipients ["cleaner" "hardender" "documenter"])
(spit (str (fs/path root ".swarmforge" "roles.tsv"))
      (str "coordinator\tmaster\t" root "\tswarmforge-coordinator\tCoordinator\tclaude\ttask\n"
           (str/join "\n" (for [r recipients]
                            (str r "\t" r "\t" root "\tswarmforge-" r "\t" r "\tclaude\ttask")))
           "\n"))

(def coverage-a-cli (atom 0))

(dotimes [i runs]
  (when (< i 20) ;; A CLI subprocess per draw is slow - a slice of `runs`,
                 ;; still comfortably clears the floor below.
    (let [to (rand-nth* recipients)
          priority (format "%02d" (rand-int* 100))
          message (str "probe-" i "-" (rand-int* 100000))
          draft (str (fs/path root (str "draft-" i ".txt")))]
      (spit draft (str "type: note\nto: " to "\npriority: " priority "\nmessage: " message "\nwake: defer\n"))
      (let [res (sh {:dir root :out :string :err :string
                     :extra-env {"SWARMFORGE_ROLE" "coordinator"}}
                    "bb" swarm-handoff draft)
            out (str (:out res) (:err res))]
        (swap! coverage-a-cli inc)
        (when-not (zero? (:exit res))
          (fail! (str "PROPERTY A CLI draw " i ": expected exit 0 for note+defer to " to ", got "
                      (:exit res) "\n" out)))
        (when-not (str/includes? out "HANDOFF QUEUED (mailbox only, no tmux inject)")
          (fail! (str "PROPERTY A CLI draw " i ": expected the mailbox-only marker (no tmux touched) for "
                      "note+defer, got:\n" out)))))))

(when (< @coverage-a-cli 15)
  (fail! (str "PROPERTY A CLI generator coverage: reached only " @coverage-a-cli " of a floor of 15")))

;; ═══════════════════════════════════════════════════════════════════════
;; PROPERTY B (invariant 2) - deferral changes only the wake: for a base
;; draft, adding a drawn wake header changes validate()'s error set by AT
;; MOST the one wake-refusal line, present iff NOT(type=note AND
;; wake=defer). Holds regardless of what else is wrong with the base
;; draft - everything else is identical between the two runs by
;; construction, so this needs no perfectly-valid fixture for the negative
;; shapes.
;; ═══════════════════════════════════════════════════════════════════════

(def wake-refusal-re #"Header 'wake' is refused as an unknown header")

(defn errors-of [out]
  (->> (str/split-lines out)
       (drop-while #(not= % "Errors:"))
       (drop 1)
       (take-while #(str/starts-with? % "-"))
       set))

(defn validate-cli! [i type wake]
  (let [draft (str (fs/path root (str "b-draft-" i ".txt")))
        base-lines (if (= type "note")
                     ;; The one fully-valid base: a real note. Its
                     ;; (type, wake=defer) run must be a clean accept, so
                     ;; nothing else about it may be wrong.
                     [(str "type: note") (str "to: " (rand-nth* recipients))
                      "priority: 10" (str "message: probe-" i)]
                     ;; Every other base is deliberately imperfect (missing
                     ;; priority) so validation ALWAYS errors before ever
                     ;; reaching delivery/audit machinery - the property
                     ;; only needs the two error SETS, never a real send.
                     [(str "type: " type) "to: cleaner"])
        run! (fn [extra-lines]
               (spit draft (str (str/join "\n" (concat base-lines extra-lines)) "\n"))
               (let [res (sh {:dir root :out :string :err :string
                              :extra-env {"SWARMFORGE_ROLE" "coordinator" "SWARMFORGE_SKIP_DAEMON" "1"}}
                             "bb" swarm-handoff draft)]
                 (str (:out res) (:err res))))
        without (errors-of (run! []))
        with (errors-of (run! [(str "wake: " wake)]))
        added (clojure.set/difference with without)
        removed (clojure.set/difference without with)
        expect-refusal? (not (and (= type "note") (= wake "defer")))]
    {:added added :removed removed :expect-refusal? expect-refusal?}))

(def coverage-b (atom {:exact 0 :wrong-value 0 :wrong-type 0 :both-wrong 0 :unknown-type 0}))
(def wrong-types ["git_handoff" "rule_proposal" "awake"])
(def unknown-types ["bogus_type" "sortof_note" ""])

;; Per-shape floors (BL-654: asserted, not hoped-for - see stratified-shapes
;; above), same guarantee-then-top-up-then-shuffle shape, sized per category
;; rather than one uniform floor.
(defn stratified-shapes-weighted [shape->floor total]
  (let [guaranteed (mapcat (fn [[shape floor]] (repeat floor shape)) shape->floor)
        shapes (vec (keys shape->floor))
        extra (repeatedly (max 0 (- total (count guaranteed))) #(rand-nth* shapes))]
    (shuffle (concat guaranteed extra))))

(doseq [[i shape] (map-indexed vector
                    (stratified-shapes-weighted
                     {:exact 8 :wrong-value 8 :wrong-type 8 :both-wrong 8 :unknown-type 5}
                     (min runs 60)))]
  (let [[type wake] (case shape
                      :exact ["note" "defer"]
                      :wrong-value ["note" (rand-nth* near-miss-wakes)]
                      :wrong-type [(rand-nth* wrong-types) "defer"]
                      :both-wrong [(rand-nth* wrong-types) (rand-nth* near-miss-wakes)]
                      :unknown-type [(rand-nth* unknown-types) "defer"])]
    (swap! coverage-b update shape inc)
    (let [{:keys [added removed expect-refusal?]} (validate-cli! i type wake)]
      ;; "changes only the wake": nothing the base draft already got right
      ;; or wrong may flip because a wake header was added or removed.
      (when (seq removed)
        (fail! (str "PROPERTY B draw " i " (" shape ", type=" type " wake=" wake
                    "): adding wake removed pre-existing errors: " removed)))
      (let [others (vec (remove #(re-find wake-refusal-re %) added))]
        (when (seq others)
          (fail! (str "PROPERTY B draw " i " (" shape "): adding wake introduced UNRELATED errors: " others))))
      (let [has-refusal? (boolean (some #(re-find wake-refusal-re %) added))]
        (when-not (= has-refusal? expect-refusal?)
          (fail! (str "PROPERTY B draw " i " (" shape ", type=" type " wake=" wake
                      "): expected wake-refusal=" expect-refusal? " got " has-refusal?
                      " (added=" added ")")))))))

(doseq [[k floor] {:exact 8 :wrong-value 8 :wrong-type 8 :both-wrong 8 :unknown-type 5}]
  (when (< (get @coverage-b k) floor)
    (fail! (str "PROPERTY B generator coverage: " (name k) " reached only "
                (get @coverage-b k) " of a floor of " floor))))

(println (str "  PROPERTY A CLI draws: " @coverage-a-cli))
(println (str "  PROPERTY B generator coverage: " (pr-str @coverage-b)))

(if (empty? @failures)
  (do (println (str "bl1494 deferred-note-no-wake properties: " runs " target draws"))
      (println "ALL PROPERTIES HOLD"))
  (do (doseq [f @failures] (println f))
      (System/exit 1)))

#!/usr/bin/env bb
;; BL-991 property test (coder-authored, THREE declared invariants) over
;; swarm_handoff.bb's route-required-stages.
;;
;;   Invariant 1: a declared stage is never jumped. For any forward
;;   git_handoff on a ticket with a usable declaration, the delivered
;;   recipient is never later in canonical order than the first declared
;;   stage after the sender.
;;   Invariant 2: a stage a binding rewrite defers is never recorded as
;;   skipped - neither the envelope header nor the routing-skips line may
;;   name it.
;;   Invariant 3: enforcement reaches exactly as far as routing already
;;   reaches, and no further. A backward bounce, a rejection_reason /
;;   reroute_reason detour, a disabled kill switch, and an unusable
;;   declaration each deliver the same recipients as they do today.
;;
;; WHY PROPERTIES AND NOT MORE FIXTURES. Invariant 1 quantifies over every
;; (declaration, sender, recipient) triple, and the feature file pins six of
;; them. The pairing that matters is the one nobody wrote down - and the
;; ticket's own description names one the acceptance rows nearly missed: with
;; [coder, cleaner, qa] a coder addressing architect used to be rewritten
;; FORWARD to QA, jumping the declared cleaner, because the non-member branch
;; never consulted the sender at all.
;;
;; Every case shells the REAL swarm_handoff.bb against a real fixture root -
;; the same genuinely-wired path BL-951's own runner uses, for the same reason
;; it gives: the script calls -main at load, so it cannot be required as a
;; library, and a reimplementation would only prove the harness agrees with
;; itself.
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Three states a naive generator would essentially never produce:
;;
;;   (a) A HOP THAT ACTUALLY GETS REDIRECTED. Drawing sender and recipient
;;       independently produces adjacent hops (nothing to bind) far more often
;;       than multi-stage jumps, and a property that only ever saw adjacent
;;       hops would pass just as happily against the code this ticket
;;       replaces. Floored.
;;   (b) THE NON-MEMBER BRANCH. The second hole is only reachable when the
;;       ADDRESSED stage is not itself declared - which never happens on a
;;       full chain, the declaration most likely to be drawn. The sparse
;;       declarations are therefore explicit generator arms, and the
;;       addressed-not-declared shape carries its own floor.
;;   (c) EVERY LEFT-ALONE SHAPE. Invariant 3 is about hops that must NOT
;;       change, so each of its four exemptions (backward, detour header,
;;       kill switch, unusable declaration) is drawn deliberately and floored,
;;       rather than left to turn up.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to
;; swarm_handoff.bb, run, and reverted:
;;   - the guard never firing (the pre-BL-991 code) ................. P1
;;   - the guard computed from `literal-to` instead of `sender`
;;     (i.e. keeping the old non-member branch's rewrite target) .... P1
;;   - the binding rewrite recording its deferred target as skipped
;;     (emit-skip next-after-sender literal-to) ..................... P2
;;   - dropping the `rejection_reason` exemption ................... P3
;;   - the kill switch ignored ..................................... P3
;;
;; TWO GENERATOR DEFECTS THIS FILE'S OWN FLOORS CAUGHT, recorded because both
;; would have made it pass while testing almost nothing:
;;
;;   1. A fresh LCG seeded `base + i*stride` per run returns a near-constant
;;      FIRST draw for a small modulus. Seeded that way, the declaration was
;;      "no-cleaner" in 40 of 40 runs and the whole non-member branch went
;;      untested. One generator advanced across every run fixes it, and every
;;      declaration arm now carries its own floor.
;;   2. Folding the two detour headers into one arm meant a short run could
;;      draw `reroute_reason` every time - and the break that removes the
;;      `rejection_reason` exemption then passed. They are separate floored
;;      arms now, and that break fails as it should.

(ns bl991-binding-stages-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def script-dir (fs/parent (fs/canonicalize *file*)))
(def swarm-handoff (str (fs/path (fs/parent script-dir) "swarm_handoff.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(defn make-rng [seed]
  (let [state (atom seed)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

;; ONE generator advanced across every run, deliberately not a fresh one
;; seeded per run index. A fresh LCG seeded with `base + i*stride` returns a
;; near-constant FIRST draw for a small modulus - seeding this way per run
;; drew "no-cleaner" as the declaration in 40 of 40 runs, and the whole
;; non-member branch went untested. The reach floor below is what caught it;
;; the distribution is checked directly at the bottom of this file so a
;; future reseeding cannot quietly reintroduce it.
(def rng (make-rng 20260822))

(def canonical ["coder" "cleaner" "architect" "hardender" "documenter" "QA"])
(defn idx-of [role] (.indexOf canonical role))

;; The declaration arms. `full-chain` is the common case; the sparse ones are
;; explicit arms because the second hole is only reachable when the ADDRESSED
;; stage is itself undeclared, which a full chain can never produce.
;; `invalid` and `absent` both resolve to default-full, where sender judgement
;; still stands - they are invariant 3's "unusable declaration".
(def declarations
  {"full-chain" {:yaml "required_stages: [coder, cleaner, architect, hardender, documenter, qa]\n"
                 :declared #{"coder" "cleaner" "architect" "hardender" "documenter" "QA"}}
   "no-cleaner" {:yaml "required_stages: [coder, architect, hardender, documenter, qa]\n"
                 :declared #{"coder" "architect" "hardender" "documenter" "QA"}}
   "coder-cleaner-qa" {:yaml "required_stages: [coder, cleaner, qa]\n"
                       :declared #{"coder" "cleaner" "QA"}}
   "coder-documenter-qa" {:yaml "required_stages: [coder, documenter, qa]\n"
                          :declared #{"coder" "documenter" "QA"}}
   "absent" {:yaml "" :declared nil}
   "invalid" {:yaml "required_stages: [coder, cleaner]\n" :declared nil}})

;; The oracle, computed here rather than read back from the code under test.
(defn next-declared-after [declared sender]
  (when declared
    (first (filter declared (drop (inc (idx-of sender)) canonical)))))

(def temp-root (fs/create-temp-dir {:prefix "bl991-property-"}))
;; BL-971: removed on EVERY exit path, not only when the last assertion passes.
(.addShutdownHook (Runtime/getRuntime) (Thread. #(fs/delete-tree temp-root)))

(defn git! [root & args]
  (apply process/sh {:dir root :out :string :err :string}
         "git" "-c" "user.email=t@t" "-c" "user.name=t" args))

(defn mk-root [name yaml routing-enabled?]
  (let [root (str (fs/path temp-root name))]
    (fs/create-dirs (fs/path root "specs" "features"))
    (fs/create-dirs (fs/path root "backlog" "active"))
    (fs/create-dirs (fs/path root ".swarmforge"))
    (fs/create-dirs (fs/path root "swarmforge"))
    (spit (str (fs/path root "specs" "features" "x.feature")) "Feature: x\n")
    (spit (str (fs/path root "swarmforge" "swarmforge.conf"))
          (str "config required_stages_routing_enabled " (if routing-enabled? "true" "false") "\n"))
    (spit (str (fs/path root "backlog" "active" "BL-991-probe.yaml"))
          (str "id: BL-991\ntitle: \"probe\"\nstatus: active\nacceptance: specs/features/x.feature\n" yaml))
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str/join "" (for [r (conj canonical "coordinator")]
                         (str r "\t" r "\t" root "\tswarmforge-" r "\tX\tclaude\ttask\n"))))
    (git! root "init" "-q")
    (git! root "add" "-A")
    (git! root "commit" "-q" "-m" "seed")
    {:root root :commit (str/trim (:out (git! root "rev-parse" "--short=10" "HEAD")))}))

(defn send!
  "One real send. `extra-headers` carries the rejection_reason /
   reroute_reason detours invariant 3 exempts."
  [{:keys [root commit]} sender recipient {:keys [routing-enabled? extra-headers]}]
  (fs/delete-tree (fs/path root ".swarmforge" "handoffs"))
  (let [skips (fs/path root ".swarmforge" "routing-skips.jsonl")]
    (when (fs/exists? skips) (fs/delete skips)))
  (spit (str (fs/path root "draft.txt"))
        (str "type: git_handoff\nto: " recipient "\npriority: 50\ntask: BL-991-probe\ncommit: " commit "\n"
             (str/join "" (for [[k v] extra-headers] (str k ": " v "\n")))))
  (let [env (cond-> (assoc (into {} (System/getenv))
                           "SWARMFORGE_ROLE" sender
                           "SWARMFORGE_SKIP_SYNC_INJECT" "1")
              routing-enabled? (assoc "SWARMFORGE_REQUIRED_STAGES_ROUTING" "1")
              (not routing-enabled?) (dissoc "SWARMFORGE_REQUIRED_STAGES_ROUTING"))
        {:keys [exit out err]} (process/sh {:dir root :out :string :err :string :env env}
                                           "bb" swarm-handoff "draft.txt")]
    (if-not (zero? exit)
      (throw (ex-info (str "send failed: " out err) {}))
      (let [envelope (slurp (last (re-seq #"/[^\s]*\.handoff" (str out err))))
            skips-file (fs/path root ".swarmforge" "routing-skips.jsonl")]
        {:to (some #(when (str/starts-with? % "to: ") (str/trim (subs % 4))) (str/split-lines envelope))
         :header (some #(when (str/starts-with? % "routing_skipped: ") %) (str/split-lines envelope))
         :log (if (fs/exists? skips-file)
                (mapv #(json/parse-string % true)
                      (remove str/blank? (str/split-lines (slurp (str skips-file)))))
                [])}))))

(defn header-skipped [header]
  (if-let [m (and header (re-find #"skipped=([^\s]*)" header))]
    (set (str/split (second m) #","))
    #{}))

;; ── P1 + P2: a declared stage is never jumped, and a deferred one is not
;; recorded as skipped ────────────────────────────────────────────────────

(def usable-names ["full-chain" "no-cleaner" "coder-cleaner-qa" "coder-documenter-qa"])
(def usable-roots
  (into {} (for [n usable-names]
             [n (assoc (mk-root n (:yaml (declarations n)) true) :declared (:declared (declarations n)))])))

(doseq [run-index (range runs)]
  (let [decl-name (usable-names (rng (count usable-names)))
        {:keys [declared] :as fixture} (usable-roots decl-name)
        sender-idx (rng 5)
        sender (canonical sender-idx)
        recipient (canonical (+ sender-idx 1 (rng (- 5 sender-idx))))
        where (str "run " run-index " " decl-name " " sender "->" recipient)
        bound (next-declared-after declared sender)
        result (send! fixture sender recipient {:routing-enabled? true})]

    (bump! (keyword (str "declaration-" decl-name)))
    (when (> (idx-of recipient) (inc sender-idx)) (bump! :multi-stage-hop))
    (when-not (declared recipient) (bump! :addressed-not-declared))
    (when (and bound (< (idx-of bound) (idx-of recipient))) (bump! :redirected))

    ;; Invariant 1, stated exactly: never later than the first declared stage
    ;; after the sender.
    (when bound
      (check! (str where ": delivered to " (:to result) ", later than the bound " bound)
              (<= (idx-of (:to result)) (idx-of bound)))
      ;; And not merely "not later" - a router that delivered everything to
      ;; the sender's own position would satisfy that trivially.
      (check! (str where ": delivered to " (:to result) ", which is not forward of the sender")
              (> (idx-of (:to result)) sender-idx)))

    ;; Invariant 2: whatever was deferred is never in either record.
    (when (and bound (< (idx-of bound) (idx-of recipient)))
      (check! (str where ": the envelope header names the deferred " recipient " as skipped: " (:header result))
              (not (contains? (header-skipped (:header result)) recipient)))
      (doseq [line (:log result)]
        (check! (str where ": a routing-skips line names the deferred " recipient ": " (pr-str line))
                (not (contains? (set (:skipped line)) recipient))))
      ;; Nor may any stage AT OR AFTER the delivered one be recorded as
      ;; skipped - they are all still ahead of the parcel.
      (doseq [named (concat (header-skipped (:header result))
                            (mapcat :skipped (:log result)))]
        (check! (str where ": " named " is recorded skipped but is not behind the delivered " (:to result))
                (< (idx-of named) (idx-of (:to result))))))))

;; ── P3: enforcement reaches exactly as far as routing already reaches ────

(def left-alone-roots
  {:absent (mk-root "absent" (:yaml (declarations "absent")) true)
   :invalid (mk-root "invalid" (:yaml (declarations "invalid")) true)
   :disabled (mk-root "disabled" (:yaml (declarations "full-chain")) false)
   :detour (mk-root "detour" (:yaml (declarations "full-chain")) true)
   :backward (mk-root "backward" (:yaml (declarations "full-chain")) true)})

(doseq [run-index (range runs)]
  (let [shape ([:absent :invalid :disabled :rejection :reroute :backward] (rng 6))
        fixture (left-alone-roots (if (contains? #{:rejection :reroute} shape) :detour shape))
        [sender recipient extra]
        (case shape
          :backward (let [ri (rng 5)
                          si (+ ri 1 (rng (- 5 ri)))]
                      [(canonical si) (canonical ri) nil])
          ;; The two detour headers are SEPARATE arms with separate floors.
          ;; Folded into one, a short check of "is the rejection_reason guard
          ;; still there" can pass simply by never drawing that half - which is
          ;; exactly what happened while proving the breaks for this file.
          :rejection (let [si (rng 5)]
                       [(canonical si) (canonical (+ si 1 (rng (- 5 si))))
                        {"rejection_reason" "bounced"}])
          :reroute (let [si (rng 5)]
                     [(canonical si) (canonical (+ si 1 (rng (- 5 si))))
                      {"reroute_reason" "operator detour"}])
          (let [si (rng 5)]
            [(canonical si) (canonical (+ si 1 (rng (- 5 si)))) nil]))
        where (str "run " run-index " " (name shape) " " sender "->" recipient)
        result (send! fixture sender recipient
                      {:routing-enabled? (not= :disabled shape) :extra-headers extra})]
    (bump! (keyword (str "left-alone-" (name shape))))
    (check! (str where ": a hop routing already leaves alone was redirected to " (:to result))
            (= recipient (:to result)))))

;; ── reach, asserted rather than hoped for ────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

;; Every declaration arm must actually be drawn - the guard against the
;; degenerate seeding described above, asserted rather than eyeballed.
(doseq [n usable-names] (floor! (keyword (str "declaration-" n)) 3))
(floor! :multi-stage-hop 10)
(floor! :addressed-not-declared 5)
(floor! :redirected 10)
(floor! :left-alone-absent 3)
(floor! :left-alone-invalid 3)
(floor! :left-alone-disabled 3)
(floor! :left-alone-rejection 3)
(floor! :left-alone-reroute 3)
(floor! :left-alone-backward 3)

(if (empty? @failures)
  (println (str "bl991_binding_stages_property (BL-991): ALL " (* 2 runs) " SENDS PASSED " (pr-str @reached)))
  (do (println (str "bl991_binding_stages_property (BL-991): " (count @failures) " FAILURE(S):"))
      (doseq [f (take 12 @failures)] (println f))
      (System/exit 1)))

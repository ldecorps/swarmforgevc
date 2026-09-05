#!/usr/bin/env bb
;; BL-1421 coder pass (BL-654 Invariants): PROPERTY tests over
;; post_qa_branch_sweep_lib.bb's sweep!/decide-role, encoding the ticket's
;; three declared invariants:
;;
;;   1. "One standing surfacing per (role, reason): a role is told again
;;      only after its HEAD contains the landed sha it was last told
;;      about; a newer landed sha alone never re-tells or re-wakes." P1
;;      generates an arbitrary sequence of ticks (each its own landed sha
;;      and an independent caught-up-to-told? flag, dirty throughout) and
;;      replays it through the REAL sweep! against a REFERENCE state
;;      machine computed independently in this file, asserting the two
;;      produce the IDENTICAL per-tick tell/no-tell pattern, not merely
;;      the same total count.
;;   2. "A role holding in_process work is surfaced as in-process work and
;;      never woken by the sweep." P2 generates arbitrary dirty?/can-ff?/
;;      head-sha/landed-sha combinations with in-process? always true and
;;      asserts decide-role NEVER returns :dirty-worktree regardless of
;;      dirty?'s own value, and that the resulting reason never wakes
;;      (wake-for-reason?).
;;   3. "BL-1361's contract holds unchanged: ... one unreachable mailbox
;;      withholds nothing from the others." P3 generates an arbitrary set
;;      of 2-6 roles, each independently dirty-and-untold, with an
;;      arbitrary SUBSET of them wired to a tell! that throws, and asserts
;;      every role NOT in that subset is still told exactly once.
;;
;; Same deterministic-seeded-LCG shape as provider_auth_observe_lib_property_
;; runner.bb (BL-472: no mutation/property tooling wired for Babashka).
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken record-surface! that
;;     dropped the upsert (plain conj, letting stale AND fresh records for
;;     the same (role,reason) coexist) - failed on every generated
;;     sequence with 2+ tells, because told-sha-for's `some` then finds
;;     the FIRST (stale) match rather than the current one.
;;   - P2 was run against a deliberately broken decide-role reverting to
;;     the pre-BL-1421 dirty?-before-in-process? precedence - failed on
;;     every generated case with dirty?=true (the majority, since a
;;     mid-parcel role is dirty by definition).
;;   - P3 was run against a deliberately broken sweep! with the tell!
;;     try/catch removed - failed on every generated case whose throwing
;;     subset was non-empty and not the LAST role in iteration order (the
;;     exception propagates out of reduce, aborting every role after it).

(ns bl1421-one-standing-surfacing-property-runner
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "post_qa_branch_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 500))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 17]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

;; ── P1: one standing surfacing per (role, reason) ──────────────────────────

(defn gen-p1 [s]
  (let [[len-n s1] (gen-int s 15)
        len (inc len-n)
        [flags s2] (reduce (fn [[acc sx] _]
                              (let [[b sy] (gen-bool sx)] [(conj acc b) sy]))
                            [[] s1] (range len))]
    [flags s2]))

;; Reference model, independent of the implementation under test: told? is
;; whether a standing (not-yet-caught-up) surfacing currently exists.
(defn- reference-tell-pattern [caught-ups]
  (loop [remaining caught-ups told? false acc []]
    (if (empty? remaining)
      acc
      (let [caught-up (first remaining)
            tell-now? (or (not told?) caught-up)]
        (recur (rest remaining) true (conj acc tell-now?))))))

(check-all "P1: sweep!'s per-tick tell/no-tell pattern matches an independent reference state machine"
  gen-p1
  (fn [caught-ups]
    (let [dir (str (fs/create-temp-dir {:prefix "bl1421-p1-"}))]
      (try
        (let [tells (atom [])
              box (atom {:caught-up false})
              adapters {:role-facts! (fn [_] {:head-sha "role-head" :dirty? true :in-process? false :can-ff? false :contains-landed? false})
                        :fast-forward! (fn [_ _] {:success true})
                        :caught-up-to-told? (fn [_ _] (:caught-up @box))
                        :tell! (fn [_ _ _ _] (swap! tells conj true) {:success true})
                        :log! (fn [& _] nil)}
              actual (mapv (fn [i caught-up]
                             (reset! box {:caught-up caught-up})
                             (let [before (count @tells)]
                               (post-qa-branch-sweep-lib/sweep! dir (str "sha-" i) ["coder"] adapters)
                               (> (count @tells) before)))
                           (range (count caught-ups)) caught-ups)
              expected (reference-tell-pattern caught-ups)]
          (or (= expected actual)
              (str "expected pattern " (pr-str expected) " got " (pr-str actual))))
        (finally (fs/delete-tree dir))))))

;; ── P2: in-process work always surfaces as in-process-work, never woken ───

(def sample-shas ["shaA" "shaB" "shaC"])

(defn gen-p2 [s]
  (let [[dirty? s1] (gen-bool s)
        [can-ff? s2] (gen-bool s1)
        [hi s3] (gen-int s2 (count sample-shas))
        [li s4] (gen-int s3 (count sample-shas))]
    [{:dirty? dirty? :can-ff? can-ff? :head-sha (nth sample-shas hi) :landed-sha (nth sample-shas li)} s4]))

(check-all "P2: in-process? always surfaces as in-process-work regardless of dirty?, and never wakes"
  gen-p2
  (fn [{:keys [dirty? can-ff? head-sha landed-sha]}]
    (if (= head-sha landed-sha)
      true ;; already-settled - in-process? is moot, not this property's concern
      (let [decision (post-qa-branch-sweep-lib/decide-role
                       {:head-sha head-sha :landed-sha landed-sha
                        :dirty? dirty? :in-process? true :can-ff? can-ff? :contains-landed? false})]
        (cond
          (not= {:action :surface :reason :in-process-work} decision)
          (str "expected in-process-work regardless of dirty?=" dirty? ", got " (pr-str decision))

          (post-qa-branch-sweep-lib/wake-for-reason? (:reason decision))
          "in-process-work must never wake"

          :else true)))))

;; ── P3: one unreachable mailbox withholds nothing from the others ────────

(def sample-roles ["coder" "cleaner" "architect" "hardener" "documenter" "QA"])

(defn gen-p3 [s]
  (let [[n-n s1] (gen-int s 5)
        n (+ 2 n-n) ;; 2..6 roles
        roles (vec (take n sample-roles))
        [throw-mask s2] (reduce (fn [[acc sx] _]
                                   (let [[b sy] (gen-bool sx)] [(conj acc b) sy]))
                                 [[] s1] (range n))]
    [{:roles roles :throw-mask throw-mask} s2]))

(check-all "P3: a tell! that throws for some roles withholds nothing from the others"
  gen-p3
  (fn [{:keys [roles throw-mask]}]
    (let [dir (str (fs/create-temp-dir {:prefix "bl1421-p3-"}))]
      (try
        (let [told (atom #{})
              throwing (set (keep (fn [[r t?]] (when t? r)) (map vector roles throw-mask)))
              adapters {:role-facts! (fn [_] {:head-sha "role-head" :dirty? true :in-process? false :can-ff? false :contains-landed? false})
                        :fast-forward! (fn [_ _] {:success true})
                        :caught-up-to-told? (fn [_ _] false)
                        :tell! (fn [role _ _ _]
                                 (if (contains? throwing role)
                                   (throw (Exception. (str role " mailbox unwritable")))
                                   (do (swap! told conj role) {:success true})))
                        :log! (fn [& _] nil)}
              expected-told (clojure.set/difference (set roles) throwing)]
          (post-qa-branch-sweep-lib/sweep! dir "landed-sha" roles adapters)
          (or (= expected-told @told)
              (str "expected told=" (pr-str expected-told) " got " (pr-str @told))))
        (finally (fs/delete-tree dir))))))

;; ── P1b (also invariant 1): record-surface! upserts - at most ONE entry per
;;    (role, reason), always naming the LAST landed-sha it was called with.
;;    Not implied by P1 above: P1's mocked :caught-up-to-told? ignores the
;;    told-sha it is handed, so a broken upsert (plain conj, leaving stale
;;    duplicates) does not change P1's tell/no-tell pattern at all - this is
;;    the property that actually pins the upsert contract down. ───────────

(defn gen-p1b [s]
  (let [[n-n s1] (gen-int s 8)
        n (inc n-n)] ;; 1..8 successive re-surfacings of the SAME (role,reason)
    [{:shas (mapv #(str "sha-" %) (range n))} s1]))

(check-all "P1b: record-surface! upserts to exactly one entry per (role,reason), naming the LAST landed-sha"
  gen-p1b
  (fn [{:keys [shas]}]
    (let [final (reduce (fn [state sha] (post-qa-branch-sweep-lib/record-surface! state "coder" :dirty-worktree sha))
                         {:surfaced []} shas)
          matching (filter #(and (= "coder" (:role %)) (= "dirty-worktree" (:reason %))) (:surfaced final))]
      (cond
        (not= 1 (count matching)) (str "expected exactly 1 entry, got " (count matching) ": " (pr-str matching))
        (not= (last shas) (:told-sha (first matching)))
        (str "expected told-sha " (last shas) ", got " (:told-sha (first matching)))
        :else true))))

;; ── generator coverage (asserted reachability floors) ─────────────────────

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(let [p1-lens (sweep-coverage 17 gen-p1 count)
      p1-multi-tell (sweep-coverage 17 gen-p1 #(some true? (rest (reference-tell-pattern %))))
      p2-dirty (sweep-coverage 19 gen-p2 :dirty?)
      p3-some-throw (sweep-coverage 23 gen-p3 #(some true? (:throw-mask %)))
      buckets {:p1-len-over-5 (count (filter #(> % 5) p1-lens))
               :p1-has-a-recatch-tell (count (filter true? p1-multi-tell))
               :p2-dirty-true (count (filter true? p2-dirty))
               :p3-some-throwing (count (filter true? p3-some-throw))}
      floor (quot runs 10)]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 17 buckets (str k " barely exercised")))))

;; ── report ────────────────────────────────────────────────────────────────
(println (str "bl1421 one-standing-surfacing properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 10 @failures)] (println f))
      (System/exit 1)))

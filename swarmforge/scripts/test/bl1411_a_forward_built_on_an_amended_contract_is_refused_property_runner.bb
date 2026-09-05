#!/usr/bin/env bb
;; BL-1411 coder pass (BL-654 Invariants): PROPERTY tests over
;; contract_freshness_gate_lib.bb encoding the ticket's three declared
;; invariants:
;;
;;   1. "The gate reads main ... against the sender's merge-base only,
;;      never the parcel tip." P1 builds a real git fixture with a `main`
;;      branch and a `sender` branch sharing one base commit, independently
;;      randomizes whether MAIN amends the declared feature file after the
;;      base and whether the SENDER edits its own copy, and asserts
;;      `blocked?` tracks amend-main? exactly, regardless of edit-parcel?.
;;   2. "Exactly one reader of acceptance: exists on the send path... never
;;      parses the ticket YAML itself." P2 generates randomized ticket-YAML
;;      shapes (quoting, block-scalar, surrounding fields) and asserts
;;      findings-for-git-handoff's own `:path` always agrees with
;;      task-scope-gate-lib/declared-acceptance-path applied directly to
;;      the same YAML - a second, independently-written reader could only
;;      diverge from that, never coincide with it, on every generated case.
;;   3. "A refusal is loud and never queues... a contract it cannot read...
;;      is stated in one line and never refuses." P3a drives decide-for-ref
;;      through every one of its six reachable outcomes (four fail-open
;;      reasons, refuse, clean) with fuzzed concrete payloads and asserts
;;      the fail-open branches never produce :refuse; P3b drives
;;      refusal-message with randomized task names / paths / refs /
;;      amending commits and asserts every required fact appears in the
;;      text.
;;
;; Same deterministic-seeded-LCG shape as bl1405's own property runner
;; (BL-472: no mutation/property tooling wired for Babashka). Never `rand`.
;;
;; Non-vacuity proven by hand at authoring time (each mutant restored
;; before this commit; `diff` against a pre-break backup confirmed exact
;; restoration):
;;   - P1 was run against a deliberately broken gather-and-decide-for-ref
;;     that used the CITED COMMIT as the base instead of the real
;;     merge-base - failed on generated cases where the sender edited its
;;     own copy while main stayed untouched (blocked wrongly flipped true).
;;   - P2 was run against a deliberately broken path reader (a naive
;;     `re-find` with no quote-stripping/block-scalar handling) - failed on
;;     every generated case using a quoted or block-scalar acceptance:
;;     value.
;;   - P3a was run with the `(nil? differs?)` fail-open branch deleted -
;;     failed on every :differs-unknown case (fell through to :clean
;;     instead of :not-evaluated).
;;   - P3b was run with the HANDOFF_NOT_QUEUED line removed from
;;     refusal-message - failed on every generated case.

(ns bl1411-a-forward-built-on-an-amended-contract-is-refused-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "contract_freshness_gate_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 300))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-bool [s] (let [[n s'] (gen-int s 2)] [(= 1 n) s']))
(defn- hex-char [n] (nth "0123456789abcdef" n))
(defn- gen-hex [s len]
  (reduce (fn [[acc sx] _]
            (let [[n sy] (gen-int sx 16)] [(str acc (hex-char n)) sy]))
          ["" s] (range len)))

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 47]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

;; ── P1: main against the sender's base only, never the parcel tip ─────────

(def feature-path "specs/features/BL-9002-fixture.feature")
(def ^:private p1-root (atom nil))
(def ^:private p1-base (atom nil))

(defn- p1-setup! []
  (let [dir (str (fs/create-temp-dir {:prefix "bl1411-p1-"}))]
    (sh! dir "git" "init" "-q" "-b" "main")
    (sh! dir "git" "config" "user.email" "t@t")
    (sh! dir "git" "config" "user.name" "t")
    (sh! dir "git" "config" "commit.gpgsign" "false")
    (fs/create-dirs (fs/path dir "specs" "features"))
    (fs/create-dirs (fs/path dir "backlog" "active"))
    (spit (str (fs/path dir "backlog" "active" "BL-9002-fixture.yaml"))
          (str "id: BL-9002\nacceptance: " feature-path "\n"))
    (spit (str (fs/path dir feature-path)) "Feature: fixture\n  Scenario: one\n    Given a\n")
    (sh! dir "git" "add" "-A")
    (sh! dir "git" "commit" "-q" "-m" "base")
    (reset! p1-root dir)
    (reset! p1-base (:out (sh! dir "git" "rev-parse" "HEAD")))))

(defn- p1-teardown! [] (when @p1-root (fs/delete-tree @p1-root)))

(defn gen-p1 [s]
  (let [[amend-main? s1] (gen-bool s)
        [edit-parcel? s2] (gen-bool s1)
        [salt s3] (gen-int s2 1000000)]
    [{:amend-main? amend-main? :edit-parcel? edit-parcel? :salt salt} s3]))

(defn- p1-case [{:keys [amend-main? edit-parcel? salt]}]
  (let [dir @p1-root
        base @p1-base]
    (sh! dir "git" "checkout" "-q" "main")
    (sh! dir "git" "reset" "-q" "--hard" base)
    (when amend-main?
      (spit (str (fs/path dir feature-path))
            (str "Feature: fixture\n  Scenario: main-amended-" salt "\n    Given a\n"))
      (sh! dir "git" "add" "-A")
      (sh! dir "git" "commit" "-q" "-m" "amend on main"))
    (sh! dir "git" "branch" "-f" "sender" base)
    (sh! dir "git" "checkout" "-q" "sender")
    (when edit-parcel?
      (spit (str (fs/path dir feature-path))
            (str "Feature: fixture (sender's own copy, salt " salt ")\n  Scenario: one\n    Given a\n"))
      (sh! dir "git" "add" "-A")
      (sh! dir "git" "commit" "-q" "-m" "sender's own edit"))
    (let [commit (:out (sh! dir "git" "rev-parse" "sender"))
          result (contract-freshness-gate-lib/findings-for-git-handoff
                  {:root dir :task-name "BL-9002-fixture" :commit commit})
          blocked (contract-freshness-gate-lib/blocked? result)]
      (if (= blocked (boolean amend-main?))
        true
        (str "amend-main?=" amend-main? " edit-parcel?=" edit-parcel?
             " expected blocked=" (boolean amend-main?) " actual=" blocked
             " result=" (pr-str result))))))

;; ── P2: exactly one reader of acceptance: ──────────────────────────────────

(def ^:private p2-root (atom nil))

(defn- p2-setup! []
  (let [dir (str (fs/create-temp-dir {:prefix "bl1411-p2-"}))]
    (sh! dir "git" "init" "-q" "-b" "main")
    (sh! dir "git" "config" "user.email" "t@t")
    (sh! dir "git" "config" "user.name" "t")
    (sh! dir "git" "config" "commit.gpgsign" "false")
    (fs/create-dirs (fs/path dir "backlog" "active"))
    (sh! dir "git" "commit" "-q" "--allow-empty" "-m" "seed")
    (reset! p2-root dir)))

(defn- p2-teardown! [] (when @p2-root (fs/delete-tree @p2-root)))

;; BL-1289: the explicit teardown! calls below cover the normal path; this
;; hook is the backstop for an unexpected exception between setup and its
;; own teardown call - each teardown fn already guards nil/gone paths.
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn []
                              (try (p1-teardown!) (catch Exception _ nil))
                              (try (p2-teardown!) (catch Exception _ nil)))))

(def quote-styles [(fn [v] v) (fn [v] (str "\"" v "\"")) (fn [v] (str "'" v "'"))])

(defn gen-p2 [s]
  (let [[has-field? s1] (gen-bool s)
        [is-block? s2] (gen-bool s1)
        [quote-idx s3] (gen-int s2 (count quote-styles))
        [n-before s4] (gen-int s3 3)
        [n-after s5] (gen-int s4 3)
        [salt s6] (gen-int s5 1000000)
        path (str "specs/features/BL-" salt "-fixture.feature")
        acceptance-line (cond
                          (not has-field?) nil
                          is-block? "acceptance: |"
                          :else (str "acceptance: " ((nth quote-styles quote-idx) path)))
        yaml (str/join "\n"
                        (concat ["id: BL-9003"]
                                (repeat n-before "notes: filler")
                                (when acceptance-line [acceptance-line])
                                (when (and has-field? is-block?)
                                  ["  a block body line" "  another block line"])
                                (repeat n-after "priority: 5")
                                [""]))]
    [{:yaml yaml :has-field? has-field? :is-block? is-block?} s6]))

(defn- p2-case [{:keys [yaml]}]
  (let [dir @p2-root]
    (spit (str (fs/path dir "backlog" "active" "BL-9003-fixture.yaml")) yaml)
    (sh! dir "git" "add" "-A")
    (sh! dir "git" "commit" "-q" "-m" "case")
    (let [commit (:out (sh! dir "git" "rev-parse" "HEAD"))
          result (contract-freshness-gate-lib/findings-for-git-handoff
                  {:root dir :task-name "BL-9003-fixture" :commit commit})
          expected (task-scope-gate-lib/declared-acceptance-path yaml)]
      (if (= expected (:path result))
        true
        (str "expected path=" (pr-str expected) " actual=" (pr-str (:path result))
             " yaml=" (pr-str yaml))))))

;; ── P3a: decide-for-ref's fail-open is absolute ────────────────────────────

(def p3a-categories [:not-ref-exists :no-base :path-absent :differs-unknown :refuse :clean])

(defn gen-p3a [s]
  (let [[cat-idx s1] (gen-int s (count p3a-categories))
        cat (nth p3a-categories cat-idx)
        [base-hex s2] (gen-hex s1 10)
        [ref-idx s3] (gen-int s2 2)
        ref (["main" "origin/main"] ref-idx)
        [n-commits s4] (gen-int s3 3)
        [commits s5] (reduce (fn [[acc sx] _]
                                (let [[h sy] (gen-hex sx 8)] [(conj acc h) sy]))
                              [[] s4] (range (inc n-commits)))
        facts (case cat
                :not-ref-exists  {:ref-exists? false :base base-hex :path-exists-on-ref? true :differs? true}
                :no-base         {:ref-exists? true :base nil :path-exists-on-ref? true :differs? true}
                :path-absent     {:ref-exists? true :base base-hex :path-exists-on-ref? false :differs? true}
                :differs-unknown {:ref-exists? true :base base-hex :path-exists-on-ref? true :differs? nil}
                :refuse          {:ref-exists? true :base base-hex :path-exists-on-ref? true :differs? true}
                :clean           {:ref-exists? true :base base-hex :path-exists-on-ref? true :differs? false})]
    [(assoc facts :category cat :ref ref :amending-commits commits) s5]))

(defn- p3a-case [{:keys [category] :as facts}]
  (let [result (contract-freshness-gate-lib/decide-for-ref facts)
        action (:action result)]
    (case category
      (:not-ref-exists :no-base :path-absent :differs-unknown)
      (if (= :not-evaluated action)
        true
        (str "category=" category " expected :not-evaluated, got " (pr-str result)))

      :refuse
      (if (= :refuse action)
        true
        (str "category=" category " expected :refuse, got " (pr-str result)))

      :clean
      (if (= :clean action)
        true
        (str "category=" category " expected :clean, got " (pr-str result))))))

;; ── P3b: refusal-message is loud - names everything it must ────────────────

;; Every finding a real call site produces shares the SAME path (BL-1276's
;; single reader resolves one declared path per ticket; only the REF and
;; amending commits vary across findings, one per ref in refs-checked) -
;; the generator matches that shape rather than inventing an impossible
;; multi-path parcel.
(defn gen-p3b [s]
  (let [[ticket-num s1] (gen-int s 9000)
        [path-salt s1a] (gen-int s1 100000)
        path (str "specs/features/BL-" path-salt "-fixture.feature")
        [n-findings0 s2] (gen-int s1a 2)
        n-findings (inc n-findings0)
        [findings s3]
        (reduce (fn [[acc sx] i]
                  (let [[ref-idx sz] (gen-int sx 2)
                        ref (["main" "origin/main"] ref-idx)
                        [n-commits sw] (gen-int sz 2)
                        [commits sv] (reduce (fn [[cacc cx] _]
                                               (let [[h cy] (gen-hex cx 8)] [(conj cacc h) cy]))
                                             [[] sw] (range (inc n-commits)))]
                    [(conj acc {:path path :ref ref :amending-commits commits}) sv]))
                [[] s2] (range n-findings))]
    [{:task-name (str "BL-" (+ 9000 ticket-num) "-fixture") :findings findings} s3]))

(defn- p3b-case [{:keys [task-name findings] :as input}]
  (let [msg (contract-freshness-gate-lib/refusal-message input)
        problems
        (remove nil?
                (concat
                 [(when-not (str/includes? msg (str "CONTRACT_AMENDED_SINCE_BASE for " task-name))
                    "missing opening marker with task-name")
                  (when-not (str/includes? msg "HANDOFF_NOT_QUEUED") "missing HANDOFF_NOT_QUEUED")
                  (when-not (str/includes? msg "merge main") "missing remedy: merge main")
                  (when-not (str/includes? msg "send again") "missing remedy: send again")]
                 (mapcat (fn [{:keys [path ref amending-commits]}]
                           (concat
                            [(when-not (str/includes? msg path) (str "missing path " path))
                             (when-not (str/includes? msg ref) (str "missing ref " ref))]
                            (map (fn [c] (when-not (str/includes? msg c) (str "missing amending commit " c)))
                                 amending-commits)))
                         findings)))]
    (if (empty? problems) true (str/join "; " problems))))

;; ── run everything ──────────────────────────────────────────────────────

(p1-setup!)
(check-all "P1: main against the sender's base only, never the parcel tip" gen-p1 p1-case)
(p1-teardown!)

(p2-setup!)
(check-all "P2: exactly one reader of acceptance: - never a second parser" gen-p2 p2-case)
(p2-teardown!)

(check-all "P3a: decide-for-ref's fail-open is absolute" gen-p3a p3a-case)
(check-all "P3b: refusal-message names every required fact" gen-p3b p3b-case)

;; ── generator coverage (asserted reachability floors) ──────────────────────

(let [p1-inputs (sweep-coverage 47 gen-p1 identity)
      p2-inputs (sweep-coverage 47 gen-p2 identity)
      p3a-inputs (sweep-coverage 47 gen-p3a identity)
      floor (quot runs 10)
      buckets {:p1-amend-main (count (filter :amend-main? p1-inputs))
               :p1-amend-main-false (count (remove :amend-main? p1-inputs))
               :p1-edit-parcel (count (filter :edit-parcel? p1-inputs))
               :p2-has-field (count (filter :has-field? p2-inputs))
               :p2-no-field (count (remove :has-field? p2-inputs))
               :p2-is-block (count (filter :is-block? p2-inputs))
               :p3a-not-ref-exists (count (filter #(= :not-ref-exists (:category %)) p3a-inputs))
               :p3a-no-base (count (filter #(= :no-base (:category %)) p3a-inputs))
               :p3a-path-absent (count (filter #(= :path-absent (:category %)) p3a-inputs))
               :p3a-differs-unknown (count (filter #(= :differs-unknown (:category %)) p3a-inputs))
               :p3a-refuse (count (filter #(= :refuse (:category %)) p3a-inputs))
               :p3a-clean (count (filter #(= :clean (:category %)) p3a-inputs))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 47 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ──────────────────────────────────────────────────────────────

(println (str "bl1411 a-forward-built-on-an-amended-contract-is-refused properties: " runs " runs each"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))

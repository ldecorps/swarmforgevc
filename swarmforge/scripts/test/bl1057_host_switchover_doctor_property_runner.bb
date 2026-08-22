#!/usr/bin/env bb
;; BL-1057 property test (coder-authored, THREE declared invariants) over
;; host_switchover_doctor_lib.bb.
;;
;;   Invariant 1: the doctor never writes. After any run, on any host state
;;   including a fully stale one, every inspected file, directory and registry
;;   entry is byte-identical to what it was before. A durable property, not a
;;   slice boundary - repair belongs to a separate command.
;;   Invariant 2: every declared check appears in the report exactly once with
;;   exactly one verdict. A check whose target cannot be read reports BLOCKED;
;;   never omitted, never assumed OK.
;;   Invariant 3: a non-OK finding always names both the concrete location at
;;   fault and the remediation step for it.
;;
;; WHY PROPERTIES AND NOT MORE FIXTURES. All three quantify over "every host
;; state this command could be run against". The unit runner pins the verdict
;; for each shape one at a time; what these cover is the whole INVENTORY at
;; once, in states no hand-written fixture would think to combine - every
;; location blocked, a stale settings file beside an absent registry, an empty
;; credentials directory next to a readable one.
;;
;; Invariant 1 is checked against a REAL temp filesystem, not an injected one:
;; "the doctor never writes" is a claim about the disk, and an injected write
;; seam that nobody calls would prove only that the harness never called it.
;; The tree is hashed before and after (content, mtime and the full entry
;; list, so a creation or deletion anywhere shows up too).
;;
;; REACH, asserted rather than hoped for (BL-654's generator-reach clause).
;; Two states a naive generator would essentially never produce:
;;
;;   (a) EVERY VERDICT, INCLUDING BLOCKED. Drawing "does this file exist"
;;       independently per location yields OK and MISSING constantly and
;;       BLOCKED never - an unreadable location is not a coin flip on a real
;;       disk. Each location's state is therefore drawn from an explicit
;;       four-way state set, and every verdict carries its own floor.
;;   (b) A STALE PATH THAT IS ACTUALLY A NEAR MISS. A stale root drawn
;;       independently of the real one differs in every character, so a
;;       prefix-only comparison (the `swarmforgevc-old` trap) would survive
;;       any number of runs. Stale roots are therefore DERIVED from the real
;;       repo root by the transformations that produce real false matches -
;;       appending a suffix to the last segment, and re-rooting under the old
;;       Mac path - so every stale case is a collision candidate by
;;       construction.
;;
;; Non-vacuity PROVEN at authoring time (2026-08-22), each break applied to
;; host_switchover_doctor_lib.bb, run, and reverted:
;;   - `verdict-for` returning :ok when a read fails ........... P2 (BLOCKED floor)
;;   - `run-doctor` filtering :ok findings out of the report ... P2 (one entry per row)
;;   - `describes-root?` dropping its "/" separator ............ P2 (a -old sibling reads OK)
;;   - a finding built without its row's :remediation .......... P3
;;   - `slurp`-then-`spit` added to the read seam .............. P1

(ns bl1057-host-switchover-doctor-property-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str])
  (:import [java.security MessageDigest]))

(def test-dir (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path (fs/parent test-dir) "host_switchover_doctor_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 60))

(def failures (atom []))
(defn fail! [msg] (swap! failures conj (str "FAIL: " msg)))
(defn check! [msg expr] (when-not expr (fail! msg)))

;; Deterministic, seeded - a failing case is reproducible by its run index.
(defn make-rng [seed]
  (let [state (atom seed)]
    (fn [n] (let [next (mod (+ (* 1103515245 @state) 12345) 2147483648)]
              (reset! state next)
              (mod (quot next 65536) n)))))

;; ── the generated host state ──────────────────────────────────────────────

;; Four explicit states per location, so BLOCKED is drawn as often as the
;; others rather than waiting on a disk to misbehave.
(def location-states [:healthy :absent :stale :unreadable])

(defn stale-root
  "DERIVED from the real root by the two transformations that produce genuine
   false matches: a sibling checkout sharing this one's name as a prefix, and
   the old Mac path this swarm actually moved off. Drawn independently, a
   stale root would differ in every character and a prefix-only comparison
   would never be caught."
  [repo-root n]
  (case (mod n 2)
    0 (str repo-root "-old")
    1 "/Users/ldecorps/projects/swarmforgevc"))

(defn write! [path content]
  (fs/create-dirs (fs/parent path))
  (spit (str path) content))

(defn build-host!
  "Materialises one generated host state on a REAL temp filesystem and returns
   {:repo-root .. :env .. :states {id state}}."
  [root rng]
  (let [repo-root (str (fs/path root "checkout"))
        home (str (fs/path root "home"))
        tunnels (str (fs/path home ".swarmforge" "tunnels"))
        cloudflared (str (fs/path home ".cloudflared"))
        states (into {} (for [row host-switchover-doctor-lib/default-inventory]
                          [(:id row) (location-states (rng (count location-states)))]))]
    (fs/create-dirs repo-root)
    (fs/create-dirs tunnels)
    (fs/create-dirs cloudflared)
    (doseq [row host-switchover-doctor-lib/default-inventory
            :let [state (states (:id row))
                  ctx (host-switchover-doctor-lib/context
                       {:repo-root repo-root
                        :env {"HOME" home
                              "SWARMFORGE_TUNNEL_REGISTRY_DIR" tunnels
                              "SWARMFORGE_CLOUDFLARED_DIR" cloudflared}})
                  path (host-switchover-doctor-lib/resolve-path ctx row)]]
      (case (:check row)
        :settings
        (case state
          :absent nil
          :unreadable (fs/create-dirs path) ; a directory read as a file is a REAL unreadable read
          :stale (write! path (str "{\n"
                                   (str/join ",\n"
                                             (for [k (:keys row)]
                                               (str "  \"" k "\": \"" (stale-root repo-root (rng 2)) "\"")))
                                   "\n}\n"))
          (write! path (str "{\n"
                            (str/join ",\n" (for [k (:keys row)] (str "  \"" k "\": \"" repo-root "\"")))
                            "\n}\n")))

        :root-text
        (case state
          :absent nil
          :unreadable (fs/create-dirs path)
          :stale (write! path (str (stale-root repo-root (rng 2)) "\n"))
          (write! path (str repo-root "\n")))

        :present
        (case state
          :absent nil
          ;; A directory where a file belongs: a REAL unreadable read, no chmod.
          :unreadable (fs/create-dirs path)
          (write! path "x\n"))

        :present-any
        (when (contains? #{:healthy :stale} state)
          (write! (str (fs/path path "abc-123.json")) "{}\n"))))
    {:repo-root repo-root
     :env {"HOME" home
           "SWARMFORGE_TUNNEL_REGISTRY_DIR" tunnels
           "SWARMFORGE_CLOUDFLARED_DIR" cloudflared}
     :states states}))

(defn expected-verdict
  "What the generated state must produce for a row. The oracle is derived from
   how build-host! materialises each state, so the two cannot drift: a state
   the builder writes as a stale value must come back :stale, and one it
   writes as a directory-where-a-file-belongs must come back :blocked."
  [row state]
  (case (:check row)
    (:settings :root-text) (case state
                             :healthy :ok
                             :stale :stale
                             :unreadable :blocked
                             :absent (if (:required? row) :missing :ok))
    :present (case state
               :absent (if (:required? row) :missing :ok)
               :unreadable :blocked
               :ok)
    ;; The credentials DIRECTORY always exists (build-host! creates it), so
    ;; the states in which no *.json is written come back :missing, never
    ;; :blocked - an empty directory lists fine.
    :present-any (if (contains? #{:healthy :stale} state)
                   :ok
                   (if (:required? row) :missing :ok))))

;; ── a byte-level fingerprint of the whole tree ────────────────────────────

(defn sha256 [^String s]
  (let [digest (.digest (MessageDigest/getInstance "SHA-256") (.getBytes s "UTF-8"))]
    (apply str (map #(format "%02x" %) digest))))

(defn fingerprint
  "Every entry under `root`, with its content and mtime. A creation, a
   deletion, a rewrite or a touch anywhere in the tree changes this string."
  [root]
  (sha256
   (str/join "\n"
             (for [p (sort (map str (fs/glob root "**" {:hidden true})))]
               (str p "\t"
                    (if (fs/directory? p)
                      "DIR"
                      (str (fs/size p) "\t"
                           (str (fs/last-modified-time p)) "\t"
                           (sha256 (try (slurp p) (catch Exception _ "<unreadable>"))))))))))

;; ── the run ───────────────────────────────────────────────────────────────

(def reached (atom {}))
(defn bump! [k] (swap! reached update k (fnil inc 0)))

(def temp-root (fs/create-temp-dir {:prefix "bl1057-property-"}))
;; BL-971: removed on EVERY exit path, not only when the last assertion passes.
(.addShutdownHook (Runtime/getRuntime) (Thread. #(fs/delete-tree temp-root)))

;; ONE generator advanced across every run, deliberately not a fresh one
;; seeded per run index (same convention as every other seeded-LCG
;; `*_property_runner.bb` in this directory - BL-991 hit the identical
;; defect and this is the same fix). A fresh LCG seeded `base + i*stride`
;; returns a near-constant FIRST draw for a small modulus: seeded per run,
;; this generator's first draw (which becomes row 1's, `.vscode/settings.json`
;; - the only two-key settings row) landed on :absent in 57 of 60 runs and
;; NEVER on :stale or :unreadable, at every run count, structurally. The
;; per-row-1 floor below is what catches a future reseeding reintroducing
;; this; the distribution is no longer merely hoped to decorrelate.
(def rng (make-rng 20260822))
(def first-row-id (:id (first host-switchover-doctor-lib/default-inventory)))

(doseq [run-index (range runs)]
  (let [root (str (fs/path temp-root (str "run-" run-index)))
        {:keys [repo-root env states]} (build-host! root rng)
        before (fingerprint root)
        result (host-switchover-doctor-lib/run-doctor {:repo-root repo-root :env env})
        after (fingerprint root)
        where (str "run " run-index " " (pr-str states))]

    ;; ── invariant 1: the doctor never writes ─────────────────────────────
    (check! (str where ": the doctor changed the tree it inspected")
            (= before after))

    ;; ── invariant 2: one entry per declared check, one verdict each ──────
    (check! (str where ": the report is not one entry per declared location")
            (= (count host-switchover-doctor-lib/default-inventory) (count (:findings result))))
    (check! (str where ": a location was reported twice")
            (= (count (:findings result)) (count (set (map :id (:findings result))))))
    (check! (str where ": the report and the inventory name different locations")
            (= (set (map :id host-switchover-doctor-lib/default-inventory))
               (set (map :id (:findings result)))))
    (doseq [f (:findings result)]
      (check! (str where ": " (:id f) " carries no verdict from the declared set: " (:verdict f))
              (contains? #{:ok :stale :missing :blocked} (:verdict f)))
      (bump! (:verdict f))

      ;; ── invariant 3: a non-OK finding is actionable ───────────────────
      (when-not (= :ok (:verdict f))
        (check! (str where ": " (:id f) " is not OK and names no concrete location")
                (not (str/blank? (:path f))))
        (if (str/blank? (:remediation f))
          (check! (str where ": " (:id f) " is not OK and names no remediation") false)
          (check! (str where ": the report a human reads drops " (:id f) "'s remediation")
                  (str/includes? (host-switchover-doctor-lib/format-report result)
                                 (:remediation f))))))

    ;; A per-row-1 floor, not merely an aggregate one: 60 draws spread over 7
    ;; rows still pass the AGGREGATE :stale/:unreadable floors even if row 1
    ;; specifically never lands on either - the aggregate floors measure reach
    ;; over the whole run, not reach at one draw POSITION, so a pin at
    ;; position 1 is invisible to them by construction (this is what let the
    ;; original per-run reseed slip through).
    (bump! (keyword (str "row1-" (name (states first-row-id)))))

    ;; ── the generated state IS the oracle ────────────────────────────────
    ;; Structural invariants alone would let a location the generator made
    ;; STALE come back OK - the exact shape a prefix comparison with no
    ;; separator produces, which is why the stale roots are near misses.
    (doseq [row host-switchover-doctor-lib/default-inventory
            :let [f (first (filter #(= (:id row) (:id %)) (:findings result)))
                  expected (expected-verdict row (states (:id row)))]]
      (bump! (keyword (str "oracle-" (name expected))))
      (check! (str where ": " (:id row) " was generated " (states (:id row))
                   " and reported " (:verdict f) ", expected " expected)
              (= expected (:verdict f))))

    ;; Exit code agrees with the findings, always.
    (check! (str where ": the exit code disagrees with the findings")
            (= (if (every? #(= :ok (:verdict %)) (:findings result)) 0 1)
               (host-switchover-doctor-lib/exit-code result)))))

;; ── reach, asserted rather than hoped for ─────────────────────────────────

(defn floor! [k min-count]
  (let [seen (get @reached k 0)]
    (when (< seen min-count)
      (fail! (str "generator reach: " k " was produced " seen " times, needed >= " min-count
                  ". A property that never reaches a state proves nothing about it.")))))

(floor! :ok 20)
(floor! :stale 10)
(floor! :missing 10)
(floor! :blocked 10)
(floor! :oracle-ok 20)
(floor! :oracle-stale 10)
(floor! :oracle-missing 10)
(floor! :oracle-blocked 10)
;; Per-row-1 floors: row 1 (.vscode/settings.json) is the only two-key
;; settings row, so its STALE/BLOCKED coverage cannot be substituted by any
;; other row - a defect in how a two-key row decides STALE, or its BLOCKED
;; read, is invisible unless THIS row itself reaches those states.
(floor! :row1-healthy 3)
(floor! :row1-absent 3)
(floor! :row1-stale 3)
(floor! :row1-unreadable 3)

(if (empty? @failures)
  (println (str "bl1057_host_switchover_doctor_property (BL-1057): ALL " runs " RUNS PASSED "
                (pr-str @reached)))
  (do (println (str "bl1057_host_switchover_doctor_property (BL-1057): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))

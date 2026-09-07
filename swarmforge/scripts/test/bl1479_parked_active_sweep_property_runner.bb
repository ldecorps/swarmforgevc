#!/usr/bin/env bb
;; BL-1479 coder pass (BL-654 Invariants): PROPERTY tests over
;; chase_sweep_lib.bb's parked-active-items/park-ticket! encoding the
;; ticket's declared invariants against the REAL functions, never a
;; reimplementation.
;;
;;   Invariant 1: "After every sweep, every ticket in backlog/active/
;;   either can advance ... or has a parcel in some role's mailbox
;;   ... the sweep is the only writer that moves active/ to paused/ and
;;   it never moves anything else." P1 draws a random set of tickets, each
;;   independently blocked/not_before-gated/plain and independently
;;   carrying live mail or not, and asserts: a ticket ends up in :to-park
;;   if and only if it has a condition AND no live mail; every OTHER
;;   ticket (can-advance, or condition-but-live-mail) is untouched -
;;   absent from :to-park entirely.
;;
;;   Invariant 3 (its core, testable half): "A ticket with a parcel in any
;;   mailbox is never parked, whatever its status." Same P1 draw already
;;   proves this - a ticket with live mail NEVER appears in :to-park
;;   regardless of its condition - asserted as its own explicit check
;;   (invariant 3's own wording, not folded silently into invariant 1's).
;;
;;   Invariant 2: "A park changes a ticket's directory and nothing else:
;;   the YAML bytes and filename are preserved." P2 builds a REAL mkdtemp
;;   git repo (BL-1390), writes a ticket YAML with randomized extra
;;   content (bounce_history, notes, approval_context - the exact fields
;;   invariant 2 names as needing to survive), parks it through the REAL
;;   park-ticket!, and asserts the paused/ copy is byte-identical to the
;;   pre-park content and the filename is unchanged.
;;
;; Same deterministic-seeded-LCG shape as this repo's other bb property
;; runners. Never `rand`, never a real clock (today is always injected).
;;
;; Non-vacuity proven by hand at authoring time: (1) parked-active-items
;; with the live-mail check removed (every conditioned ticket parked
;; regardless) failed P1 on the first live-mail-bearing case generated;
;; (2) park-ticket! with an extra `(spit (str paused-file) "mutated")`
;; appended after the git mv failed P2 on the very first run (byte
;; comparison). Both restored.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "chase_sweep_lib.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 40))
(def failures (atom []))

(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])

(defn- report! [prop seed input msg]
  (swap! failures conj (str "FAIL " prop "\n  seed:  " seed "\n  input: " (pr-str input) "\n  " msg)))

(defn- check-all [prop gen-fn pred-fn]
  (loop [i 0 s 1479]
    (when (< i runs)
      (let [[input s'] (gen-fn s)
            result (pred-fn input)]
        (when-not (true? result)
          (report! prop s input (str result)))
        (recur (inc i) s')))))

(defn- sweep-coverage [seed0 gen-fn extract-fn]
  (loop [i 0 s seed0 acc []]
    (if (= i runs) acc (let [[in s'] (gen-fn s)] (recur (inc i) s' (conj acc (extract-fn in)))))))

(def ^:private today "2026-09-07")

;; ── P1: invariants 1 and 3 ────────────────────────────────────────────────

(def CONDITION-KINDS [:none :blocked :future-not-before])

(defn gen-p1 [s]
  (let [[n s1] (gen-int s 8)
        n-tickets (+ 2 n)]
    (loop [i 0 acc [] sx s1]
      (if (= i n-tickets)
        [acc sx]
        (let [[kind-idx s2] (gen-int sx (count CONDITION-KINDS))
              [live? s3] (gen-int s2 2)]
          (recur (inc i)
                 (conj acc {:id (str "BL-" (+ 9000 i))
                            :kind (nth CONDITION-KINDS kind-idx)
                            :live? (= 1 live?)})
                 s3))))))

(defn- p1-candidate [{:keys [id kind]}]
  {:id id
   :status (if (= kind :blocked) "blocked" "todo")
   :content (str "id: " id "\nstatus: " (if (= kind :blocked) "blocked" "todo") "\n"
                 (when (= kind :future-not-before) "not_before: 2099-01-01\n"))
   :file (str id "-x.yaml")})

(defn- p1-case [tickets]
  (let [candidates (mapv p1-candidate tickets)
        live-ids (set (map :id (filter :live? tickets)))
        {:keys [to-park refused]} (chase-sweep-lib/parked-active-items candidates live-ids today)
        parked-ids (set (map :id to-park))
        refused-ids (set (map :id refused))
        violation
        (some
         (fn [{:keys [id kind live?]}]
           (let [has-condition? (not= kind :none)]
             (cond
               (and has-condition? (not live?) (not (contains? parked-ids id)))
               (str id ": has a condition and no live mail, but was not parked")

               (and (not has-condition?) (contains? parked-ids id))
               (str id ": can advance (no condition) but was parked anyway")

               (and live? (contains? parked-ids id))
               (str id ": HAS LIVE MAIL but was parked (invariant 3 violated)")

               (and has-condition? live? (not (contains? refused-ids id)))
               (str id ": has a condition and live mail, but was not reported as refused")

               :else nil)))
         tickets)]
    (if violation violation true)))

(check-all "P1: parked iff (condition AND no live mail); never parked with live mail (invariants 1 & 3)" gen-p1 p1-case)

;; ── P2: invariant 2 (byte-identical rename) ────────────────────────────────

(defn- sh! [dir & args]
  (let [{:keys [exit out err]} (apply process/sh {:dir (str dir) :continue true} args)]
    {:exit exit :out (str/trim (or out "")) :err (str/trim (or err ""))}))

(defmacro with-git-fixture [[root-sym] & body]
  `(let [~root-sym (str (fs/create-temp-dir {:prefix "bl1479-prop-git-"}))]
     (try
       (sh! ~root-sym "git" "init" "-q" "-b" "main" ".")
       (sh! ~root-sym "git" "config" "user.email" "t@t")
       (sh! ~root-sym "git" "config" "user.name" "t")
       (sh! ~root-sym "git" "config" "commit.gpgsign" "false")
       (fs/create-dirs (fs/path ~root-sym "backlog" "active"))
       (fs/create-dirs (fs/path ~root-sym "backlog" "paused"))
       ~@body
       (finally (fs/delete-tree ~root-sym)))))

(def EXTRA-FIELD-POOL
  ["bounce_history:\n  - { at: 2026-08-30, by: architect, blamed: coder }\n"
   "notes: |\n  some free-form prose\n  across two lines\n"
   "approval_context: >\n  a folded block\n"
   "human_approval: approved\n"
   "depends_on: [BL-1, BL-2]\n"])

(defn gen-p2 [s]
  (let [[n s1] (gen-int s (inc (count EXTRA-FIELD-POOL)))]
    (loop [i 0 acc [] sx s1]
      (if (= i n)
        [acc sx]
        (let [[idx sy] (gen-int sx (count EXTRA-FIELD-POOL))]
          (recur (inc i) (conj acc (nth EXTRA-FIELD-POOL idx)) sy))))))

(defn- p2-case [extra-fields]
  (with-git-fixture [root]
    (let [content (str "id: BL-9001\ntitle: \"generated\"\nstatus: blocked\npriority: 5\n"
                        (apply str extra-fields))
          active-file (fs/path root "backlog" "active" "BL-9001-x.yaml")]
      (spit (str active-file) content)
      (sh! root "git" "add" "-A")
      (sh! root "git" "commit" "-q" "-m" "seed")
      (let [result (chase-sweep-lib/park-ticket! root {:id "BL-9001" :file active-file :condition "status: blocked"})
            paused-file (fs/path root "backlog" "paused" "BL-9001-x.yaml")]
        (cond
          (not (:success result))
          (str "park-ticket! failed: " (:reason result))

          (fs/exists? active-file)
          "the file still exists in active/ after a successful park"

          (not (fs/exists? paused-file))
          "the file does not exist in paused/ after a successful park"

          (not= content (slurp (str paused-file)))
          (str "content diverged: expected " (pr-str content) " got " (pr-str (slurp (str paused-file))))

          :else true)))))

(check-all "P2: a park preserves the YAML bytes and filename exactly (invariant 2)" gen-p2 p2-case)

;; ── generator coverage (asserted reachability floors) ────────────────────

(let [p1-inputs (sweep-coverage 1479 gen-p1 identity)
      all-tickets (apply concat p1-inputs)
      floor (quot runs 10)
      buckets {:none (count (filter #(= :none (:kind %)) all-tickets))
               :blocked (count (filter #(= :blocked (:kind %)) all-tickets))
               :future-not-before (count (filter #(= :future-not-before (:kind %)) all-tickets))
               :live (count (filter :live? all-tickets))
               :not-live (count (remove :live? all-tickets))}]
  (println (str "  generator coverage: " (pr-str buckets)))
  (doseq [[k v] buckets]
    (when (< v floor)
      (report! (str "COVERAGE " k) 1479 buckets (str k " barely exercised: " v " <= floor " floor)))))

;; ── report ────────────────────────────────────────────────────────────────

(println (str "bl1479 parked-active-sweep properties: " runs " runs"))
(if (empty? @failures)
  (println "ALL PROPERTIES HOLD")
  (do (println (str (count @failures) " PROPERTY FAILURE(S):"))
      (doseq [f (take 15 @failures)] (println f))
      (System/exit 1)))

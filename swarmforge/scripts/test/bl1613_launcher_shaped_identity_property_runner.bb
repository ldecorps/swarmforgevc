#!/usr/bin/env bb
;; BL-1613: PROPERTY test covering the ticket YAML's one declared invariant
;; (coder-authored first, per BL-654):
;;
;;   "The fixture is a swarm root the launcher could have made: every key
;;    backlog_depth_lib.bb reads from a swarm-identity is present and names
;;    a file that exists under the fixture root before the first claim
;;    runs."
;;
;; The required key set is derived from the REAL committed
;; backlog_depth_lib.bb source (a regex over its own text), never a
;; hand-maintained duplicate list that could silently drift from it if that
;; library ever reads a second key. launcher-shaped? below is the pure
;; predicate the invariant states; the generative part varies which keys a
;; candidate identity carries and whether the files they name exist, over
;; real mkdtemp roots (this predicate does real filesystem IO, so no
;; in-memory fixture can stand in dishonestly for a filesystem question).
;; The final section applies the SAME predicate to a byte-identical replay
;; of this ticket's own before/after fixture text, closing the loop between
;; the generic property and the concrete deliverable.

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def SCRIPT-DIR (str (fs/parent (fs/canonicalize *file*))))
(def SCRIPTS-DIR (str (fs/path SCRIPT-DIR "..")))

(defn- required-identity-keys []
  (let [src (slurp (str (fs/path SCRIPTS-DIR "backlog_depth_lib.bb")))]
    (->> (re-seq #"read-swarm-identity[\s\S]{0,120}?\"([a-zA-Z0-9_]+)\"" src)
         (map second)
         distinct
         vec)))

(defn- launcher-shaped?
  "The invariant itself: every required key is present in root's
   .swarmforge/swarm-identity and names a file that exists under root."
  [root keys]
  (let [identity-file (fs/path root ".swarmforge" "swarm-identity")]
    (and (fs/exists? identity-file)
         (let [rows (into {}
                          (comp (remove str/blank?)
                                (map #(str/split % #"\t" 2)))
                          (str/split-lines (slurp (str identity-file))))]
           (every? (fn [k]
                     (let [v (get rows k)]
                       (and (not (str/blank? v))
                            (fs/exists? (fs/path root v)))))
                   keys)))))

(defn- write-identity! [root rows]
  (fs/create-dirs (fs/path root ".swarmforge"))
  (spit (str (fs/path root ".swarmforge" "swarm-identity"))
        (str/join "\n" (map (fn [[k v]] (str k "\t" v)) rows))))

(def failures (atom []))
(defn- assert-true [msg expr]
  (when-not expr (swap! failures conj (str "FAIL: " msg))))

(def KEYS (required-identity-keys))
(assert-true "the source-derived key set is non-empty (a regex miss would silently test nothing)"
             (seq KEYS))

(def branches-hit (atom #{}))

(defn- with-temp-root [f]
  (let [root (str (fs/create-temp-dir {:prefix "bl1613-prop-"}))]
    (try (f root) (finally (fs/delete-tree root)))))

;; Shape A: every required key present, every named file exists -> true.
(with-temp-root
 (fn [root]
   (doseq [k KEYS]
     (spit (str (fs/path root (str k ".conf"))) "")
     )
   (write-identity! root (for [k KEYS] [k (str k ".conf")]))
   (swap! branches-hit conj :complete)
   (assert-true "shape A (every key present, file exists) is launcher-shaped"
                (launcher-shaped? root KEYS))))

;; Shape B: a required key missing entirely -> false (only when KEYS is
;; non-empty; a lib with no read keys would make this vacuous, guarded by
;; the source-derived-keys assertion above).
(when (seq KEYS)
  (with-temp-root
   (fn [root]
     (let [missing (first KEYS)
           rest-keys (rest KEYS)]
       (doseq [k rest-keys]
         (spit (str (fs/path root (str k ".conf"))) ""))
       (write-identity! root (for [k rest-keys] [k (str k ".conf")]))
       (swap! branches-hit conj :missing-key)
       (assert-true (str "shape B (key " missing " absent) is NOT launcher-shaped")
                    (not (launcher-shaped? root KEYS)))))))

;; Shape C: every key present, but the file one of them names does not
;; exist -> false.
(with-temp-root
 (fn [root]
   (write-identity! root (for [k KEYS] [k (str k ".conf")]))
   ;; deliberately never create the files
   (swap! branches-hit conj :missing-file)
   (assert-true "shape C (key present, named file absent) is NOT launcher-shaped"
                (not (launcher-shaped? root KEYS)))))

;; Shape D: complete identity plus unrelated noise rows -> still true (noise
;; never breaks a genuinely complete identity).
(with-temp-root
 (fn [root]
   (doseq [k KEYS] (spit (str (fs/path root (str k ".conf"))) ""))
   (write-identity! root (concat (for [k KEYS] [k (str k ".conf")])
                                  [["swarm_name" "primary"] ["swarm_mode" "autonomous"]]))
   (swap! branches-hit conj :noise-tolerant)
   (assert-true "shape D (complete identity plus unrelated rows) is still launcher-shaped"
                (launcher-shaped? root KEYS))))

(assert-true "the generator reached every shape: complete, a missing key, a missing file, and noise-tolerance"
             (and (contains? @branches-hit :complete)
                  (contains? @branches-hit :missing-key)
                  (contains? @branches-hit :missing-file)
                  (contains? @branches-hit :noise-tolerant)))

;; ── Non-vacuousness, tied to this ticket's own concrete fixture ──────────
;; The pre-fix and post-fix swarm-identity text this ticket's own commit
;; changed in test_branch_claim_guard.sh, replayed byte-for-byte (never
;; re-derived by hand) against the SAME predicate above.
(def PRE-FIX-IDENTITY "swarm_name\tprimary\nswarm_mode\tautonomous\n")
(def POST-FIX-IDENTITY
  "swarm_name\tprimary\nswarm_mode\tautonomous\nactive_backlog_max_depth_conf_path\tswarmforge/swarmforge.conf\n")

(with-temp-root
 (fn [root]
   (fs/create-dirs (fs/path root ".swarmforge"))
   (spit (str (fs/path root ".swarmforge" "swarm-identity")) PRE-FIX-IDENTITY)
   (assert-true "non-vacuousness: the PRE-FIX fixture identity is NOT launcher-shaped (the bug this ticket fixes)"
                (not (launcher-shaped? root KEYS)))))

(with-temp-root
 (fn [root]
   (fs/create-dirs (fs/path root ".swarmforge" ))
   (spit (str (fs/path root ".swarmforge" "swarm-identity")) POST-FIX-IDENTITY)
   (fs/create-dirs (fs/path root "swarmforge"))
   (spit (str (fs/path root "swarmforge" "swarmforge.conf")) "")
   (assert-true "non-vacuousness: the POST-FIX fixture identity IS launcher-shaped"
                (launcher-shaped? root KEYS))))

(if (seq @failures)
  (do
    (binding [*out* *err*]
      (doseq [f @failures] (println f)))
    (println (str "\n" (count @failures) " property failure(s)"))
    (System/exit 1))
  (println (str "ALL PROPERTIES HOLD: launcher-shaped-identity (BL-1613), keys=" (pr-str KEYS))))

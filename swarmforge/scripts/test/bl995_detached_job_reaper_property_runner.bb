#!/usr/bin/env bb
;; BL-995 declared invariants, coder-first (BL-654). Generative sweep
;; driving the REAL detach_job.sh and the REAL handoffd_supervisor.bb reap
;; function (loaded with a fixture root, the bl977 stop-file pattern) over
;; random mixes of real detached/orphaned processes:
;;
;;   Invariant 1 (BL-108 never weakened): a genuinely crash-orphaned job -
;;     double-forked, setsid'd, NEVER registered - is still reaped,
;;     whichever of the reaper pattern's FIVE argv alternatives it wears
;;     (stryker / node --test / vitest.properties.config.mjs / npm exec
;;     vitest / npx vitest). Alternatives are assigned round-robin, so
;;     every alternative is exercised by construction, not by hope
;;     (the ticket's qa_e2e step 3 warns a vitest-only check would pass a
;;     lookup wired into one code path of five).
;;   Invariant 2 (registration is not immunity): a job detached and
;;     registered the sanctioned way whose registration is already past
;;     its expiry (--expires-minutes 0, the real CLI path) is reaped like
;;     any orphan, AND its registry entry is removed by that same sweep -
;;     the next sweep can never re-read a stale entry.
;;   Invariant 3 (a killed job is never silent to its owner): after every
;;     invariant-2 kill, the run's OWN log - the artifact its owner
;;     collects - names the reaping (the supervisor's REAPED notice and/or
;;     the detach wrapper's KILLED-by-SIGTERM trap line) and points at the
;;     supervisor log.
;;
;;   Headline behavior (the fix itself, guarded here as well as in the
;;   acceptance feature): a registered, UNEXPIRED detach survives the
;;   sweep untouched.
;;
;; Each round builds ONE fixture root (git repo + .swarmforge/daemon/stop +
;; roles.tsv naming the fixture root, so job-in-scope? confines the sweep
;; to fixture processes and the sweep can never touch the live swarm),
;; spawns one job of each class plus random extras, runs ONE real sweep,
;; then asserts every job's fate. Batching per round amortizes the ~40s a
;; single sweep costs on this host (the process-table scan, pre-existing).
;;
;; Reach floors (absolute, never scaled to runs - the
;; property-runner-reachability lesson): registered-live >= 4,
;; registered-expired >= 4, unregistered >= 5 with ALL FIVE argv
;; alternatives seen. Default 5 rounds meets every floor by construction;
;; BL995_ROUNDS=1 exists for the non-vacuity break runs, whose floor
;; misses print as REACH-FLOOR-MISS, distinct from PROPERTY-FAIL.
;;
;; Non-vacuity (staged-first restore, run 2026-08-20, recorded in the
;; parcel commit):
;;   - break 1 (inv 1): reaper spares unregistered orphans too ->
;;     unregistered draws RED, expired draws stay green.
;;   - break 2 (inv 2): expiry check ignored (registration = immunity) ->
;;     expired draws RED (survive; entry never removed), unregistered
;;     draws stay green.
;;   - break 3 (inv 3): supervisor's append-reap-notice! muted AND the
;;     detach wrapper's TERM trap dropped -> expired draws die but their
;;     logs are silent -> invariant-3 checks RED, kill checks stay green.

(require '[babashka.fs :as fs]
         '[babashka.process :as process]
         '[clojure.string :as str])

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def supervisor (str (fs/path scripts-dir "handoffd_supervisor.bb")))
(def detach-sh (str (fs/path scripts-dir "detach_job.sh")))

(def rounds (or (some-> (System/getenv "BL995_ROUNDS") parse-long) 5))
(def rng (java.util.Random. (System/nanoTime)))
(defn rand-int* [n] (.nextInt rng n))
(defn rand-nth* [xs] (nth xs (rand-int* (count xs))))

(def run-id (str "bl995p" (Long/toHexString (System/nanoTime))))
(def failures (atom []))
(def coverage (atom {:live 0 :expired 0 :unregistered 0}))
(def alts-seen (atom #{}))
(defn fail! [msg] (swap! failures conj msg) (println "PROPERTY-FAIL:" msg))

;; The five argv alternatives of the reaper's job-process-pattern. Each
;; probe process is exec -a renamed so its cmdline wears one alternative
;; plus a unique marker; the trailing sleep is the real process being
;; spared or killed.
(def argv-alternatives
  ["stryker run"
   "node --test batch"
   "npx vitest run --config vitest.properties.config.mjs"
   "npm exec vitest run"
   "npx vitest run"])

(def work (str (fs/create-temp-dir {:prefix "bl995-prop-"})))
(-> (Runtime/getRuntime)
    (.addShutdownHook
     (Thread. (fn []
                ;; raw ProcessBuilder: process/sh needs bb's executor, which
                ;; is already terminated inside a shutdown hook
                (try (.waitFor (.start (ProcessBuilder. ["pkill" "-f" run-id])))
                     (catch Exception _ nil))
                (when (fs/exists? work) (fs/delete-tree work))))))

(defn sh [opts & args] (apply process/sh (merge {:continue true} opts) args))

(defn mk-fixture-root [round]
  (let [root (str (fs/path work (str "round" round)))]
    (fs/create-dirs root)
    (sh {:dir root} "git" "init" "-q")
    (sh {:dir root} "git" "-c" "user.email=t@t" "-c" "user.name=t"
        "commit" "-q" "--allow-empty" "-m" "seed")
    (fs/create-dirs (fs/path root ".swarmforge" "daemon"))
    (spit (str (fs/path root ".swarmforge" "daemon" "stop")) "")
    (spit (str (fs/path root ".swarmforge" "roles.tsv"))
          (str "coder\tcoder\t" root "\tswarmforge-coder\tX\tclaude\ttask\n"))
    root))

(defn job-cmd [alt marker]
  (str "exec -a \"" alt " " marker "\" sleep 300"))

(defn detach! [root log expires-min alt marker]
  (let [res (sh {:dir root :extra-env {"SWARMFORGE_ROLE" "coder"}}
                "bash" detach-sh log "--expires-minutes" (str expires-min)
                "--" "bash" "-c" (job-cmd alt marker))]
    (when-not (zero? (:exit res))
      (fail! (str "detach_job.sh failed for " marker ": " (:err res))))))

(defn raw-orphan! [root alt marker]
  (let [py (str "import os\n"
                "if os.fork(): os._exit(0)\n"
                "os.setsid()\n"
                "if os.fork(): os._exit(0)\n"
                ;; drop the inherited pipes or process/sh blocks slurping
                ;; them until the orphan dies - the same hygiene
                ;; detach_job.sh applies
                "d = os.open(os.devnull, os.O_RDWR)\n"
                "os.dup2(d, 0); os.dup2(d, 1); os.dup2(d, 2)\n"
                "os.chdir(" (pr-str root) ")\n"
                "os.execvp('bash', ['bash', '-c', " (pr-str (job-cmd alt marker)) "])\n")
        res (sh {:dir root} "python3" "-c" py)]
    (when-not (zero? (:exit res))
      (fail! (str "raw orphan setup failed for " marker ": " (:err res))))))

(defn marker-alive? [marker]
  (zero? (:exit (sh {} "pgrep" "-f" marker))))

(defn wait-marker [marker present? timeout-ms]
  (loop [waited 0]
    (cond
      (= present? (marker-alive? marker)) true
      (>= waited timeout-ms) false
      :else (do (Thread/sleep 250) (recur (+ waited 250))))))

(defn sweep! [root]
  (let [expr (str "(binding [*command-line-args* [" (pr-str root) "]]"
                  "  (load-file " (pr-str supervisor) "))"
                  "(handoffd-supervisor/reap-orphaned-job-processes!)"
                  "(println :done)")
        res (sh {} "bb" "-e" expr)]
    (when-not (zero? (:exit res))
      (fail! (str "sweep failed: " (:err res))))))

(defn registry-entries [root]
  (let [dir (fs/path root ".swarmforge" "daemon" "detached-jobs")]
    (if (fs/exists? dir)
      (filter #(str/ends-with? (str %) ".json") (fs/list-dir dir))
      [])))

;; One job of every class per round (reach by construction), plus 0-2
;; random extras for draw variance. UNREGISTERED draws get a dedicated
;; round-robin over the five argv alternatives - five such draws cover all
;; five by construction, never by hope; other classes draw randomly.
(def unreg-alt-cursor (atom -1))
(defn next-alt [class]
  (if (= class :unregistered)
    (nth argv-alternatives (mod (swap! unreg-alt-cursor inc) (count argv-alternatives)))
    (rand-nth* argv-alternatives)))

(doseq [round (range rounds)]
  (let [root (mk-fixture-root round)
        base [:live :unregistered :expired]
        extras (repeatedly (rand-int* 3) #(rand-nth* base))
        classes (shuffle (concat base extras))
        jobs (map-indexed
              (fn [i class]
                (let [marker (str run-id "-r" round "j" i)
                      alt (next-alt class)]
                  {:class class :marker marker :alt alt
                   :log (str (fs/path root (str "job" i ".log")))}))
              classes)]
    (println (str "round " round ": " (str/join " " (map :class jobs)))) (flush)
    (doseq [{:keys [class marker alt log]} jobs]
      (swap! coverage update class inc)
      (case class
        :live (detach! root log (+ 30 (rand-int* 90)) alt marker)
        :expired (detach! root log 0 alt marker)
        :unregistered (do (swap! alts-seen conj alt)
                          (raw-orphan! root alt marker)))
      (println (str "  spawned " (name class) " " marker)) (flush))
    (doseq [{:keys [marker class]} jobs]
      (when-not (wait-marker marker true 10000)
        (fail! (str "setup: " (name class) " job " marker " never became visible"))))
    (println "  all visible; sweeping") (flush)
    (sweep! root)
    (println "  sweep done; asserting fates") (flush)
    (doseq [{:keys [class marker log]} jobs]
      (case class
        :live
        (when-not (marker-alive? marker)
          (fail! (str "headline: registered unexpired detach " marker
                      " did not survive the sweep")))
        :unregistered
        (when-not (wait-marker marker false 8000)
          (fail! (str "invariant 1: unregistered crash-orphan " marker
                      " survived the sweep")))
        :expired
        (do
          (when-not (wait-marker marker false 8000)
            (fail! (str "invariant 2: expired registration " marker
                        " survived the sweep")))
          (let [entries (map str (registry-entries root))
                ;; the entry for THIS job names its log path
                stale (filter #(str/includes? (slurp %) (fs/file-name log)) entries)]
            (when (seq stale)
              (fail! (str "invariant 2: expired entry for " marker
                          " still in the registry after the sweep"))))
          (let [content (if (fs/exists? log) (slurp log) "")]
            (when-not (and (re-find #"REAPED|KILLED by SIGTERM" content)
                           (str/includes? content "handoffd"))
              (fail! (str "invariant 3: reaped run " marker
                          "'s own log does not name the reaping:\n" content)))))))
    ;; round teardown: kill this round's survivors before the next round
    (doseq [{:keys [marker]} jobs] (sh {} "pkill" "-f" marker))))

(let [{:keys [live expired unregistered]} @coverage
      floor-miss (fn [msg] (println "REACH-FLOOR-MISS:" msg))]
  (println (str "coverage live=" live " expired=" expired
                " unregistered=" unregistered
                " alternatives=" (count @alts-seen) "/5"))
  (when (< live 4) (floor-miss (str "live " live " < 4")))
  (when (< expired 4) (floor-miss (str "expired " expired " < 4")))
  (when (< unregistered 5) (floor-miss (str "unregistered " unregistered " < 5")))
  (when (< (count @alts-seen) 5)
    (floor-miss (str "argv alternatives " (count @alts-seen) "/5")))
  (if (and (empty? @failures)
           (>= live 4) (>= expired 4) (>= unregistered 5)
           (= 5 (count @alts-seen)))
    (println "ALL PROPERTIES HOLD")
    (do (println (count @failures) "property failure(s)")
        (System/exit 1))))

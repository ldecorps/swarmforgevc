#!/usr/bin/env bb
;; BL-976 coder pass (BL-654 Invariants): PROPERTY test encoding declared
;; invariant 2 - "The key's VALUE never enters the repository or the logs:
;; no tracked file, no commit, and no log line produced by launch or sweep
;; ever contains it."
;;
;; Per generated key value: writes a fixture operator env file, runs the
;; REAL start_handoff_daemon.sh (through its HANDOFFD_BB/
;; HANDOFFD_SUPERVISOR_BB stub seams, launch shell keyless), then runs one
;; keyed sweep generation through bl976_email_keyless_harness.bb with the
;; SAME generated key injected (BL976_FIXTURE_KEY) - and scans every file
;; the launch/sweep produced, plus both captured stdouts, for the value.
;; The ONLY permitted holder is the operator env file itself. Repo-side,
;; the fixture root is outside the repository and nothing here commits -
;; the tracked-file half is enforced by construction and re-checked by the
;; scan (a leak into any file would fail regardless of tracking).
;;
;; Key generator classes (the BL-654 collision-construction requirement -
;; derive one side from the other, never draw independently):
;;   :hex / :alnum / :specials - realistic key shapes, varied lengths
;;   :collision-derived - keys BUILT FROM strings the produced logs are
;;     known to contain ("RESEND_API_KEY", "daemon.env", the launcher's own
;;     name, the fixture root path) so a scan bug that normalizes,
;;     truncates, or anchors matches - or an echo bug that logs "key=<val>"
;;     next to those same words - is caught by construction, not by luck.
;;
;; Same seeded-LCG convention as this directory's other *_property_runner.bb
;; files: deterministic, never rand. The BL-992 D1 bounce class (reseeding
;; runner missing its own reach floors on a bare run) cannot occur - the
;; fixed seed makes every reach count identical on every run, and the
;; floors below are asserted against exactly that fixed set. The default of
;; 24 draws is sized by per-draw COST (each draw runs the real launcher,
;; ~2s), not by coverage risk: coverage is seed-fixed, floors verified.
;;
;; Non-vacuity proven by hand at authoring time (BL-654): temporarily added
;;   audit "sourced key=${RESEND_API_KEY:-}"
;; after the launcher's env file sourcing. The FIRST run of that break
;; passed the leak scan - fs/glob's default skips dot-directories, so the
;; entire .swarmforge/ tree (every log this invariant polices) was
;; invisible to the scan; {:hidden true} in scan-for-leak fixes it and is
;; commented load-bearing there. With the scan fixed, every draw failed
;; naming daemon-start-audit.log; the break was then removed and all
;; draws pass. (The vacuous first result is the strongest argument this
;; directory's break-then-fix convention exists.)

(ns bl976-key-value-never-logged-property-runner
  (:require [babashka.fs :as fs]
            [babashka.process :as p]
            [clojure.string :as str]))

(def script-dir (str (fs/parent (fs/canonicalize *file*))))
(def scripts-dir (str (fs/parent script-dir)))
(def launcher (str (fs/path scripts-dir "start_handoff_daemon.sh")))
(def alarm-lib (str (fs/path scripts-dir "daemon_alarm_lib.bb")))
(def harness (str (fs/path script-dir "bl976_email_keyless_harness.bb")))

(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 24))
(def failures (atom []))
(def class-counts (atom {}))

;; ── BL-971: sweep leftovers from any prior killed run FIRST ──────────────
(let [tmp (or (System/getenv "TMPDIR") (System/getProperty "java.io.tmpdir") "/tmp")]
  (doseq [d (fs/glob tmp "bl976-kvprop-*")]
    (fs/delete-tree d)))

;; ── seeded generator (mirrors this directory's other property runners) ───
(defn- step [s] (mod (+ (* s 1103515245) 12345) 2147483648))
(defn- gen-int [s n] [(mod (quot s 65536) n) (step s)])
(defn- gen-pick [s coll] (let [[i s'] (gen-int s (count coll))] [(nth (vec coll) i) s']))

(def hex-chars "0123456789abcdef")
(def alnum-chars "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
(def special-chars "ABCDEFabcdef0123456789+/=._-")

(defn- gen-string [s chars len]
  (loop [i 0 s s acc []]
    (if (= i len)
      [(apply str acc) s]
      (let [[c s'] (gen-pick s chars)]
        (recur (inc i) s' (conj acc c))))))

(defn- gen-key [s root]
  (let [[class s1] (gen-pick s [:hex :alnum :specials :collision-derived])
        [len s2] (gen-int s1 49)          ; 0..48 -> 16..64 below
        len (+ 16 len)]
    (case class
      :hex (let [[v s3] (gen-string s2 hex-chars len)] [[class v] s3])
      :alnum (let [[v s3] (gen-string s2 alnum-chars len)] [[class v] s3])
      :specials (let [[v s3] (gen-string s2 special-chars len)] [[class v] s3])
      :collision-derived
      (let [[stem s3] (gen-pick s2 ["RESEND_API_KEY" "daemon.env"
                                    "start_handoff_daemon" (str root)])
            [suffix s4] (gen-string s3 hex-chars 12)]
        [[class (str stem "-" suffix)] s4]))))

(defn- write-stubs! [stub-dir]
  (spit (str (fs/path stub-dir "handoffd_stub.bb"))
        (str "(require '[babashka.fs :as fs])\n"
             "(let [root (first *command-line-args*)\n"
             "      daemon-dir (fs/path root \".swarmforge\" \"daemon\")]\n"
             "  (fs/create-dirs daemon-dir)\n"
             "  (spit (str (fs/path daemon-dir \"handoffd.pid\"))\n"
             "        (str (.pid (java.lang.ProcessHandle/current)))))\n"
             "(Thread/sleep 3000)\n"))
  (spit (str (fs/path stub-dir "supervisor_stub.bb"))
        (str "(require '[babashka.fs :as fs])\n"
             "(let [root (first *command-line-args*)\n"
             "      daemon-dir (fs/path root \".swarmforge\" \"daemon\")]\n"
             "  (fs/create-dirs daemon-dir)\n"
             "  (spit (str (fs/path daemon-dir \"handoffd-supervisor.pid\"))\n"
             "        (str (.pid (java.lang.ProcessHandle/current)))))\n"
             "(Thread/sleep 3000)\n")))

(defn- kill-stubs! [root]
  (doseq [pf ["handoffd.pid" "handoffd-supervisor.pid"]]
    (let [f (fs/path root ".swarmforge" "daemon" pf)]
      (when (fs/exists? f)
        (when-let [pid (parse-long (str/trim (slurp (str f))))]
          (try (p/shell {:continue true :out :string :err :string} "kill" (str pid))
               (catch Exception _ nil)))))))

(defn- scan-for-leak
  "Every file under root except the env file itself, plus the captured
   outputs - returns the paths/labels whose content contains the key."
  [root env-file key-value & extra-outputs]
  ;; {:hidden true} is LOAD-BEARING: every log this invariant exists to
  ;; police lives under dot-dir .swarmforge/, which a default glob silently
  ;; skips - the authoring-time break-then-fix caught exactly that (a
  ;; deliberately leaking launcher passed the scan until :hidden was set).
  (let [file-hits (for [f (fs/glob root "**" {:hidden true})
                        :when (and (fs/regular-file? f)
                                   (not= (str (fs/canonicalize f)) (str (fs/canonicalize env-file)))
                                   (str/includes? (try (slurp (str f)) (catch Exception _ "")) key-value))]
                    (str f))
        extra-hits (for [[label content] (partition 2 extra-outputs)
                         :when (str/includes? (or content "") key-value)]
                     label)]
    (concat file-hits extra-hits)))

(defn- run-draw [[key-class key-value] root stub-dir]
  (let [env-file (fs/path root ".swarmforge" "operator" "daemon.env")
        conf (fs/path root "swarmforge.conf")
        briefings (fs/path root "briefings")
        base-env (dissoc (into {} (System/getenv)) "RESEND_API_KEY" "SWARMFORGE_CONFIG")]
    (fs/create-dirs (fs/parent env-file))
    (fs/create-dirs briefings)
    (spit (str conf) "config notify_email_to operator@example.com\n")
    (spit (str env-file) (str "RESEND_API_KEY=" key-value "\n"))
    (spit (str (fs/path briefings "2026-08-16.md")) "Headline: fixture\n\nBody.\n")
    (let [launch (p/shell {:continue true :out :string :err :string
                           :env (assoc base-env
                                       "HANDOFFD_BB" (str (fs/path stub-dir "handoffd_stub.bb"))
                                       "HANDOFFD_SUPERVISOR_BB" (str (fs/path stub-dir "supervisor_stub.bb")))}
                          "bash" launcher (str root))
          sweep (p/shell {:continue true :out :string :err :string
                          :env (assoc base-env "BL976_FIXTURE_KEY" key-value)}
                         "bb" harness (str briefings) "generation" "keyed" "1"
                         (str env-file) "2026-08-16")]
      (kill-stubs! root)
      (cond
        (not (zero? (:exit launch)))
        (str "launcher failed (" (:exit launch) "): " (:err launch))

        (not (zero? (:exit sweep)))
        (str "sweep harness failed (" (:exit sweep) "): " (:err sweep))

        :else
        (let [hits (scan-for-leak root env-file key-value
                                  "(launcher stdout)" (:out launch)
                                  "(launcher stderr)" (:err launch)
                                  "(sweep stdout)" (:out sweep)
                                  "(sweep stderr)" (:err sweep))]
          (if (seq hits)
            (str "key value (" (name key-class) ") leaked into: " (str/join ", " hits))
            true))))))

(loop [i 0 s 13]
  (when (< i runs)
    (let [root (fs/create-temp-dir {:prefix "bl976-kvprop-"})
          stub-dir (fs/path root "stubs")
          _ (fs/create-dirs stub-dir)
          _ (write-stubs! (str stub-dir))
          [[key-class key-value] s'] (gen-key s root)
          result (try (run-draw [key-class key-value] root (str stub-dir))
                      (catch Exception e (str "threw: " (.getMessage e)))
                      (finally (kill-stubs! root) (fs/delete-tree root)))]
      (swap! class-counts update key-class (fnil inc 0))
      (when-not (true? result)
        (swap! failures conj (str "FAIL key-value-never-logged\n  seed:  " s
                                  "\n  class: " key-class "\n  " result)))
      (recur (inc i) s'))))

;; ── generator reach floors (asserted; seed-fixed, identical every run) ───
(let [counts @class-counts
      floors {:hex 3 :alnum 3 :specials 3 :collision-derived 4}]
  (doseq [[class floor] floors]
    (let [n (get counts class 0)]
      (when (< n floor)
        (swap! failures conj
               (str "REACH FLOOR MISSED: class " (pr-str class) " reached " n
                    " of " runs " (floor " floor ")"))))))

(if (seq @failures)
  (do (doseq [f @failures] (println f))
      (println "FAILED:" (count @failures) "failure(s) across" runs "draws")
      (System/exit 1))
  (do (println "OK:" runs "draws, invariant 2 held; class coverage:" (pr-str @class-counts))
      (System/exit 0)))

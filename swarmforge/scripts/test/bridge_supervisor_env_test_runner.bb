#!/usr/bin/env bb
;; Pure tests for bridge_supervisor_env_lib.bb (swarm.env + ripgrep resolution).

(ns bridge-supervisor-env-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "bridge_supervisor_env_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn mk-fixture []
  (let [root (fs/create-temp-dir {:prefix "sfvc-bridge-env-"})
        env-file (fs/path root ".swarmforge" "swarm.env")]
    (fs/create-dirs (fs/parent env-file))
    (spit (str env-file) "export CURSOR_BRIDGE_MODEL=\"auto\"\nexport FOO=\"bar\"\n")
    (let [rg-path (fs/path root "extension" "node_modules" "@cursor" "sdk-linux-x64" "bin" "rg")]
      (fs/create-dirs (fs/parent rg-path))
      (spit (str rg-path) "#!/bin/sh\necho rg\n")
      (.setExecutable (fs/file rg-path) true false))
    root))

(let [root (mk-fixture)]
  (assert= "parse export lines"
           {"CURSOR_BRIDGE_MODEL" "auto" "FOO" "bar"}
           (bridge-supervisor-env-lib/load-swarm-env-file root))
  (assert= "resolve sdk rg"
           (str (fs/path root "extension" "node_modules" "@cursor" "sdk-linux-x64" "bin" "rg"))
           (bridge-supervisor-env-lib/resolve-ripgrep-path root))
  (let [child (bridge-supervisor-env-lib/bridge-child-env root {"TELEGRAM_BOT_TOKEN" "t"})]
    (assert= "child env includes swarm + extra"
             "auto"
             (get child "CURSOR_BRIDGE_MODEL"))
    (assert= "child env strips CURSOR_AGENT"
             nil
             (get child "CURSOR_AGENT"))
    (assert= "child env keeps injected token"
             "t"
             (get child "TELEGRAM_BOT_TOKEN"))))

(if (seq @failures)
  (do (doseq [f @failures] (println f)) (System/exit 1))
  (println "ALL PASS: bridge_supervisor_env_lib.bb"))

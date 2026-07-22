#!/usr/bin/env bb
(ns swarm-identity-lib-test-runner
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "swarm_identity_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(defn assert-true [msg expr]
  (when-not expr
    (swap! failures conj (str "FAIL: " msg))))

(defn assert-contains [msg hay needle]
  (when-not (str/includes? (str hay) (str needle))
    (swap! failures conj (str "FAIL: " msg " — missing " (pr-str needle)))))

(let [root "/tmp/swarm-identity-test"
      identity-path (fs/path root ".swarmforge" "swarm-identity")
      mono-conf (fs/path root "swarmforge/packs/openrouter-anthropic-mono-router.conf")
      default-conf (fs/path root "swarmforge/swarmforge.conf")]
  (fs/create-dirs (fs/parent identity-path))
  (fs/create-dirs (fs/parent mono-conf))
  (spit (str mono-conf) "config rotation router\nwindow coder claude coder\n")
  (spit (str default-conf) "config active_backlog_max_depth -1\nwindow coder claude coder\n")
  (spit (str identity-path)
        (str/join "\n"
                  ["launch_pack\topenrouter-anthropic-mono-router"
                   "rotation\trouter"
                   (str "active_backlog_max_depth_conf_path\t" mono-conf)])))

(assert= "conf rotation router" "router" (swarm-identity-lib/conf-rotation-mode
                                          (str (fs/path "/tmp/swarm-identity-test/swarmforge/packs/openrouter-anthropic-mono-router.conf"))))

(assert= "default conf has no rotation" nil (swarm-identity-lib/conf-rotation-mode
                                            (str (fs/path "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"))))

(assert-true "blocks bare default launch on mono-router project"
             (some? (swarm-identity-lib/accidental-full-pack-downgrade?
                     {:project-root "/tmp/swarm-identity-test"
                      :config-path "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"
                      :swarmforge-pack ""
                      :swarmforge-config ""
                      :explicit-pack-cli? false
                      :allow-full-pack? ""})))

(assert-true "allows explicit --pack"
             (nil? (swarm-identity-lib/accidental-full-pack-downgrade?
                    {:project-root "/tmp/swarm-identity-test"
                     :config-path "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"
                     :swarmforge-pack ""
                     :swarmforge-config ""
                     :explicit-pack-cli? true
                     :allow-full-pack? ""})))

(assert-true "blocks SWARMFORGE_CONFIG pointing at default swarmforge.conf"
             (some? (swarm-identity-lib/accidental-full-pack-downgrade?
                     {:project-root "/tmp/swarm-identity-test"
                      :config-path "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"
                      :swarmforge-pack ""
                      :swarmforge-config "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"
                      :explicit-pack-cli? false
                      :allow-full-pack? ""})))

(assert-true "allows SWARMFORGE_CONFIG pointing at a mono-router pack conf"
             (nil? (swarm-identity-lib/accidental-full-pack-downgrade?
                    {:project-root "/tmp/swarm-identity-test"
                     :config-path "/tmp/swarm-identity-test/swarmforge/packs/openrouter-anthropic-mono-router.conf"
                     :swarmforge-pack ""
                     :swarmforge-config "/tmp/swarm-identity-test/swarmforge/packs/openrouter-anthropic-mono-router.conf"
                     :explicit-pack-cli? false
                     :allow-full-pack? ""})))

(assert-true "allows SWARMFORGE_ALLOW_FULL_PACK"
             (nil? (swarm-identity-lib/accidental-full-pack-downgrade?
                    {:project-root "/tmp/swarm-identity-test"
                     :config-path "/tmp/swarm-identity-test/swarmforge/swarmforge.conf"
                     :swarmforge-pack ""
                     :swarmforge-config ""
                     :explicit-pack-cli? false
                     :allow-full-pack? "1"})))

(assert-true "allows when target config is also rotation"
             (nil? (swarm-identity-lib/accidental-full-pack-downgrade?
                    {:project-root "/tmp/swarm-identity-test"
                     :config-path "/tmp/swarm-identity-test/swarmforge/packs/openrouter-anthropic-mono-router.conf"
                     :swarmforge-pack ""
                     :swarmforge-config ""
                     :explicit-pack-cli? false
                     :allow-full-pack? ""})))

(let [msg (swarm-identity-lib/format-guard-message {:suggested-pack "openrouter-anthropic-mono-router"
                                                    :previous-rotation "router"})]
  (assert-contains "message mentions recovery" msg "start-swarm-anthropic")
  (assert-contains "message mentions --pack" msg "--pack openrouter-anthropic-mono-router"))

(if (empty? @failures)
  (println "swarm_identity_lib_test_runner: ok")
  (do (doseq [f @failures] (println f))
      (println (count @failures) "FAILURES")
      (System/exit 1)))

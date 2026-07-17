#!/usr/bin/env bb
;; BL-436: TDD runner for fleet_telegram_creds_lib.bb's resolve-telegram-creds -
;; covers acceptance scenarios 01-04. home-dir is always a fixture temp dir,
;; never the real $HOME.

(ns fleet-telegram-creds-lib-test-runner
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) ".." "fleet_telegram_creds_lib.bb")))

(def failures (atom []))

(defn assert= [msg expected actual]
  (when (not= expected actual)
    (swap! failures conj (str "FAIL: " msg "\n  expected: " (pr-str expected) "\n  actual:   " (pr-str actual)))))

(def created-temp-dirs (atom []))
(.addShutdownHook (Runtime/getRuntime)
                   (Thread. (fn [] (doseq [d @created-temp-dirs] (try (fs/delete-tree d) (catch Exception _ nil))))))

(defn mk-tmp-dir []
  (let [d (str (fs/create-temp-dir {:prefix "sfvc-fleet-telegram-creds-"}))]
    (swap! created-temp-dirs conj d)
    d))

(defn write-creds-file! [home-dir swarm-name creds]
  (let [f (fleet-telegram-creds-lib/creds-file-path home-dir swarm-name)]
    (fs/create-dirs (fs/parent f))
    (spit (str f) (json/generate-string creds))))

;; ── per-swarm-telegram-creds-01: a non-primary swarm resolves from its
;;    fleet creds file, not the environment ─────────────────────────────

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-token" :chatId "fes-chat" :bridgePort 9001})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home "fes" {"TELEGRAM_BOT_TOKEN" "should-never-be-used" "TELEGRAM_CHAT_ID" "should-never-be-used"} 8765)]
    (assert= "01: bot token comes from the fleet creds file" "fes-token" (:bot-token resolved))
    (assert= "01: chat id comes from the fleet creds file" "fes-chat" (:chat-id resolved))))

;; ── per-swarm-telegram-creds-02: the primary swarm with no creds file
;;    falls back to the environment ──────────────────────────────────────

(let [home (mk-tmp-dir)]
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home "primary" {"TELEGRAM_BOT_TOKEN" "env-token" "TELEGRAM_CHAT_ID" "env-chat"} 8765)]
    (assert= "02: bot token falls back to env when no creds file exists" "env-token" (:bot-token resolved))
    (assert= "02: chat id falls back to env when no creds file exists" "env-chat" (:chat-id resolved))
    (assert= "02: bridge port falls back to the given default" 8765 (:bridge-port resolved))))

;; ── per-swarm-telegram-creds-03: a creds file overrides an inherited
;;    primary token exported into the launching shell (never merged) ─────

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "fes-own-token" :chatId "fes-own-chat" :bridgePort 9001})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home "fes" {"TELEGRAM_BOT_TOKEN" "primary-token-leaked-into-shell" "TELEGRAM_CHAT_ID" "primary-chat-leaked-into-shell"} 8765)]
    (assert= "03: the creds file's own token wins" "fes-own-token" (:bot-token resolved))
    (assert= "03: the creds file's own chat id wins" "fes-own-chat" (:chat-id resolved))
    (assert (not= "primary-token-leaked-into-shell" (:bot-token resolved)))))

;; ── per-swarm-telegram-creds-04: the bridge port is read from the creds
;;    file for a non-primary swarm ───────────────────────────────────────

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "t" :chatId "c" :bridgePort 9099})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds home "fes" {} 8765)]
    (assert= "04: bridge port comes from the creds file" 9099 (:bridge-port resolved))))

;; ── corrupt/unparseable creds file degrades to the env fallback, never a
;;    crash ────────────────────────────────────────────────────────────

(let [home (mk-tmp-dir)
      f (fleet-telegram-creds-lib/creds-file-path home "broken")]
  (fs/create-dirs (fs/parent f))
  (spit (str f) "not json at all")
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds
                   home "broken" {"TELEGRAM_BOT_TOKEN" "env-token" "TELEGRAM_CHAT_ID" "env-chat"} 8765)]
    (assert= "a corrupt creds file degrades to the env fallback rather than crashing" "env-token" (:bot-token resolved))))

;; ── a creds file missing bridgePort still falls back to the given
;;    default for JUST that field, while token/chat-id still win ────────

(let [home (mk-tmp-dir)]
  (write-creds-file! home "fes" {:botToken "t" :chatId "c"})
  (let [resolved (fleet-telegram-creds-lib/resolve-telegram-creds home "fes" {} 8765)]
    (assert= "a creds file with no bridgePort still falls back to the given default for that field" 8765 (:bridge-port resolved))
    (assert= "token still comes from the file" "t" (:bot-token resolved))))

;; ── report ────────────────────────────────────────────────────────────────
(if (empty? @failures)
  (println "fleet_telegram_creds_lib (BL-436): ALL TESTS PASSED")
  (do (println (str "fleet_telegram_creds_lib (BL-436): " (count @failures) " FAILURE(S):"))
      (doseq [f @failures] (println f))
      (System/exit 1)))

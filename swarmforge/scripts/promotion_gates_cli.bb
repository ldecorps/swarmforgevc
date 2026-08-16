#!/usr/bin/env bb
;; BL-663: the one shell-callable entry point for promotion_gates_lib.bb.
;; promote_and_route_next.sh (auto-pick AND by-name modes) and
;; route_backlog_to_coder.sh both call this instead of carrying their own
;; gate logic - the required_wiring check on BL-663 greps both files for the
;; literal string "promotion_gates", so a gate library that is built but
;; never called refuses the handoff by design.
;;
;; Usage:
;;   promotion_gates_cli.bb locate <root> <BL-id>
;;     -> "<file>\t<paused|hold>" on stdout, exit 0
;;     -> "NOT_FOUND" on stdout, exit 1 (no <BL-id>*.yaml under paused/ or hold/)
;;
;;   promotion_gates_cli.bb evaluate <root> <ticket-file> <held:true|false> <max-depth>
;;     -> "ALLOW" on stdout, exit 0
;;     -> "REFUSE|<gate>|<reason>" on stdout, exit 2
;;     -> BL-854: when the candidate's epic overlaps an active ticket's, ALSO
;;        prints one "ADVISORY|orthogonality|epic <epic> is also active on
;;        <BL-id>[, <BL-id>...]" line to STDERR, ONLY when the candidate is
;;        otherwise ALLOWed - stdout's ALLOW/REFUSE contract is byte-identical
;;        to before; the advisory is a distinct, additional signal on the
;;        distinct stream, never parsed by any pre-existing caller.
;;
;;   promotion_gates_cli.bb select <root> <max-depth> <file>...
;;     -> the winning candidate's path on stdout, exit 0 (Article 3.2.4
;;        expedite-lane ranking over whichever of the given files pass
;;        `evaluate`; a candidate `evaluate` refuses is dropped from the
;;        ranking, never crashes the whole selection). BL-854: prints the
;;        WINNER's orthogonality advisory (if any) to stderr, once - never
;;        one per rejected candidate, which would bury the signal it exists
;;        to raise.
;;     -> "NONE" on stdout, exit 1 (no given file is an eligible candidate)
;;
;;   promotion_gates_cli.bb route-target <root> <ticket-file>
;;     -> "<role> REWRITE" or "<role> NOREWRITE" on stdout, exit 0

(ns promotion-gates-cli
  (:require [babashka.fs :as fs]))

(load-file (str (fs/path (fs/parent (fs/canonicalize *file*)) "promotion_gates_lib.bb")))

(defn- usage! []
  (binding [*out* *err*]
    (println "Usage: promotion_gates_cli.bb locate|evaluate|select|route-target ..."))
  (System/exit 1))

(defn- find-in [dir bl-id]
  (let [d (fs/path dir)]
    (when (fs/exists? d)
      (first (sort (map str (fs/glob d (str bl-id "*.yaml"))))))))

(defn- cmd-locate [[root bl-id]]
  (when (or (nil? root) (nil? bl-id)) (usage!))
  (if-let [f (find-in (fs/path root "backlog" "paused") bl-id)]
    (do (println (str f "\tpaused")) (System/exit 0))
    (if-let [f (find-in (fs/path root "backlog" "hold") bl-id)]
      (do (println (str f "\thold")) (System/exit 0))
      (do (println "NOT_FOUND") (System/exit 1)))))

(defn- print-advisory! [advisory]
  (when advisory
    (binding [*out* *err*]
      (println (promotion-gates-lib/advisory-line advisory)))))

(defn- cmd-evaluate [[root ticket-file held-str max-depth-str]]
  (when (or (nil? root) (nil? ticket-file) (nil? held-str) (nil? max-depth-str)) (usage!))
  (let [content (slurp ticket-file)
        held? (= "true" held-str)
        max-depth (Long/parseLong max-depth-str)
        result (promotion-gates-lib/evaluate
                {:content content
                 :held? held?
                 :active-count (promotion-gates-lib/active-count root)
                 :max-depth max-depth
                 :active-epics (promotion-gates-lib/active-epics root)})]
    (print-advisory! (:advisory result))
    (if (:ok result)
      (do (println "ALLOW") (System/exit 0))
      (do (println (str "REFUSE|" (:gate result) "|" (:reason result))) (System/exit 2)))))

(defn- cmd-select [[root max-depth-str & files]]
  (when (or (nil? root) (nil? max-depth-str) (empty? files)) (usage!))
  (let [max-depth (Long/parseLong max-depth-str)
        active-count (promotion-gates-lib/active-count root)
        active-epics (promotion-gates-lib/active-epics root)
        epic-priority-index (promotion-gates-lib/epic-priority-index root)
        eligible (keep (fn [f]
                          (let [content (slurp f)
                                result (promotion-gates-lib/evaluate
                                        {:content content :held? false
                                         :active-count active-count :max-depth max-depth
                                         :active-epics active-epics})]
                            (when (:ok result) {:file f :content content :advisory (:advisory result)})))
                        files)
        winner (promotion-gates-lib/rank-candidates eligible epic-priority-index)]
    (if winner
      (do (print-advisory! (:advisory winner))
          (println (:file winner))
          (System/exit 0))
      (do (println "NONE") (System/exit 1)))))

(defn- cmd-route-target [[root ticket-file]]
  (when (or (nil? root) (nil? ticket-file)) (usage!))
  (let [content (slurp ticket-file)
        assigned-to (promotion-gates-lib/read-assigned-to content)
        {:keys [route-to rewrite-assigned-to?]} (promotion-gates-lib/route-target assigned-to)]
    (println (str route-to " " (if rewrite-assigned-to? "REWRITE" "NOREWRITE")))
    (System/exit 0)))

(defn -main [& args]
  (let [[cmd & rest-args] args]
    (case cmd
      "locate" (cmd-locate rest-args)
      "evaluate" (cmd-evaluate rest-args)
      "select" (cmd-select rest-args)
      "route-target" (cmd-route-target rest-args)
      (usage!))))

(apply -main *command-line-args*)

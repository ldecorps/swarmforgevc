#!/usr/bin/env bb
;; BL-1720: thin CLI probe over the REAL reverse-hop-lib/reverse-recipients
;; - never a reimplementation of which roles a back-all/back-one send
;; addresses.
;;
;; Usage: bb bl1720_reverse_hop_probe.bb <roles-tsv-path> <sender> <mode>

(require '[babashka.fs :as fs]
         '[clojure.string :as str])

(def here (fs/parent (fs/canonicalize *file*)))
(load-file (str (fs/path here ".." "reverse_hop_lib.bb")))

(let [[roles-path sender mode] *command-line-args*
      lines (str/split-lines (slurp roles-path))]
  (println (str/join "," (reverse-hop-lib/reverse-recipients lines sender mode))))

;; BL-282: pure long-term memory store logic (Talk slice 2) - mirrors
;; support_lib.bb's own thread-store split exactly (record-interaction!'s
;; adapter-injected shape), but this store holds DURABLE, GENERALIZABLE
;; facts distilled from conversations, never raw per-subject transcript
;; detail. The BL-281 no-bleed guarantee extends here: a subject's raw
;; messages must never leak into this store, which every wake for EVERY
;; subject reloads in full (MVP: no relevance ranking, load-for-wake
;; returns everything - the deferred retrieval-scoring is out of scope).
;;
;; Distillation itself (deciding WHICH facts are durable) is an Operator
;; (LLM) JUDGEMENT, made outside this file entirely - the disposable
;; Operator PROPOSES fact strings (via operator_memory.bb); this lib only
;; ever appends+dedups whatever strings it is given, structurally
;; incapable of embedding a raw message/thread shape into a fact (the
;; store's own shape is a flat vector of strings, nothing else).
(ns operator-memory-lib)

(defn empty-memory-store [] {:facts []})

;; Pure: appends proposed-facts to the store, deduping so re-distilling an
;; already-known fact never duplicates it (operator-memory-05).
;; Order-preserving: existing facts first, new arrivals in the order given.
(defn append-facts [store proposed-facts]
  (update store :facts
          (fn [existing]
            (reduce (fn [acc fact] (if (some #(= % fact) acc) acc (conj acc fact)))
                    (or existing [])
                    proposed-facts))))

;; Pure: the facts to load for a wake - MVP loads ALL of them (relevance
;; ranking/retrieval scoring is explicitly deferred per the ticket's own
;; scope boundary).
(defn facts-for-wake [store]
  (:facts store))

(defn distill-facts!
  "Adapter-injected (mirrors support_lib.bb's record-interaction! shape):
   reads the current store, appends+dedups the proposed facts (pure), and
   writes the result back. Returns the updated store."
  [proposed-facts adapters]
  (let [store ((:read-store! adapters))
        updated (append-facts store proposed-facts)]
    ((:write-store! adapters) updated)
    updated))

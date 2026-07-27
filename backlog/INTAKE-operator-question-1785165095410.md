# Intake: a question the Operator could not answer

Filed by the Operator (2026-07-27T15:11:35.410937002Z) - a question came in via Telegram
that the Operator judged it could not answer itself. This is a RAW
ask, not a spec: the specifier drains this like any other backlog-root
item and decides what (if anything) becomes a real ticket.

## The question

L'humain (thread SUP-12) demande d'ISOLER le fil de conversation de l'Operator (topic SUP-###) du front-desk de la swarm — déclenché par le commit concierge « BL topic record for SUP-12 » qu'il a perçu comme une intrusion. Contexte pour le specifier : le concierge sérialise CHAQUE topic Telegram, y compris les fils SUP/Operator, vers backlog/topics/*.json (persistance des topics BL-295/BL-329) ; c'est de la bookkeeping inoffensive mais elle traite le fil privé Operator comme un topic front-desk ordinaire. Le besoin exprimé : exempter le(s) topic(s) Operator/SUP de la sérialisation / gestion front-desk du concierge afin que la conversation superviseur reste privée et distincte du canal front-desk de la swarm. Prior art à considérer : séparation multi-swarm par GROUPE (BL-379/380/381 : un bot + un groupe forum par projet, isolation structurelle plutôt que filtre). Le specifier décide de la portée : simple exemption de sérialisation du fil Operator vs canal/groupe séparé.

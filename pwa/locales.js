// BL-118: UI chrome string catalog - every value the client ever renders
// as static UI text (not data-derived) lives here, en + fr. Plain classic
// script (no bundler, matching every other pwa/*.js file); loaded before
// app.js and exposes window.LOCALES.
(function () {
  'use strict';

  window.LOCALES = {
    en: {
      pageTitle: 'SwarmForge — backlog dashboard',
      pageHeading: 'SwarmForge — backlog dashboard',
      loading: 'Loading…',
      localeToggleLabel: 'FR',
      // BL-238: static fallback accessible name (mirrors fontDecrease/
      // fontIncrease's own aria-label + data-i18n-aria pattern) - the
      // visible glyph alone (the target locale's code) is not descriptive
      // out of context for a screen reader.
      localeToggleAriaLabel: 'Switch language',
      needsApprovalHeading: 'Needs your approval',
      needsApprovalEmpty: 'Nothing awaiting approval.',
      // BL-266: the read-only ticket-detail drill-in opened from a
      // needs-approval entry (description + acceptance scenarios) and its
      // slice-2 listen/stop control (on-device Web Speech API, no
      // network/storage).
      approvalDetailBack: 'Back',
      startListening: 'Listen',
      stopListening: 'Stop',
      listenUnavailable: 'Listening is not available on this device.',
      boardHeading: 'Backlog board',
      boardActive: 'Active',
      boardPaused: 'Paused',
      boardDoneByMilestone: 'Done by milestone',
      // BL-257: backlog board filter/search chrome.
      boardFilterPlaceholder: 'Filter by id or title…',
      boardFilterStatusAriaLabel: 'Filter by status',
      boardFilterStatusAll: 'All statuses',
      boardFilterStatusActive: 'Active',
      boardFilterStatusPaused: 'Paused',
      boardFilterStatusDone: 'Done',
      boardFilterPriorityPlaceholder: 'Priority',
      boardFilterNoResults: 'No tickets match your filter.',
      velocityHeading: 'Velocity',
      burndownHeading: 'Burndown',
      burndownNoMilestones: 'No milestones yet.',
      cycleTimeHeading: 'Cycle time',
      cycleTimeNoTickets: 'No closed tickets yet.',
      costHealthHeading: 'Cost & Health',
      costHealthAgentTokens: 'Per-agent tokens/cost',
      costHealthTopExpensive: 'Top expensive tickets',
      costHealthResourceAnomalies: 'Resource anomalies',
      documentationHeading: 'Documentation',
      documentationRoot: 'Documentation',
      documentationVision: 'Vision',
      documentationMilestones: 'Milestones',
      documentationAcceptance: 'Acceptance scenarios',
      // BL-257: per-ticket timeline (git-derived specced/closed dates).
      timelineHeading: 'Timeline',
      timelineNoData: 'No timeline data available for this ticket.',
      timelineSpecced: 'Specced',
      timelineClosed: 'Closed',
      documentationNotFound: 'document not found',
      milestoneNotFound: 'milestone not found',
      ticketNotFound: 'ticket not found',
      scenarioNotFound: 'scenario not found',
      noScenariosResolved: 'no scenarios resolved for this ticket',
      noDescription: 'No description.',
      docsNotAvailable: 'documentation not available',
      // BL-254: the search box's placeholder and the no-results state - the
      // matched CONTENT (Gherkin/title/description text) stays canonical
      // English regardless of locale (bilingual-04's own rule), only this
      // chrome text is translated.
      docsSearchPlaceholder: 'Search spec text…',
      docsNoSearchResults: 'No tickets match your search.',
      // BL-253: greying is visual-only chrome text - it gates no
      // interaction (recertification stays available regardless, see
      // recertification.ts).
      implementedLabel: 'implemented',
      notYetImplementedLabel: 'not yet implemented',
      couldNotLoadDocsTree: 'Could not load docs-tree.json (offline and nothing cached yet).',
      couldNotLoadBacklog: 'Could not load backlog.json (offline and nothing cached yet).',
      couldNotLoadRecertBatch: 'Could not load recert-batch.json (offline and nothing cached yet).',
      showFrenchScenario: 'Show French rendering',
      hideFrenchScenario: 'Hide French rendering',
      // BL-261: shown whenever a rendered *Fr field's paired *Untranslated
      // flag is true (translate.ts degraded to the English fallback) - the
      // fallback text may still be shown, but never silently as if it were
      // a genuine French translation.
      translationUnavailableNotice: 'Machine translation unavailable — showing English.',
      recertHeading: 'Recertify a scenario',
      recertNoneNeeded: 'No scenarios need recertification right now.',
      recertConfirm: 'Confirm — still accurate',
      recertUpdate: 'Update text',
      recertDelete: 'Delete — obsolete',
      recertSendUpdate: 'Send update',
      recertYesDelete: 'Yes, delete',
      recertCancel: 'Cancel',
      recertDeleteWarning: 'This removes the scenario from the acceptance contract once the specifier accepts it. This cannot be undone. Are you sure?',
      asOfPrefix: 'As of ',
      // BL-263: single not-done total (active + paused, excluding done),
      // read from backlog.json's notDoneCount - never recomputed here.
      notDoneCountPrefix: 'Not done: ',
      // BL-229: jargon - the operator's rule keeps this English in French too.
      etaPrefix: ' — ETA ',
      remainingSuffix: ' remaining',
      fontDecreaseLabel: 'Decrease text size',
      fontIncreaseLabel: 'Increase text size',
      // BL-228: no new ETA computation - reuses the same forecast/etaPrefix.
      noEtaYet: 'no ETA yet',
      p85RangeInfix: ' (p85 ',
      overallEtaPrefix: 'Overall ETA: ',
    },
    fr: {
      pageTitle: 'SwarmForge — tableau de bord',
      pageHeading: 'SwarmForge — tableau de bord',
      loading: 'Chargement…',
      localeToggleLabel: 'EN',
      localeToggleAriaLabel: 'Changer de langue',
      needsApprovalHeading: 'Nécessite votre approbation',
      needsApprovalEmpty: 'Rien en attente d’approbation.',
      approvalDetailBack: 'Retour',
      startListening: 'Écouter',
      stopListening: 'Arrêter',
      listenUnavailable: "L'écoute n'est pas disponible sur cet appareil.",
      boardHeading: 'Tableau des tickets',
      boardActive: 'Actifs',
      boardPaused: 'En pause',
      boardDoneByMilestone: 'Terminés par jalon',
      boardFilterPlaceholder: 'Filtrer par id ou titre…',
      boardFilterStatusAriaLabel: 'Filtrer par statut',
      boardFilterStatusAll: 'Tous les statuts',
      boardFilterStatusActive: 'Actifs',
      boardFilterStatusPaused: 'En pause',
      boardFilterStatusDone: 'Terminés',
      boardFilterPriorityPlaceholder: 'Priorité',
      boardFilterNoResults: 'Aucun ticket ne correspond à votre filtre.',
      velocityHeading: 'Vélocité',
      burndownHeading: 'Burndown',
      burndownNoMilestones: 'Aucun jalon pour le moment.',
      cycleTimeHeading: 'Temps de cycle',
      cycleTimeNoTickets: 'Aucun ticket terminé pour le moment.',
      costHealthHeading: 'Coût et santé',
      costHealthAgentTokens: 'Jetons/coût par agent',
      costHealthTopExpensive: 'Tickets les plus coûteux',
      costHealthResourceAnomalies: 'Anomalies de ressources',
      documentationHeading: 'Documentation',
      documentationRoot: 'Documentation',
      documentationVision: 'Vision',
      documentationMilestones: 'Jalons',
      documentationAcceptance: "Scénarios d'acceptation",
      timelineHeading: 'Chronologie',
      timelineNoData: 'Aucune donnée de chronologie disponible pour ce ticket.',
      timelineSpecced: 'Spécifié',
      timelineClosed: 'Terminé',
      documentationNotFound: 'document introuvable',
      milestoneNotFound: 'jalon introuvable',
      ticketNotFound: 'ticket introuvable',
      scenarioNotFound: 'scénario introuvable',
      noScenariosResolved: 'aucun scénario résolu pour ce ticket',
      noDescription: 'Aucune description.',
      docsNotAvailable: 'documentation non disponible',
      docsSearchPlaceholder: 'Rechercher dans le texte des specs…',
      docsNoSearchResults: 'Aucun ticket ne correspond à votre recherche.',
      implementedLabel: 'implémenté',
      notYetImplementedLabel: 'pas encore implémenté',
      couldNotLoadDocsTree: 'Impossible de charger docs-tree.json (hors ligne et rien en cache).',
      couldNotLoadBacklog: 'Impossible de charger backlog.json (hors ligne et rien en cache).',
      couldNotLoadRecertBatch: 'Impossible de charger recert-batch.json (hors ligne et rien en cache).',
      showFrenchScenario: 'Afficher la version française',
      hideFrenchScenario: 'Masquer la version française',
      translationUnavailableNotice: 'Traduction automatique indisponible — affichage en anglais.',
      recertHeading: 'Recertifier un scénario',
      recertNoneNeeded: 'Aucun scénario à recertifier pour le moment.',
      recertConfirm: 'Confirmer — toujours exact',
      recertUpdate: 'Modifier le texte',
      recertDelete: 'Supprimer — obsolète',
      recertSendUpdate: 'Envoyer la modification',
      recertYesDelete: 'Oui, supprimer',
      recertCancel: 'Annuler',
      recertDeleteWarning: "Cela retire le scénario du contrat d'acceptation une fois accepté par le specifier. Cette action est irréversible. Êtes-vous sûr(e) ?",
      asOfPrefix: 'Au ',
      // BL-263: total non terminé unique (actif + en pause, hors terminé),
      // lu depuis backlog.json's notDoneCount - jamais recalculé ici.
      notDoneCountPrefix: 'Non terminé : ',
      // BL-229: jargon - "ETA" keeps its English value in French per the operator's rule.
      etaPrefix: ' — ETA ',
      remainingSuffix: ' restants',
      fontDecreaseLabel: 'Diminuer la taille du texte',
      fontIncreaseLabel: 'Augmenter la taille du texte',
      // BL-228: "no ETA yet" is ordinary words -> translated; "p85" stays
      // jargon per the operator's rule (same as etaPrefix above).
      noEtaYet: 'ETA non disponible',
      p85RangeInfix: ' (p85 ',
      overallEtaPrefix: 'ETA globale : ',
    },
  };
})();

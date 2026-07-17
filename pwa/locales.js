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
      costHealthAvgPerTicket: 'Average cost / ticket',
      costHealthTicketsSuffix: 'delivered tickets',
      costHealthExcludedSuffix: 'excluded (no priced usage)',
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
      showFrenchScenario: 'Show French rendering',
      hideFrenchScenario: 'Hide French rendering',
      // BL-261: shown whenever a rendered *Fr field's paired *Untranslated
      // flag is true (translate.ts degraded to the English fallback) - the
      // fallback text may still be shown, but never silently as if it were
      // a genuine French translation.
      translationUnavailableNotice: 'Machine translation unavailable — showing English.',
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
      // BL-287: the burndown line-chart legend.
      burndownRemainingLegend: 'Remaining',
      burndownIdealLegend: 'Ideal',
      // BL-290: suite-test duration, riding the committed cost/health sidecar.
      suiteDurationHeading: 'Suite duration',
      suiteDurationLabel: 'Suite duration: ',
      suiteDurationLabelWarn: 'Suite duration (WARN): ',
      suiteDurationLatestSuffix: 's latest',
      suiteDurationNoData: 'no local data',
      // BL-347: the Role Leaderboard - BL-340's committed benchmark report,
      // presented as Best / Best Value / Cheapest Acceptable per role.
      roleLeaderboardHeading: 'Role Leaderboard',
      roleLeaderboardRolePrefix: 'Role: ',
      roleLeaderboardAsOfPrefix: 'Benchmark run: ',
      roleLeaderboardThresholdPrefix: 'Quality threshold: ',
      roleLeaderboardColCategory: 'Category',
      roleLeaderboardColModel: 'Model',
      roleLeaderboardColQuality: 'Quality',
      // BL-388: survival + rework are the epic's own thesis surfaced -
      // what SURVIVED the pipeline, and what rework it cost to get there.
      roleLeaderboardColSurvived: 'Survived',
      roleLeaderboardColRework: 'Rework',
      roleLeaderboardColCost: 'Cost',
      roleLeaderboardColDuration: 'Duration',
      roleLeaderboardBest: 'Best',
      roleLeaderboardBestValue: 'Best value',
      // BL-385: under a quality tie, best-value reduces to cheapest - this
      // distinct label says so, rather than presenting it as a quality-
      // cost judgement quality did nothing to inform.
      roleLeaderboardBestValueByCostAlone: 'Best value (ranked by cost alone — quality tied)',
      roleLeaderboardCheapestAcceptable: 'Cheapest acceptable',
      roleLeaderboardNoAcceptableSeparator: ': ',
      roleLeaderboardNoCost: 'no priced usage',
      roleLeaderboardSecondsSuffix: 's',
      // BL-388: a report committed before survival/rework existed carries
      // neither field - shown as "no data", never a crash or a bare NaN.
      roleLeaderboardNoData: 'no data',
      roleLeaderboardReworkRoundsSuffix: ' rounds',
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
      costHealthAvgPerTicket: 'Coût moyen / ticket',
      costHealthTicketsSuffix: 'tickets livrés',
      costHealthExcludedSuffix: 'exclu(s) (pas d\'usage tarifé)',
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
      showFrenchScenario: 'Afficher la version française',
      hideFrenchScenario: 'Masquer la version française',
      translationUnavailableNotice: 'Traduction automatique indisponible — affichage en anglais.',
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
      // BL-287: la légende du graphique en ligne du burndown.
      burndownRemainingLegend: 'Restants',
      burndownIdealLegend: 'Idéal',
      // BL-290: durée de la suite de tests, via le sidecar coût/santé commité.
      suiteDurationHeading: 'Durée de la suite de tests',
      suiteDurationLabel: 'Durée de la suite : ',
      suiteDurationLabelWarn: 'Durée de la suite (ALERTE) : ',
      suiteDurationLatestSuffix: 's (dernière mesure)',
      suiteDurationNoData: 'aucune donnée locale',
      // BL-347: le classement par rôle - le rapport de benchmark commité de
      // BL-340, présenté comme Meilleur / Meilleur rapport qualité-prix /
      // Moins cher acceptable, par rôle.
      roleLeaderboardHeading: 'Classement par rôle',
      roleLeaderboardRolePrefix: 'Rôle : ',
      roleLeaderboardAsOfPrefix: 'Benchmark exécuté : ',
      roleLeaderboardThresholdPrefix: 'Seuil de qualité : ',
      roleLeaderboardColCategory: 'Catégorie',
      roleLeaderboardColModel: 'Modèle',
      roleLeaderboardColQuality: 'Qualité',
      roleLeaderboardColSurvived: 'A survécu',
      roleLeaderboardColRework: 'Reprises',
      roleLeaderboardColCost: 'Coût',
      roleLeaderboardColDuration: 'Durée',
      roleLeaderboardBest: 'Meilleur',
      roleLeaderboardBestValue: 'Meilleur rapport qualité-prix',
      roleLeaderboardBestValueByCostAlone: 'Meilleur rapport qualité-prix (classé au coût seul — qualité ex æquo)',
      roleLeaderboardCheapestAcceptable: 'Moins cher acceptable',
      roleLeaderboardNoAcceptableSeparator: ' : ',
      roleLeaderboardNoCost: 'pas d\'usage tarifé',
      roleLeaderboardSecondsSuffix: 's',
      roleLeaderboardNoData: 'aucune donnée',
      roleLeaderboardReworkRoundsSuffix: ' reprises',
    },
  };
})();

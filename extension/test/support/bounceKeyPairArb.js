const fc = require('fast-check');
const { bounceAttribution } = require('../../out/quality/qaBounce');

// BL-768: the bounce natural-key pair generator, extracted from
// bounceNaturalKey.property.test.js so the property test and this ticket's
// acceptance step handlers drive ONE implementation, not two
// (required_wiring). Reaching all five near-collision categories used to be
// emergent from a free-form perturbation of a random subset of fields -
// most categories were reached almost every run, but "differs only in
// time-of-day" needed the perturbed subset to include `timeOfDay`, draw a
// genuinely different value, AND exclude every key component, which landed
// on only ~97.4% of runs (measured: BL-768's ticket). This module makes
// each category a first-class generator ARM instead: draw the category,
// then construct a pair that satisfies it. The free-form perturbation is
// kept as one further arm so the general (unstructured) sweep is not lost.

const KNOWN_CLASSES = ['compile', 'unit', 'integration', 'acceptance', 'behavior'];
const KNOWN_TYPES = ['feature', 'defect', 'chore', 'docs', 'enhancement', 'epic'];
const KNOWN_PRODUCING = ['coder', 'cleaner', 'architect', 'hardender', 'documenter'];
const KNOWN_BOUNCE_ROLES = ['specifier', 'coder', 'cleaner', 'architect', 'hardender', 'documenter', 'QA'];
// `by` absent (`undefined`) is a first-class case: the 53 legacy records
// have no `by` and must partition together under `unattributed`, never
// merge with a named role.
const BY_VALUES = [undefined, ...KNOWN_BOUNCE_ROLES];
const DAYS = ['2026-07-24', '2026-07-25', '2026-07-26'];
const TIMES_OF_DAY = ['00:00:00.000Z', '09:30:00.000Z', '23:59:59.999Z'];

// Deliberately SMALL domains for the five key components, so distinct
// records collide on some components and differ on others on most runs - a
// wide-open generator would make every pair differ everywhere and the
// partition claim would hold vacuously.
const ticketArb = fc.constantFrom('BL-590', 'BL-606', 'BL-635');
const commitArb = fc.constantFrom('aaaa111111', 'bbbb222222', 'cccc333333');
const dayArb = fc.constantFrom(...DAYS);
const timeOfDayArb = fc.constantFrom(...TIMES_OF_DAY);
const classArb = fc.constantFrom(...KNOWN_CLASSES);
const byArb = fc.option(fc.constantFrom(...KNOWN_BOUNCE_ROLES), { nil: undefined });
// Components that must NOT participate in the key.
const producingArb = fc.constantFrom(...KNOWN_PRODUCING);
const typeArb = fc.constantFrom(...KNOWN_TYPES);

// Shared field shape for both the shaped record generator below and
// freeFormArb's raw draw of fresh values to perturb with.
const RAW_FIELDS_SHAPE = {
  ticket: ticketArb,
  commit: commitArb,
  day: dayArb,
  timeOfDay: timeOfDayArb,
  failureClass: classArb,
  by: byArb,
  producingRole: producingArb,
  ticketType: typeArb,
};

const recordArb = fc
  .record(RAW_FIELDS_SHAPE)
  .map(({ day, timeOfDay, ...rest }) => ({ ...rest, at: `${day}T${timeOfDay}` }));

function keyComponentsMatch(a, b) {
  return (
    a.ticket === b.ticket &&
    a.at.slice(0, 10) === b.at.slice(0, 10) &&
    a.failureClass === b.failureClass &&
    a.commit === b.commit &&
    bounceAttribution(a) === bounceAttribution(b)
  );
}

// Equal on every key component except optionally the named one (`null` =
// equal on all five, so only non-key fields or time-of-day may differ).
function keyFieldsEqualExcept(a, b, except) {
  const same = {
    ticket: a.ticket === b.ticket,
    day: a.at.slice(0, 10) === b.at.slice(0, 10),
    failureClass: a.failureClass === b.failureClass,
    commit: a.commit === b.commit,
    by: bounceAttribution(a) === bounceAttribution(b),
  };
  return Object.entries(same).every(([k, v]) => (k === except ? true : v));
}

// The states this property is worthless without. Each names a way the key
// could be wrong that only shows up on a pair that AGREES everywhere else.
// Unchanged from the pre-BL-768 test file - only where it lives moved.
const PAIR_CATEGORIES = {
  'differs only in `by`': (a, b) => keyFieldsEqualExcept(a, b, 'by') && bounceAttribution(a) !== bounceAttribution(b),
  'differs only in time-of-day': (a, b) => keyFieldsEqualExcept(a, b, null) && a.at !== b.at,
  'differs only in producingRole/ticketType': (a, b) =>
    keyFieldsEqualExcept(a, b, null) && a.at === b.at && (a.producingRole !== b.producingRole || a.ticketType !== b.ticketType),
  'identical in every key component': (a, b) => keyComponentsMatch(a, b),
  'differs in a key component': (a, b) => !keyComponentsMatch(a, b),
};

// Every category name this generator claims to reach.
const CATEGORY_NAMES = Object.keys(PAIR_CATEGORIES);

// Every category the pair (a, b) belongs to - categories are not mutually
// exclusive (e.g. a "differs only in time-of-day" pair also satisfies
// "identical in every key component", since the key ignores time-of-day).
function classifyPair(a, b) {
  return CATEGORY_NAMES.filter((name) => PAIR_CATEGORIES[name](a, b));
}

function assertOrThrow(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Fails naming every category the sample never reached, so the guard is
// legible about what would have made the property vacuous - not merely
// "coverage failed".
function assertPairCoverage(seen) {
  const missed = CATEGORY_NAMES.filter((c) => !seen.has(c));
  assertOrThrow(missed.length === 0, `generator never reached: ${missed.join(', ')} - the property would pass vacuously there`);
}

function otherValueFrom(domain, current) {
  const remaining = domain.filter((v) => v !== current);
  return fc.constantFrom(...remaining);
}

function otherByAttribution(current) {
  const currentAttribution = bounceAttribution({ by: current });
  const remaining = BY_VALUES.filter((v) => bounceAttribution({ by: v }) !== currentAttribution);
  return fc.constantFrom(...remaining);
}

// Arm 1: differs only in `by` (attribution differs; everything else, key
// and non-key alike, is held identical).
const byOnlyDiffArb = recordArb.chain((a) => otherByAttribution(a.by).map((by) => [a, { ...a, by }]));

// Arm 2: differs only in time-of-day (every key component equal, including
// `by` itself unchanged - only the time portion of `at` moves).
const timeOfDayOnlyDiffArb = recordArb.chain((a) => {
  const currentTimeOfDay = a.at.slice(11);
  return otherValueFrom(TIMES_OF_DAY, currentTimeOfDay).map((timeOfDay) => [a, { ...a, at: `${a.at.slice(0, 10)}T${timeOfDay}` }]);
});

// Arm 3: differs only in producingRole/ticketType (every key component AND
// the full `at` equal; producingRole is forced to a different value, which
// alone satisfies the category's OR - ticketType is free).
const nonKeyOnlyDiffArb = recordArb.chain((a) =>
  fc.tuple(otherValueFrom(KNOWN_PRODUCING, a.producingRole), typeArb).map(([producingRole, ticketType]) => [
    a,
    { ...a, producingRole, ticketType },
  ])
);

// Arm 4: identical in every key component (ticket/day/failureClass/commit/
// attribution held fixed; time-of-day, producingRole and ticketType - none
// of them key components - drawn freely).
const sameKeyArb = recordArb.chain((a) =>
  fc.tuple(timeOfDayArb, producingArb, typeArb).map(([timeOfDay, producingRole, ticketType]) => [
    a,
    { ...a, at: `${a.at.slice(0, 10)}T${timeOfDay}`, producingRole, ticketType },
  ])
);

// Arm 5: differs in a key component - force ONE randomly chosen key
// component away from `a`'s value, then draw the rest of `b` completely
// independently so the "differs" case still sweeps the full domain. The
// forced field is always overwritten with a value unequal to `a`'s on that
// dimension, so keyComponentsMatch(a, b) is false by construction - no
// filter needed.
const KEY_COMPONENT_DOMAINS = {
  ticket: ['BL-590', 'BL-606', 'BL-635'],
  commit: ['aaaa111111', 'bbbb222222', 'cccc333333'],
  day: DAYS,
  failureClass: KNOWN_CLASSES,
};

const differingKeyArb = fc.constantFrom('ticket', 'commit', 'day', 'failureClass', 'by').chain((forcedField) =>
  recordArb.chain((a) => {
    const currentValue = forcedField === 'day' ? a.at.slice(0, 10) : a[forcedField];
    const forcedValueArb = forcedField === 'by' ? otherByAttribution(a.by) : otherValueFrom(KEY_COMPONENT_DOMAINS[forcedField], currentValue);
    return fc.tuple(forcedValueArb, recordArb).map(([forcedValue, freshB]) => {
      const b = { ...freshB };
      if (forcedField === 'day') {
        b.at = `${forcedValue}T${b.at.slice(11)}`;
      } else if (forcedField === 'by') {
        b.by = forcedValue;
      } else {
        b[forcedField] = forcedValue;
      }
      return [a, b];
    });
  })
);

// Arm 6: the original free-form perturbation, kept so the unstructured
// sweep (including combinations across multiple fields at once) is not
// lost now that each category also has a dedicated arm.
const PERTURBABLE = ['ticket', 'commit', 'day', 'timeOfDay', 'failureClass', 'by', 'producingRole', 'ticketType'];

const freeFormArb = fc
  .tuple(recordArb, fc.subarray(PERTURBABLE), fc.record(RAW_FIELDS_SHAPE))
  .map(([a, fields, fresh]) => {
    const b = { ...a };
    for (const f of fields) {
      if (f === 'day') {
        b.at = `${fresh.day}T${a.at.slice(11)}`;
      } else if (f === 'timeOfDay') {
        b.at = `${b.at.slice(0, 10)}T${fresh.timeOfDay}`;
      } else if (f === 'by') {
        b.by = fresh.by;
      } else {
        b[f] = fresh[f];
      }
    }
    return [a, b];
  });

const pairArb = fc.oneof(byOnlyDiffArb, timeOfDayOnlyDiffArb, nonKeyOnlyDiffArb, sameKeyArb, differingKeyArb, freeFormArb);

module.exports = {
  recordArb,
  pairArb,
  PAIR_CATEGORIES,
  CATEGORY_NAMES,
  classifyPair,
  assertPairCoverage,
  keyComponentsMatch,
  keyFieldsEqualExcept,
};

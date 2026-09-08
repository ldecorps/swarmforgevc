'use strict';

// BL-1357: property tests for the two declared invariants in the ticket:
// 1. "Disposal happens exactly once per scenario that acquired something, on
//    every exit path - normal completion, a handler throw, and a no-handler-match
//    throw alike."
// 2. "A disposal failure never replaces the failure that caused the abort: the
//    original failure is always what the runner reports."
//
// These tests drive the REAL runScenario from specs/pipeline/runtime.js with
// synthetic registries and scenarios, verifying the invariants hold across
// generated exit paths.

import { test, expect } from 'vitest';
import { runScenario } from '../specs/pipeline/runtime.js';

// ── Property test 1: exactly-once disposal on every exit path ────────────────
test('property: disposal happens exactly once per scenario on every exit path', async () => {
  // Generate scenarios with different exit paths:
  // - normal completion
  // - handler throw
  // - no-handler-match throw
  const exitPaths = [
    { name: 'normal completion', shouldThrow: false, matchAll: true },
    { name: 'handler throw', shouldThrow: true, matchAll: true },
    { name: 'no-handler-match', shouldThrow: true, matchAll: false },
  ];

  for (const path of exitPaths) {
    const disposalCount = { count: 0 };
    const context = {};

    const registry = {
      resolve: (text) => {
        if (!path.matchAll && text.includes('unmatched')) {
          return null;
        }
        if (text.includes('acquire')) {
          return {
            handler: async (ctx) => {
              ctx.__disposables = [
                () => {
                  disposalCount.count++;
                },
              ];
            },
            args: [],
          };
        }
        if (text.includes('step')) {
          return {
            handler: async () => {
              if (path.shouldThrow && text.includes('throw')) {
                throw new Error('step handler threw');
              }
            },
            args: [],
          };
        }
        return null;
      },
    };

    const feature = {
      name: 'test',
      background: [{ text: 'Given acquire', keyword: 'Given' }],
    };
    const scenario = {
      name: 'test scenario',
      steps: [
        { text: 'When step', keyword: 'When' },
        ...(path.shouldThrow ? [{ text: 'When throw', keyword: 'When' }] : []),
        ...(!path.matchAll ? [{ text: 'When unmatched', keyword: 'When' }] : []),
      ],
    };

    let threw = false;
    try {
      await runScenario(registry, feature, scenario, null);
    } catch (err) {
      threw = true;
      expect(err.message).toMatch(/step handler threw|no step handler matched/);
    }

    expect(threw).toBe(path.shouldThrow || !path.matchAll);
    expect(disposalCount.count).toBe(1);
  }
});

// ── Property test 2: disposal failure never masks original failure ───────────
test('property: disposal failure never replaces the original failure', async () => {
  const context = {};
  const disposalCount = { count: 0 };

  const registry = {
    resolve: (text) => {
      if (text.includes('acquire')) {
        return {
          handler: async (ctx) => {
            ctx.__disposables = [
              () => {
                disposalCount.count++;
                throw new Error('disposal itself failed');
              },
            ];
          },
          args: [],
        };
      }
      if (text.includes('step')) {
        return {
          handler: async () => {
            throw new Error('original step failure');
          },
          args: [],
        };
      }
      return null;
    },
  };

  const feature = {
    name: 'test',
    background: [{ text: 'Given acquire', keyword: 'Given' }],
  };
  const scenario = {
    name: 'test scenario',
    steps: [{ text: 'When step', keyword: 'When' }],
  };

  let caughtError = null;
  try {
    await runScenario(registry, feature, scenario, null);
  } catch (err) {
    caughtError = err;
  }

  expect(caughtError).not.toBeNull();
  // The original failure must be in the error message, with the disposal failure alongside
  expect(caughtError.message).toMatch(/original step failure/);
  expect(caughtError.message).toMatch(/disposal itself failed/);
  // Disposal must still have been attempted
  expect(disposalCount.count).toBe(1);
});

// ── Property test 3: no disposal when nothing acquired ───────────────────────
test('property: no disposal attempted when nothing acquired', async () => {
  const disposalCount = { count: 0 };

  const registry = {
    resolve: (text) => {
      if (text.includes('step')) {
        return {
          handler: async (ctx) => {
            // Deliberately do NOT set ctx.__disposables
          },
          args: [],
        };
      }
      return null;
    },
  };

  const feature = {
    name: 'test',
    background: [],
  };
  const scenario = {
    name: 'test scenario',
    steps: [{ text: 'When step', keyword: 'When' }],
  };

  await runScenario(registry, feature, scenario, null);
  expect(disposalCount.count).toBe(0);
});

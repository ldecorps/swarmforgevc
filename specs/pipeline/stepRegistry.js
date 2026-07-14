'use strict';

function createStepRegistry() {
  const definitions = [];

  function define(pattern, handler) {
    definitions.push({ pattern, handler });
  }

  function resolve(stepText) {
    for (const { pattern, handler } of definitions) {
      const match = pattern.exec(stepText);
      if (match) {
        return { handler, args: match.slice(1) };
      }
    }
    return null;
  }

  return { define, resolve };
}

module.exports = { createStepRegistry };

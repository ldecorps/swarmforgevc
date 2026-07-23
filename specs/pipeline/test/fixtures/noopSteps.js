'use strict';

function registerSteps(registry) {
  registry.define(/^a thing$/, () => {});
  registry.define(/^a role "([^"]+)"$/, () => {});
}

module.exports = { registerSteps };

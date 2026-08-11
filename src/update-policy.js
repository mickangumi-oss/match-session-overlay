"use strict";

function resolveUpdateRequirement(previousRequired, state) {
  // Once a running process has entered required-update mode, only installing
  // the update or restarting into a newly checked process may unlock it.
  const required = previousRequired === true || state?.required === true;
  return {
    required,
    becameRequired: required && previousRequired !== true,
  };
}

function assertUpdateAllowed(required, allowDuringUpdate = false) {
  if (required === true && allowDuringUpdate !== true) {
    throw new Error("UPDATE_REQUIRED");
  }
}

module.exports = {
  assertUpdateAllowed,
  resolveUpdateRequirement,
};

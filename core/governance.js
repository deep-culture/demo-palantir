/*
 * core/governance.js — the seed's governance block (markings, roles, purposes, checkpoints, honesty).
 *
 * Classic script; attaches window.DC.governance. Load after core/store.js.
 * Contract: context/PHASE1_CONTRACT.md §2 and §6.
 *
 *   DC.governance.init(seedGovernance)   call once per app after the seed loads (again on dataset switch)
 *   DC.governance.get()                  {markings, roles, purposes, checkpoints, honesty}
 *   DC.governance.role(id)               role object or null
 *
 * Additions (not in the contract, safe to use):
 *   isActive()                 true when the seed carried a governance block with roles
 *   marking(id), purpose(id), checkpoint(idOrTrigger), honesty(id)
 *   onInit(cb)                 called after every init()
 *   DEFAULT_ROLE               "fin-analyst" (contract §1)
 *
 * Without a governance block (older seeds) get() returns empty arrays and isActive() is false:
 * every consumer treats that as "everything visible, no checkpoints".
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const DEFAULT_ROLE = "fin-analyst";
  const EMPTY = Object.freeze({ markings: [], roles: [], purposes: [], checkpoints: [], honesty: [] });

  let current = EMPTY;
  let active = false;
  const listeners = [];

  function list(value) {
    return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && item.id) : [];
  }

  function init(seedGovernance) {
    const source = seedGovernance && typeof seedGovernance === "object" ? seedGovernance : null;
    current = source
      ? {
          markings: list(source.markings),
          roles: list(source.roles).map((role) => ({
            markingsVisible: [],
            purposes: [],
            canApprove: false,
            canRemoveMarkings: false,
            canOpenOversight: false,
            ...role,
          })),
          purposes: list(source.purposes),
          checkpoints: list(source.checkpoints),
          honesty: list(source.honesty),
        }
      : EMPTY;
    active = current.roles.length > 0;
    listeners.slice().forEach((callback) => {
      try {
        callback(current);
      } catch (error) {
        console.error("[DC.governance] listener failed", error);
      }
    });
    return current;
  }

  function byId(items, id) {
    return items.find((item) => item.id === id) || null;
  }

  DC.governance = {
    DEFAULT_ROLE,
    init,
    get: () => current,
    isActive: () => active,
    role: (id) => byId(current.roles, id),
    marking: (id) => byId(current.markings, id),
    purpose: (id) => byId(current.purposes, id),
    honesty: (id) => byId(current.honesty, id),
    checkpoint: (idOrTrigger) =>
      byId(current.checkpoints, idOrTrigger) || current.checkpoints.find((item) => item.trigger === idOrTrigger) || null,
    onInit(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();

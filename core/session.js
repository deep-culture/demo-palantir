/*
 * core/session.js — the shared session: current role, purpose and instructor flags.
 *
 * Classic script; attaches window.DC.session. Load after core/store.js and core/governance.js.
 * Storage: dc-palantir:session  {sessionId, role, purpose, flags: {strictCheckpoints, karlsruhe}}  (contract §5;
 *          flags.karlsruhe is Karlsruhe mode, read and set through DC.purposes)
 *
 *   DC.session.get()                 {sessionId, role, purpose, flags}
 *   DC.session.setRole(id)           persists, logs a "role" event, notifies listeners
 *   DC.session.setFlag(name, bool)   e.g. strictCheckpoints; logged
 *   DC.session.onChange(cb)          cb(session, {source: "local" | "storage"}); also fires when
 *                                    another tab changes the session ("storage" event)
 * Additions:
 *   setPurpose(id)                   logged; null clears
 *   setSurface(name) / surface()     which app this page is ("investigate", "build", "oversight");
 *                                    used as the default surface of session events
 *   role()                           the current role object (or null without governance)
 *
 * Phase 3 (contract §5):
 *   failureMode() / setFailureMode(mode)   flags.failureMode: "none" | "fabricated-link" | "overreach" |
 *                                    "approve-all" — the agent's scripted failure (instructor control in
 *                                    the session strip); logged as session.setFlag {flag: "failureMode"}
 *   FAILURE_MODES                    the four values
 *
 * The role is a client-side convenience, not security (spec §4.1): anyone can change it.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const SESSION_KEY = "dc-palantir:session";
  const FAILURE_MODES = ["none", "fabricated-link", "overreach", "approve-all"];
  const listeners = [];
  let surfaceName = "";
  let memory = null; // used when localStorage is unavailable

  function newSessionId() {
    const random = Math.random().toString(16).slice(2, 8);
    return `s-${Date.now().toString(36)}-${random}`;
  }

  function defaultRole() {
    const governance = DC.governance;
    if (governance && governance.isActive()) {
      const roles = governance.get().roles;
      return (governance.role(governance.DEFAULT_ROLE) || roles[0]).id;
    }
    return (governance && governance.DEFAULT_ROLE) || "fin-analyst";
  }

  function read() {
    const stored = store ? store.get(SESSION_KEY, null) : memory;
    return stored && typeof stored === "object" ? stored : null;
  }

  function write(session) {
    memory = session;
    if (store) store.set(SESSION_KEY, session);
  }

  function normalise(session) {
    const value = {
      sessionId: session && session.sessionId ? String(session.sessionId) : newSessionId(),
      role: session && session.role ? String(session.role) : defaultRole(),
      purpose: session && session.purpose ? String(session.purpose) : null,
      flags: { strictCheckpoints: false, karlsruhe: false, failureMode: "none", ...((session && session.flags) || {}) },
    };
    if (!FAILURE_MODES.includes(value.flags.failureMode)) value.flags.failureMode = "none";
    const governance = DC.governance;
    if (governance && governance.isActive() && !governance.role(value.role)) {
      value.role = defaultRole();
    }
    return value;
  }

  function get() {
    const stored = read();
    const session = normalise(stored);
    if (!stored || stored.sessionId !== session.sessionId) write(session);
    return session;
  }

  function notify(session, source) {
    listeners.slice().forEach((callback) => {
      try {
        callback(session, { source });
      } catch (error) {
        console.error("[DC.session] listener failed", error);
      }
    });
  }

  function log(partial) {
    if (!DC.audit) return Promise.resolve(null);
    return DC.audit.logEvent({ surface: surfaceName || "unknown", ...partial });
  }

  function setRole(id) {
    const session = get();
    const previous = session.role;
    const next = String(id || "");
    if (!next || next === previous) return Promise.resolve(null);
    session.role = next;
    // A purpose the new role does not hold is dropped.
    const role = DC.governance && DC.governance.role(next);
    if (role && session.purpose && !(role.purposes || []).includes(session.purpose)) session.purpose = null;
    write(session);
    const logged = log({ kind: "role", verb: "session.setRole", payload: { from: previous, to: next } });
    notify(session, "local");
    return logged;
  }

  function setPurpose(id) {
    const session = get();
    const next = id ? String(id) : null;
    if (next === session.purpose) return Promise.resolve(null);
    const previous = session.purpose;
    session.purpose = next;
    write(session);
    const logged = log({ kind: "session", verb: "session.setPurpose", payload: { from: previous, to: next } });
    notify(session, "local");
    return logged;
  }

  function setFlag(name, value) {
    const session = get();
    const flag = String(name);
    const next = Boolean(value);
    if (session.flags[flag] === next) return Promise.resolve(null);
    session.flags[flag] = next;
    write(session);
    const logged = log({ kind: "session", verb: "session.setFlag", payload: { flag, value: next } });
    notify(session, "local");
    return logged;
  }

  function setFailureMode(mode) {
    const session = get();
    const next = FAILURE_MODES.includes(mode) ? mode : "none";
    if (session.flags.failureMode === next) return Promise.resolve(null);
    const previous = session.flags.failureMode;
    session.flags.failureMode = next;
    write(session);
    const logged = log({ kind: "session", verb: "session.setFlag", payload: { flag: "failureMode", value: next, from: previous } });
    notify(session, "local");
    return logged;
  }

  function onChange(callback) {
    if (typeof callback === "function") listeners.push(callback);
  }

  window.addEventListener("storage", (event) => {
    if (event.key === SESSION_KEY) notify(get(), "storage");
  });

  DC.session = {
    KEY: SESSION_KEY,
    get,
    setRole,
    setPurpose,
    setFlag,
    setFailureMode,
    failureMode: () => get().flags.failureMode || "none",
    FAILURE_MODES,
    onChange,
    setSurface(name) {
      surfaceName = String(name || "");
    },
    surface: () => surfaceName,
    role() {
      return DC.governance ? DC.governance.role(get().role) : null;
    },
  };
})();

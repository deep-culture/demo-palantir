/*
 * core/audit.js — one audit log for the whole platform, hash-chained.
 *
 * Classic script; attaches window.DC.audit. Load after core/store.js and core/session.js.
 * Spec §4.4 (F4), contract §5–6.
 *
 * Storage
 *   dc-palantir:audit        [event…]   oldest first, capped at 5,000 (oldest dropped)
 *   dc-palantir:audit:meta   {dropped, anchorHash}   anchorHash = hash of the last dropped event,
 *                                                    so the chain still verifies after truncation
 *
 * Event (one shape for every surface)
 *   {id: "ev-000123", seq, ts, sessionId, role, surface, kind, verb, objectIds, datasetId, payload,
 *    checkpointId, prevHash, hash, alg}
 *   kind: view | search | expand | export | action | checkpoint | agent | role | marking | resolution
 *         (+ session for purpose/flag changes, audit for a clear)
 *   checkpointId always names a Checkpoint *record* ("cpr-…"): on the checkpoint event itself and on
 *   the operation it allowed, so the two join. The seeded checkpoint id is payload.checkpoint.
 *   hash = SHA-256 (crypto.subtle) over a canonical string of every other field, prevHash included;
 *   alg = "sha256", or "fnv1a-64" when crypto.subtle is unavailable (e.g. file://). Not security:
 *   anyone with devtools can rewrite the whole chain. It shows the idea of tamper evidence.
 *
 *   DC.audit.logEvent(partial)      -> Promise<event>   (writes are queued, so the chain stays ordered)
 *   DC.audit.readEvents(filter?)    {kind?, role?, surface?, objectId?, verb?, sessionId?, checkpointId?} -> event[]
 *   DC.audit.verifyChain()          -> Promise<{ok, brokenAt, count, dropped}>
 *   DC.audit.clear(reason)          instructor; the clear is the first event of the new log -> Promise<event>
 * Additions: count(), onChange(cb), CAP, GENESIS.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const AUDIT_KEY = "dc-palantir:audit";
  const META_KEY = "dc-palantir:audit:meta";
  const CAP = 5000;
  const GENESIS = "0".repeat(64);
  const FIELDS = ["id", "seq", "ts", "sessionId", "role", "surface", "kind", "verb", "objectIds", "datasetId", "payload", "checkpointId", "prevHash", "alg"];
  const listeners = [];
  let memoryLog = [];
  let memoryMeta = {};
  let queue = Promise.resolve();

  // ── storage ──
  function readLog() {
    if (!store) return memoryLog.slice();
    const value = store.get(AUDIT_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function readMeta() {
    if (!store) return { ...memoryMeta };
    const value = store.get(META_KEY, {});
    return value && typeof value === "object" ? value : {};
  }

  function writeLog(events, meta) {
    memoryLog = events.slice();
    memoryMeta = { ...meta };
    if (!store) return true;
    let list = events;
    let currentMeta = meta;
    // On quota errors drop the oldest fifth and retry: the log is a teaching aid, not a record.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (store.set(AUDIT_KEY, list)) {
        store.set(META_KEY, currentMeta);
        return true;
      }
      const drop = Math.max(1, Math.floor(list.length / 5));
      currentMeta = { dropped: (currentMeta.dropped || 0) + drop, anchorHash: list[drop - 1].hash };
      list = list.slice(drop);
    }
    return false;
  }

  // ── hashing ──
  function stable(value) {
    if (value === undefined) return "null";
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }

  function canonical(event) {
    return FIELDS.map((field) => `${field}=${stable(event[field] === undefined ? null : event[field])}`).join("|");
  }

  function fnv(text, seed) {
    let hash = seed >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function subtleAvailable() {
    return Boolean(window.crypto && window.crypto.subtle && window.isSecureContext !== false && window.TextEncoder);
  }

  async function digest(text, alg) {
    if (alg === "sha256") {
      const bytes = new TextEncoder().encode(text);
      const buffer = await window.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return fnv(text, 0x811c9dc5) + fnv(text, 0x01000193 ^ 0x5bd1e995);
  }

  // ── events ──
  function notify(source) {
    listeners.slice().forEach((callback) => {
      try {
        callback({ source });
      } catch (error) {
        console.error("[DC.audit] listener failed", error);
      }
    });
  }

  function sessionInfo() {
    const session = DC.session ? DC.session.get() : { sessionId: "s-unknown", role: "unknown" };
    return session;
  }

  function cleanIds(ids) {
    return Array.isArray(ids) ? [...new Set(ids.filter(Boolean).map(String))] : [];
  }

  async function append(partial) {
    const session = sessionInfo();
    const alg = subtleAvailable() ? "sha256" : "fnv1a-64";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const events = readLog();
      const meta = readMeta();
      const last = events[events.length - 1];
      const seq = last ? Number(last.seq || 0) + 1 : Number(meta.lastSeq || 0) + 1;
      const event = {
        id: `ev-${String(seq).padStart(6, "0")}`,
        seq,
        ts: new Date().toISOString(),
        sessionId: session.sessionId,
        role: partial.role || session.role,
        surface: partial.surface || (DC.session && DC.session.surface()) || "unknown",
        kind: partial.kind || "view",
        verb: partial.verb || "",
        objectIds: cleanIds(partial.objectIds),
        datasetId: partial.datasetId || null,
        payload: partial.payload && typeof partial.payload === "object" ? partial.payload : {},
        checkpointId: partial.checkpointId || null,
        prevHash: last ? last.hash : meta.anchorHash || GENESIS,
        alg,
      };
      let hash;
      try {
        hash = await digest(canonical(event), alg);
      } catch (_) {
        event.alg = "fnv1a-64";
        hash = await digest(canonical(event), event.alg);
      }
      event.hash = hash;
      // Another tab may have written while we hashed: start again from the new tail.
      const now = readLog();
      const tail = now[now.length - 1];
      if ((tail && tail.hash) !== (last && last.hash)) continue;
      let next = now.concat([event]);
      let nextMeta = { ...meta, lastSeq: seq };
      if (next.length > CAP) {
        const drop = next.length - CAP;
        nextMeta = { ...nextMeta, dropped: (meta.dropped || 0) + drop, anchorHash: next[drop - 1].hash };
        next = next.slice(drop);
      }
      writeLog(next, nextMeta);
      return event;
    }
    throw new Error("audit log busy");
  }

  function logEvent(partial) {
    const run = queue.then(() => append(partial || {}));
    queue = run.catch(() => null);
    return run.then((event) => {
      notify("local");
      return event;
    });
  }

  function readEvents(filter) {
    const criteria = filter || {};
    return readLog().filter((event) => {
      if (criteria.kind && event.kind !== criteria.kind) return false;
      if (criteria.role && event.role !== criteria.role) return false;
      if (criteria.surface && event.surface !== criteria.surface) return false;
      if (criteria.verb && event.verb !== criteria.verb) return false;
      if (criteria.sessionId && event.sessionId !== criteria.sessionId) return false;
      if (criteria.checkpointId && event.checkpointId !== criteria.checkpointId) return false;
      if (criteria.objectId && !(event.objectIds || []).includes(criteria.objectId)) return false;
      return true;
    });
  }

  async function verifyChain() {
    await queue;
    const events = readLog();
    const meta = readMeta();
    let expected = meta.anchorHash || GENESIS;
    for (const event of events) {
      if (event.prevHash !== expected) return { ok: false, brokenAt: event.id, count: events.length, dropped: meta.dropped || 0 };
      const { hash, ...rest } = event;
      const recomputed = await digest(canonical(rest), event.alg || "sha256");
      if (recomputed !== hash) return { ok: false, brokenAt: event.id, count: events.length, dropped: meta.dropped || 0 };
      expected = hash;
    }
    return { ok: true, brokenAt: null, count: events.length, dropped: meta.dropped || 0 };
  }

  function clear(reason) {
    const run = queue.then(async () => {
      const clearedCount = readLog().length;
      const meta = readMeta();
      writeLog([], { lastSeq: meta.lastSeq || 0 });
      return append({ kind: "audit", verb: "audit.clear", payload: { reason: String(reason || ""), clearedCount } });
    });
    queue = run.catch(() => null);
    return run.then((event) => {
      notify("local");
      return event;
    });
  }

  window.addEventListener("storage", (event) => {
    if (event.key === AUDIT_KEY) notify("storage");
  });

  DC.audit = {
    KEY: AUDIT_KEY,
    CAP,
    GENESIS,
    logEvent,
    readEvents,
    verifyChain,
    clear,
    count: () => readLog().length,
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();

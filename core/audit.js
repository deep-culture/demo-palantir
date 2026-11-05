/*
 * core/audit.js — one audit log for the whole platform, hash-chained.
 *
 * Classic script; attaches window.DC.audit. Load after core/store.js and core/session.js.
 * Spec §4.4 (F4), contract §5–6.
 *
 * Storage
 *   dc-palantir:audit        [event…]   oldest first, capped at 5,000 (oldest dropped)
 *   dc-palantir:audit:meta   {lastSeq, count, headSeq, headHash, dropped, anchorHash, capReached,
 *                             quotaDropped, clearedAt}
 *       lastSeq / count: the sequence number of the newest event and the log's length after every
 *       write, so a truncated tail is detected. headSeq / headHash: the first event kept, so events
 *       removed from the head are detected unless they were legitimately dropped. anchorHash = hash
 *       of the last dropped event (the chain still verifies after a drop); capReached / quotaDropped
 *       record WHY events were dropped, so a drop is only explained by the cap when the cap was hit.
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
 *   DC.audit.verifyChain()          -> Promise<{ok, brokenAt, count, dropped, capDropped, quotaDropped,
 *                                    problem, message, missing}>   problem: "hash" | "link" | "seq" |
 *                                    "tail" | "head" | "count" | null; message is one sentence for the UI
 *   DC.audit.clear(reason)          needs Instructor mode (session flag) and a reason of at least
 *                                    CLEAR_MIN_LENGTH (10) characters; otherwise the attempt is logged
 *                                    ("audit.clear", outcome "refused") and the promise resolves to
 *                                    {refused: true, message}. The clear is the first event of the new log.
 * This models tamper evidence. It is not tamper-proof: anyone with devtools can rewrite log and meta.
 * Additions: count(), onChange(cb), CAP, GENESIS.
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const AUDIT_KEY = "dc-palantir:audit";
  const META_KEY = "dc-palantir:audit:meta";
  const CAP = 5000;
  const CLEAR_MIN_LENGTH = 10;
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
      currentMeta = { ...currentMeta, dropped: (currentMeta.dropped || 0) + drop, quotaDropped: (currentMeta.quotaDropped || 0) + drop, anchorHash: list[drop - 1].hash };
      list = list.slice(drop);
      currentMeta = { ...currentMeta, ...headOf(list) };
    }
    return false;
  }

  function headOf(list) {
    return list.length ? { count: list.length, headSeq: list[0].seq, headHash: list[0].hash } : { count: 0 };
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
      // Numbering continues from the recorded newest seq, so a truncated tail stays visible as a gap.
      const seq = Math.max(last ? Number(last.seq || 0) : 0, Number(meta.lastSeq || 0)) + 1;
      const event = {
        id: `ev-${String(seq).padStart(6, "0")}`,
        seq,
        ts: new Date().toISOString(),
        sessionId: session.sessionId,
        // Review F-25: always the session's role; a caller-supplied role goes to payload.claimedRole.
        role: session.role,
        surface: partial.surface || (DC.session && DC.session.surface()) || "unknown",
        kind: partial.kind || "view",
        verb: partial.verb || "",
        objectIds: cleanIds(partial.objectIds),
        datasetId: partial.datasetId || null,
        payload: {
          ...(partial.payload && typeof partial.payload === "object" ? partial.payload : {}),
          ...(partial.role && partial.role !== session.role ? { claimedRole: String(partial.role) } : {}),
        },
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
      let dropped = false;
      if (next.length > CAP) {
        const drop = next.length - CAP;
        nextMeta = { ...nextMeta, dropped: (meta.dropped || 0) + drop, capReached: true, anchorHash: next[drop - 1].hash };
        next = next.slice(drop);
        dropped = true;
      }
      // The head anchor moves only when events are legitimately dropped (or on the first write).
      const head = headOf(next);
      nextMeta = dropped || meta.headSeq === undefined ? { ...nextMeta, ...head } : { ...nextMeta, count: head.count };
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

  function result(events, meta, fields) {
    const dropped = Number(meta.dropped || 0);
    const quota = Number(meta.quotaDropped || 0);
    return {
      ok: true,
      brokenAt: null,
      count: events.length,
      dropped,
      capDropped: meta.capReached ? Math.max(0, dropped - quota) : 0,
      quotaDropped: quota,
      problem: null,
      message: "",
      missing: 0,
      ...(fields || {}),
    };
  }

  async function verifyChain() {
    await queue;
    const events = readLog();
    const meta = readMeta();
    const broken = (fields) => result(events, meta, { ok: false, ...fields });
    const lastSeq = Number(meta.lastSeq || 0);
    if (!events.length) {
      return lastSeq > 0 ? broken({ problem: "tail", missing: Number(meta.count || 0) || 1, message: `The log is empty, but ${Number(meta.count || 0) || "some"} event(s) up to seq ${lastSeq} were recorded: events are missing.` }) : result(events, meta);
    }
    // Head: the first event must be the one recorded as the head (or, for logs written before the head
    // anchor existed, seq 1 / a clear, unless events were dropped).
    const first = events[0];
    const headSeq = meta.headSeq !== undefined ? Number(meta.headSeq) : meta.dropped ? null : first.verb === "audit.clear" ? first.seq : 1;
    if (headSeq !== null && Number(first.seq) !== headSeq) {
      const gone = Number(first.seq) - headSeq;
      return broken({
        brokenAt: first.id,
        problem: "head",
        missing: Math.abs(gone),
        message: gone > 0
          ? `${gone} event${gone === 1 ? "" : "s"} missing from the head (seq ${headSeq}–${Number(first.seq) - 1})${meta.capReached ? "" : `; the cap (${CAP}) was never reached, so they were not dropped`}.`
          : `The log starts before its recorded head (seq ${headSeq}): events were added at the head.`,
      });
    }
    if (meta.headHash && first.hash !== meta.headHash) {
      return broken({ brokenAt: first.id, problem: "head", message: `The first event (${first.id}) is not the one recorded as the head of the log.` });
    }
    let expected = meta.anchorHash || GENESIS;
    let previous = null;
    for (const event of events) {
      if (previous && Number(event.seq) !== Number(previous.seq) + 1) {
        const gap = Number(event.seq) - Number(previous.seq) - 1;
        return broken({ brokenAt: event.id, problem: "seq", missing: Math.max(0, gap), message: gap > 0 ? `${gap} event${gap === 1 ? "" : "s"} missing since seq ${previous.seq} (the next event kept is seq ${event.seq}).` : `Sequence goes back from ${previous.seq} to ${event.seq}.` });
      }
      if (event.prevHash !== expected) return broken({ brokenAt: event.id, problem: "link", message: `Hash chain broken at ${event.id}: an event before it was changed or removed.` });
      const { hash, ...rest } = event;
      const recomputed = await digest(canonical(rest), event.alg || "sha256");
      if (recomputed !== hash) return broken({ brokenAt: event.id, problem: "hash", message: `Hash chain broken at ${event.id}: the event was changed after it was written.` });
      expected = hash;
      previous = event;
    }
    // Tail: the newest event must be the last one recorded, and the length must match.
    const last = events[events.length - 1];
    if (lastSeq && Number(last.seq) !== lastSeq) {
      const missing = lastSeq - Number(last.seq);
      return broken({
        brokenAt: last.id,
        problem: "tail",
        missing: Math.abs(missing),
        message: missing > 0 ? `${missing} event${missing === 1 ? "" : "s"} missing since seq ${last.seq} (the log recorded seq ${lastSeq} as its newest).` : `The log holds events after its recorded newest seq ${lastSeq}.`,
      });
    }
    if (meta.count !== undefined && Number(meta.count) !== events.length) {
      return broken({ brokenAt: last.id, problem: "count", missing: Math.abs(Number(meta.count) - events.length), message: `The log holds ${events.length} events; ${meta.count} were recorded.` });
    }
    return result(events, meta);
  }

  function clear(reason) {
    const text = String(reason || "").trim();
    const instructor = Boolean(DC.session && DC.session.instructorMode && DC.session.instructorMode());
    if (!instructor || text.length < CLEAR_MIN_LENGTH) {
      const message = !instructor
        ? "Clear audit needs Instructor mode (session strip). This attempt has been logged."
        : `Clear audit needs a reason of at least ${CLEAR_MIN_LENGTH} characters (you wrote ${text.length}). This attempt has been logged.`;
      return logEvent({ kind: "audit", verb: "audit.clear", payload: { reason: text, outcome: "refused", instructor } }).then(() => ({ refused: true, message }));
    }
    const run = queue.then(async () => {
      const clearedCount = readLog().length;
      const meta = readMeta();
      writeLog([], { lastSeq: meta.lastSeq || 0, headSeq: Number(meta.lastSeq || 0) + 1, count: 0, clearedAt: new Date().toISOString() });
      return append({ kind: "audit", verb: "audit.clear", payload: { reason: text, clearedCount, outcome: "cleared" } });
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
    CLEAR_MIN_LENGTH,
    GENESIS,
    logEvent,
    readEvents,
    verifyChain,
    clear,
    count: () => readLog().length,
    // The sequence number the next event will get (review F-16: checkpoint record ids build on it).
    nextSeq: () => {
      const log = readLog();
      const last = log[log.length - 1];
      return Math.max(last ? Number(last.seq || 0) : 0, Number(readMeta().lastSeq || 0)) + 1;
    },
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();

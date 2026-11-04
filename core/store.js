/*
 * core/store.js — namespaced, versioned localStorage for both demos.
 *
 * Classic script (no modules yet): attaches window.DC.store.
 * Spec: REDESIGN_SPEC.md §6.1 (namespace) and §6.2 (seed contract versioning).
 *
 * Keys
 *   dc-palantir:gotham:{dataset}         {schemaVersion, buildId, data}   editable ontology
 *   dc-palantir:foundry:{dataset}        {schemaVersion, buildId, data}   UI state only
 *   <key>:stale                          {schemaVersion, buildId, data, staleSince, reason}
 *
 * loadVersioned(key, seed, options) returns {status, data, version, hasStale}:
 *   "seed"            nothing stored                      → data = null (caller uses the seed)
 *   "schema-changed"  stored.schemaVersion differs        → stored copy discarded, data = null
 *   "regenerated"     stored.buildId differs              → data = null, old copy kept under key + ":stale"
 *   "stored"          versions match                      → data = stored.data
 * A legacy key (options.legacyKey, e.g. "ontology-studio-demo-v2:starter") is migrated once,
 * only when nothing sits under the new key: its value becomes the stale copy and the status is
 * "regenerated" (with migrated: true), so users see the restore banner instead of losing edits.
 *
 * Fallback fingerprint for seeds without metadata.buildId (seeds built before schema 3):
 *   buildId       = "fallback:" + FNV-1a hash of
 *                   generatedAt (metadata.generatedAt || pipeline.generatedAt)
 *                   + counts of entities, edges, datasets, entity types, relationship types, mappings
 *   schemaVersion = metadata.schemaVersion if present, else 2 (the pre-versioning contract).
 * So a seed rebuilt by an old builder is still detected as "regenerated" when its timestamp or
 * counts change; a rebuild that changes neither is not detected (acceptable for old seeds).
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const NAMESPACE = "dc-palantir";
  const STALE_SUFFIX = ":stale";
  const LEGACY_SCHEMA_VERSION = 2;

  function storage() {
    try {
      return window.localStorage || null;
    } catch (_) {
      return null; // e.g. blocked third-party storage
    }
  }

  function key(...parts) {
    return [NAMESPACE, ...parts.filter((part) => part !== undefined && part !== null && part !== "")].join(":");
  }

  function getRaw(storageKey) {
    const ls = storage();
    if (!ls) return null;
    try {
      return ls.getItem(storageKey);
    } catch (error) {
      console.warn("[DC.store] read failed", storageKey, error);
      return null;
    }
  }

  function get(storageKey, fallback = null) {
    const raw = getRaw(storageKey);
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      console.warn("[DC.store] unparseable value, ignoring", storageKey, error);
      return fallback;
    }
  }

  function set(storageKey, value) {
    const ls = storage();
    if (!ls) return false;
    try {
      ls.setItem(storageKey, JSON.stringify(value));
      return true;
    } catch (error) {
      console.warn("[DC.store] write failed (quota or private mode?)", storageKey, error);
      return false;
    }
  }

  function remove(storageKey) {
    const ls = storage();
    if (!ls) return;
    try {
      ls.removeItem(storageKey);
    } catch (error) {
      console.warn("[DC.store] remove failed", storageKey, error);
    }
  }

  // FNV-1a 32-bit; only used for the fallback fingerprint, not for security.
  function hashString(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function count(value) {
    return Array.isArray(value) ? value.length : 0;
  }

  /** {schemaVersion, buildId, fallback} for a seed object (Gotham or Foundry shape). */
  function seedVersion(seed) {
    const metadata = (seed && seed.metadata) || {};
    const schemaVersion = typeof metadata.schemaVersion === "number" ? metadata.schemaVersion : LEGACY_SCHEMA_VERSION;
    if (typeof metadata.buildId === "string" && metadata.buildId) {
      return { schemaVersion, buildId: metadata.buildId, fallback: false };
    }
    const generatedAt = metadata.generatedAt || (seed && seed.pipeline && seed.pipeline.generatedAt) || "";
    const fingerprint = [
      generatedAt,
      count(seed && seed.entities),
      count(seed && seed.edges),
      count(seed && seed.datasets),
      count(seed && seed.ontology && seed.ontology.entityTypes),
      count(seed && seed.ontology && seed.ontology.relationshipTypes),
      count(seed && seed.mappings),
    ].join("|");
    return { schemaVersion, buildId: `fallback:${hashString(fingerprint)}`, fallback: true };
  }

  function isEnvelope(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) && "data" in value && "buildId" in value;
  }

  function hasStale(storageKey) {
    return getRaw(storageKey + STALE_SUFFIX) !== null;
  }

  function readStale(storageKey) {
    const stale = get(storageKey + STALE_SUFFIX, null);
    return isEnvelope(stale) ? stale : null;
  }

  function writeStale(storageKey, envelope, reason) {
    set(storageKey + STALE_SUFFIX, {
      schemaVersion: envelope.schemaVersion ?? null,
      buildId: envelope.buildId ?? null,
      data: envelope.data,
      staleSince: new Date().toISOString(),
      reason,
    });
  }

  function migrateLegacy(storageKey, legacyKey) {
    if (!legacyKey) return false;
    const legacyRaw = getRaw(legacyKey);
    if (legacyRaw === null) return false;
    let legacyValue = null;
    try {
      legacyValue = JSON.parse(legacyRaw);
    } catch (_) {
      legacyValue = null;
    }
    if (legacyValue !== null && !hasStale(storageKey)) {
      writeStale(storageKey, { schemaVersion: null, buildId: `legacy:${legacyKey}`, data: legacyValue }, "migrated");
    }
    remove(legacyKey);
    return legacyValue !== null;
  }

  /**
   * Load a versioned value. The caller supplies the seed (to read its version) and falls back to
   * the seed itself (Gotham) or to empty UI state (Foundry) whenever data is null.
   */
  function loadVersioned(storageKey, seed, options = {}) {
    const version = seedVersion(seed);
    const stored = get(storageKey, null);

    if (stored === null) {
      const migrated = migrateLegacy(storageKey, options.legacyKey);
      return {
        status: migrated ? "regenerated" : "seed",
        migrated,
        data: null,
        version,
        hasStale: hasStale(storageKey),
      };
    }
    // Something under the new key: any leftover legacy key is obsolete.
    if (options.legacyKey) remove(options.legacyKey);

    if (!isEnvelope(stored) || stored.schemaVersion !== version.schemaVersion) {
      // Edits made against an older data format are not trustworthy: drop them and any stale copy.
      remove(storageKey);
      remove(storageKey + STALE_SUFFIX);
      return { status: "schema-changed", migrated: false, data: null, version, hasStale: false };
    }
    if (stored.buildId !== version.buildId) {
      writeStale(storageKey, stored, "regenerated");
      remove(storageKey);
      return { status: "regenerated", migrated: false, data: null, version, hasStale: true };
    }
    return { status: "stored", migrated: false, data: stored.data, version, hasStale: hasStale(storageKey) };
  }

  /** Save data wrapped with the seed's current version. */
  function saveVersioned(storageKey, seed, data) {
    const version = seedVersion(seed);
    return set(storageKey, { schemaVersion: version.schemaVersion, buildId: version.buildId, data });
  }

  /**
   * Make the stale copy current again: it is re-stamped with the seed's current version (so it is
   * not flagged as stale on the next load) and the stale slot is cleared. Returns the data or null.
   */
  function restoreStale(storageKey, seed) {
    const stale = readStale(storageKey);
    if (!stale) {
      remove(storageKey + STALE_SUFFIX);
      return null;
    }
    if (seed) {
      saveVersioned(storageKey, seed, stale.data);
    } else {
      set(storageKey, { schemaVersion: stale.schemaVersion, buildId: stale.buildId, data: stale.data });
    }
    remove(storageKey + STALE_SUFFIX);
    return stale.data;
  }

  function dismissStale(storageKey) {
    remove(storageKey + STALE_SUFFIX);
  }

  DC.store = {
    NAMESPACE,
    key,
    get,
    set,
    remove,
    seedVersion,
    loadVersioned,
    saveVersioned,
    hasStale,
    readStale,
    restoreStale,
    dismissStale,
  };
})();

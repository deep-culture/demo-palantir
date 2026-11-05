/*
 * core/objectsets.js — object sets: saved, versioned lists of object ids (spec §4.11 F11; contract §3, §5).
 *
 * Classic script; attaches window.DC.objectSets. Load after store, governance, session, audit.
 * Storage: dc-palantir:governance.objectSets (shared by every app and tab, like the action log).
 *
 *   set = {id, name, datasetId, memberIds, createdBy, createdAt, source, sharedWith: [roleId],
 *          versions: [{v, ts, added, removed, by}]}
 *     createdBy is the role that saved it; source says where it came from ("graph", "rule:<id>",
 *     "search", "agent:<runId>", …). Version 1 adds every member.
 *
 *   DC.objectSets.list(filter?)      {datasetId, role} -> sets, newest first. With role: only the
 *                                    sets that role created or that were shared with it.
 *   DC.objectSets.get(id)            set or null
 *   DC.objectSets.save(set)          {name, memberIds, datasetId, source} -> Promise<set>
 *                                    ("objectset" event "objectSet.save")
 *   DC.objectSets.update(id, {add, remove}) -> Promise<set|null>   a new version when anything changed
 *                                    ("objectSet.update" with added/removed)
 *   DC.objectSets.share(id, roles)   -> Promise<set|null>   replaces sharedWith ("objectSet.share")
 *   DC.objectSets.remove(id)         -> Promise<boolean>     ("objectSet.delete")
 *   DC.objectSets.membersAt(set, v)  member ids after version v
 *   DC.objectSets.diff(set, fromV, toV) -> {added, removed}
 *   DC.objectSets.canSee(set, roleId)
 *   DC.objectSets.onChange(cb)       also fires for writes from another tab
 *
 * Fix round (contract §2 D): a set shared with a role is view-only for that role.
 *   DC.objectSets.canEdit(set, roleId)  the creating role, or the DPO (role id "dpo" or a role with
 *                                    canEditObjectSets), may update, share and delete; any other role's
 *                                    attempt changes nothing and is logged with outcome "refused".
 *
 * Sharing is simulated: the role is a client-side convenience (spec §4.1). The audit events carry the
 * set id in payload.setId and the member ids in objectIds (capped at 40).
 */
(function () {
  "use strict";

  const DC = (window.DC = window.DC || {});
  const store = DC.store;
  const GOV_KEY = "dc-palantir:governance";
  const ID_CAP = 40;
  const listeners = [];
  let memory = {};
  let counter = 0;
  let lastSeen = "";

  function readState() {
    const value = store ? store.get(GOV_KEY, null) : memory;
    return value && typeof value === "object" ? value : {};
  }

  function sets() {
    const list = readState().objectSets;
    return Array.isArray(list) ? list : [];
  }

  function writeSets(list) {
    memory = { ...memory, objectSets: list };
    if (store) store.patch(GOV_KEY, (current) => ({ ...current, objectSets: list })); // review F-21
    lastSeen = JSON.stringify(list);
  }

  function notify(source) {
    listeners.slice().forEach((callback) => {
      try {
        callback({ source });
      } catch (error) {
        console.error("[DC.objectSets] listener failed", error);
      }
    });
  }

  function role() {
    return DC.session ? DC.session.get().role : "unknown";
  }

  function uniq(list) {
    return [...new Set((Array.isArray(list) ? list : []).filter(Boolean).map(String))];
  }

  function log(verb, set, payload) {
    if (!DC.audit) return Promise.resolve(null);
    return DC.audit.logEvent({
      kind: "objectset",
      verb,
      objectIds: (payload && payload.objectIds ? payload.objectIds : set.memberIds).slice(0, ID_CAP),
      datasetId: set.datasetId || null,
      payload: { setId: set.id, name: set.name, size: set.memberIds.length, version: set.versions.length, ...(payload || {}), objectIds: undefined },
    });
  }

  function newId() {
    counter += 1;
    return `os-${Date.now().toString(36)}-${String(counter).padStart(2, "0")}`;
  }

  function list(filter) {
    const f = filter || {};
    return sets()
      .filter((set) => (!f.datasetId || !set.datasetId || set.datasetId === f.datasetId) && (!f.role || canSee(set, f.role)))
      .slice()
      .reverse();
  }

  function get(id) {
    return sets().find((set) => set.id === id) || null;
  }

  function canEdit(set, roleId) {
    if (!set) return false;
    const who = roleId || role();
    if (!(DC.governance && DC.governance.isActive())) return true;
    const governanceRole = DC.governance.role(who);
    return set.createdBy === who || who === "dpo" || Boolean(governanceRole && governanceRole.canEditObjectSets);
  }

  function refuse(verb, set) {
    return log(verb, set, { outcome: "refused", objectIds: [] }).then(() => null);
  }

  function canSee(set, roleId) {
    return Boolean(set) && (set.createdBy === roleId || (set.sharedWith || []).includes(roleId));
  }

  async function save(input) {
    const value = input || {};
    const members = uniq(value.memberIds);
    const ts = new Date().toISOString();
    const set = {
      id: value.id && !get(value.id) ? String(value.id) : newId(),
      name: String(value.name || `Object set ${sets().length + 1}`),
      datasetId: value.datasetId || null,
      memberIds: members,
      createdBy: role(),
      createdAt: ts,
      source: String(value.source || "manual"),
      sharedWith: [],
      versions: [{ v: 1, ts, added: members, removed: [], by: role() }],
    };
    writeSets(sets().concat([set]));
    await log("objectSet.save", set, { source: set.source, added: members.length, removed: 0 });
    notify("local");
    return set;
  }

  async function update(id, change) {
    const all = sets();
    const index = all.findIndex((set) => set.id === id);
    if (index < 0) return null;
    if (!canEdit(all[index])) return refuse("objectSet.update", all[index]);
    const set = { ...all[index] };
    const current = new Set(set.memberIds);
    const added = uniq(change && change.add).filter((item) => !current.has(item));
    const removed = uniq(change && change.remove).filter((item) => current.has(item));
    if (!added.length && !removed.length) return set;
    const next = set.memberIds.filter((item) => !removed.includes(item)).concat(added);
    set.memberIds = next;
    set.versions = (set.versions || []).concat([{ v: (set.versions || []).length + 1, ts: new Date().toISOString(), added, removed, by: role() }]);
    all[index] = set;
    writeSets(all);
    await log("objectSet.update", set, { added: added.length, removed: removed.length, objectIds: [...added, ...removed] });
    notify("local");
    return set;
  }

  async function share(id, roles) {
    const all = sets();
    const index = all.findIndex((set) => set.id === id);
    if (index < 0) return null;
    if (!canEdit(all[index])) return refuse("objectSet.share", all[index]);
    const previous = all[index].sharedWith || [];
    const set = { ...all[index], sharedWith: uniq(roles).filter((item) => item !== all[index].createdBy) };
    all[index] = set;
    writeSets(all);
    await log("objectSet.share", set, { sharedWith: set.sharedWith, from: previous, objectIds: [] });
    notify("local");
    return set;
  }

  async function remove(id) {
    const set = get(id);
    if (!set) return false;
    if (!canEdit(set)) return refuse("objectSet.delete", set).then(() => false);
    writeSets(sets().filter((item) => item.id !== id));
    await log("objectSet.delete", set, { objectIds: [] });
    notify("local");
    return true;
  }

  function membersAt(set, version) {
    const members = [];
    (set.versions || []).forEach((entry) => {
      if (entry.v > version) return;
      (entry.removed || []).forEach((id) => {
        const at = members.indexOf(id);
        if (at >= 0) members.splice(at, 1);
      });
      (entry.added || []).forEach((id) => {
        if (!members.includes(id)) members.push(id);
      });
    });
    return members;
  }

  function diff(set, fromV, toV) {
    const before = new Set(membersAt(set, fromV));
    const after = new Set(membersAt(set, toV));
    return { added: [...after].filter((id) => !before.has(id)), removed: [...before].filter((id) => !after.has(id)) };
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== GOV_KEY) return;
    const now = JSON.stringify(sets());
    if (now === lastSeen) return;
    lastSeen = now;
    notify("storage");
  });
  lastSeen = JSON.stringify(sets());

  DC.objectSets = {
    KEY: GOV_KEY,
    list,
    get,
    save,
    update,
    share,
    remove,
    membersAt,
    diff,
    canSee,
    canEdit,
    onChange(callback) {
      if (typeof callback === "function") listeners.push(callback);
    },
  };
})();

// demo/js/agent-plan.js — How the agent turns a question into tool calls and an answer (spec §4.7; contract §2).
// Deterministic: the intent comes from the wording of the query, the plan from the intent, the answer only
// from tool results. Every answer sentence carries ≥ 1 citation (an object or link id) and the numbers of
// the steps it relies on; facts from a denied step are never used. The scripted failure modes are applied
// here: fabricated-link adds one sentence citing a link id that does not exist; overreach adds a tool call
// the role may not make (it is denied and logged); approve-all stages several edits.
import { normalizeText } from "./util.js";
import { core, roleView } from "./state.js";
import { currentRoleId, isWithheldValue, lackingMarkings } from "./governance.js";
import { entityById } from "./derive.js";
import { EXAMPLE_FAILURES, summarizeEntityForCopilot } from "./agent.js";
import { idExists, linkTypeMarkings } from "./agent-tools.js";

const LINK_VERBS = {
  DIRECTS: "directs",
  BENEFICIALLY_OWNS: "beneficially owns",
  OWNS_ACCOUNT: "owns account",
  USES_DEVICE: "uses device",
  BOOKED_ON: "is booked on",
  LISTED_ON: "is listed on",
  REGISTERED_AT: "is registered at",
  RESIDES_AT: "resides at",
  OBSERVED_AT: "was observed at",
  HAS_CORP_ACCOUNT: "holds corporate account",
};
const OVERREACH_LINKS = [
  ["FIN", "OWNS_ACCOUNT"],
  ["TELECOM", "USES_DEVICE"],
  ["HEALTH", "RESIDES_AT"],
  ["LE-SENSITIVE", "LISTED_ON"],
];

// ── intent ──
export function builtinFailure(query) {
  const key = normalizeText(query);
  const hit = Object.keys(EXAMPLE_FAILURES).find((example) => normalizeText(example) === key);
  return hit ? EXAMPLE_FAILURES[hit] : "none";
}

function stripLead(text) {
  return String(text || "")
    .replace(/^\s*(please\s+)?(summari[sz]e|tell me about|who is|what about|show me|bring together|describe)\s+/i, "")
    .replace(/[?.!]+\s*$/, "")
    .trim();
}

export function detectIntent(query, objectSetId) {
  const text = String(query || "").trim();
  const norm = normalizeText(text);
  if (objectSetId) return { kind: "set", objectSetId };
  if (/watchlist/.test(norm) && /(add|should|who|candidate)/.test(norm)) return { kind: "watchlist" };
  if (/phone/.test(norm)) {
    const name = text.replace(/^.*?(connected to|around|of|behind)\s+/i, "").replace(/['’]s\s+phones?.*$/i, "").replace(/\s+phones?.*$/i, "").trim();
    return { kind: "phones", subject: name || text };
  }
  const link = text.match(/^\s*(?:what|how)\s+(?:links|connects|is)\s+(.+?)\s+(?:to|with|and)\s+(.+?)[?.!]*\s*$/i);
  if (link) return { kind: "link", a: link[1].replace(/\s+(connected|linked)$/i, ""), b: link[2] };
  return { kind: "summary", subject: stripLead(text) || text };
}

export function planFor(intent, failureMode) {
  const plans = {
    summary: ["search_objects(query, type Person)", "get_links(each match)", "run_rule(watchlist-operators)", "get_lineage(first match)", "propose_action(if a match looks like a listed person)"],
    watchlist: ["run_rule(travel-finance-overlap)", "run_rule(shared-booking-artifacts)", "expand(risk-tagged people, depth 4, company + address links)", "propose_action(each untagged person)"],
    phones: ["search_objects(name, type Person)", "expand(person, depth 4, USES_DEVICE + OBSERVED_AT)"],
    link: ["search_objects(a, type Person)", "search_objects(b, type Company)", "get_links(company)"],
    set: ["search_objects(objectSetId)", "run_rule(watchlist-operators)", "get_links(person members)"],
  };
  const plan = (plans[intent.kind] || plans.summary).slice();
  if (failureMode === "overreach") plan.push("get_links / propose_action outside the role (overreach)");
  return plan;
}

// ── helpers ──
function label(id) {
  const entity = entityById(id);
  return entity ? entity.label : id;
}

function visibleValue(entity, key) {
  const value = entity?.properties?.[key];
  return isWithheldValue(value) ? "" : value || "";
}

function otherEnd(edge, id) {
  return edge.source === id ? edge.target : edge.source;
}

function list(labels) {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function personActionType() {
  if (!core.actions) return null;
  const role = currentRoleId();
  return ["act-add-to-watchlist", "act-request-border-watch"].map((id) => core.actions.type(id)).find((type) => type && (type.allowedRoles || []).includes(role)) || null;
}

export function fillParams(type, hints) {
  const params = {};
  (type.parameters || []).forEach((param) => {
    if (hints[param.id] !== undefined) params[param.id] = hints[param.id];
    else if (param.type === "enum") params[param.id] = (param.options || [])[param.id === "duration" ? 1 : 0] || "";
    else if (param.type === "boolean") params[param.id] = false;
    else params[param.id] = hints.reason || "Suggested by the agent from linked records.";
  });
  return params;
}

async function propose(ctx, person, hints, reasonCites) {
  const type = personActionType();
  if (!type) return null;
  const result = await ctx.step("propose_action", { actionTypeId: type.id, objectId: person.id, params: fillParams(type, hints) });
  if (result.denied) return null;
  return { type, instance: result.data.instance, step: ctx.lastStep(), cites: reasonCites };
}

// One sentence per kind of link around a person, citing the links.
function linkSentences(ctx, person, edges, stepN) {
  const by = new Map();
  edges.forEach((edge) => {
    if (!LINK_VERBS[edge.type]) return;
    if (!by.has(edge.type)) by.set(edge.type, []);
    by.get(edge.type).push(edge);
  });
  by.forEach((group, type) => {
    const shown = group.slice(0, 4);
    const names = shown.map((edge) => label(otherEnd(edge, person.id)));
    const more = group.length > shown.length ? ` and ${group.length - shown.length} more` : "";
    const verb = type === "BOOKED_ON" ? `is booked on ${group.length} flight${group.length === 1 ? "" : "s"}:` : LINK_VERBS[type];
    ctx.say(`${person.label} ${verb} ${list(names)}${more}.`, shown.map((edge) => edge.id), [stepN]);
  });
}

// ── intents ──
async function summary(ctx, intent) {
  const found = await ctx.step("search_objects", { query: intent.subject, type: "Person" });
  const s1 = ctx.lastStep();
  let persons = found.resultIds.slice(0, 3).map(entityById).filter(Boolean);
  if (!persons.length) {
    const any = await ctx.step("search_objects", { query: intent.subject });
    const objects = any.resultIds.slice(0, 2).map(entityById).filter(Boolean);
    if (!objects.length) {
      ctx.note(`No object visible to your role matches “${intent.subject}”.${found.withheld ? ` ${found.withheld} Person object${found.withheld === 1 ? " is" : "s are"} withheld from your role.` : ""}`);
      return;
    }
    for (const object of objects) {
      const links = await ctx.step("get_links", { objectId: object.id });
      ctx.say(summarizeEntityForCopilot(object).headline, [object.id, ...links.resultIds.slice(0, 2)], [ctx.lastStep() - 1, ctx.lastStep()]);
    }
    return;
  }
  const threshold = core.resolution && core.resolution.isActive() ? core.resolution.threshold() : null;
  if (persons.length >= 2) {
    ctx.say(`${persons.length === 2 ? "Two" : persons.length} people visible to your role match “${intent.subject}”: ${list(persons.map((p) => p.label))}.`, persons.map((p) => p.id), [s1]);
    const [a, b] = persons;
    const pair = core.resolution && core.resolution.candidatesFor ? core.resolution.candidatesFor(a.id).find((item) => [item.candidate.left, item.candidate.right].includes(b.id)) : null;
    if (pair) {
      ctx.say(`They are separate people at threshold ${Number(threshold).toFixed(2)}: the resolver scores the pair ${Number(pair.candidate.score).toFixed(2)}, below the threshold. ${pair.candidate.explanation || ""}`.trim(), [a.id, b.id], [s1]);
    }
  }
  persons.forEach((person) => {
    const merge = roleView.resolution?.mergedById?.get(person.id);
    if (merge) {
      ctx.say(`At threshold ${Number(merge.threshold).toFixed(2)} the platform treats ${list(merge.members.map((m) => m.label))} as one person, ${person.label}: ${merge.members.length} source identities merged, so everything below is about all of them.`, [person.id, ...merge.members.map((m) => m.id)], [s1]);
    }
  });
  const linksByPerson = new Map();
  for (const person of persons.slice(0, 2)) {
    linksByPerson.set(person.id, { result: await ctx.step("get_links", { objectId: person.id }), n: ctx.lastStep() });
  }
  const rule = await ctx.step("run_rule", { ruleId: "watchlist-operators" });
  const ruleStep = ctx.lastStep();
  await ctx.step("get_lineage", { objectId: persons[0].id });
  persons.slice(0, 2).forEach((person) => {
    const { result, n } = linksByPerson.get(person.id);
    const tag = visibleValue(person, "riskTag");
    const merge = roleView.resolution?.mergedById?.get(person.id);
    const dob = visibleValue(person, "dob");
    if (tag) ctx.say(`${person.label} carries the risk tag “${tag}”.`, [person.id], [s1]);
    else if (!isWithheldValue(person.properties?.riskTag)) ctx.say(`${person.label}${dob ? ` (born ${dob})` : ""} has no risk tag in your view.`, [person.id], [s1]);
    if (!result.denied) linkSentences(ctx, person, result.data.edges || [], n);
    if (merge && !result.denied) ctx.note(`Some of ${person.label}'s links come from a merged identity: check the merge chip before relying on them.`);
  });
  if (!rule.denied) {
    persons.forEach((person) => {
      const index = rule.data.hits.findIndex((hit) => (hit.focusEntityIds || []).includes(person.id));
      if (index >= 0) ctx.say(`${person.label} ranks #${index + 1} of ${rule.data.hits.length} in the rule “${rule.data.rule.title}”.`, [person.id], [ruleStep]);
    });
  }
  const tagged = persons.filter((p) => visibleValue(p, "riskTag"));
  const untagged = persons.filter((p) => !visibleValue(p, "riskTag") && !isWithheldValue(p.properties?.riskTag));
  if (tagged.length && untagged.length) {
    const targets = ctx.failureMode === "approve-all" ? untagged : untagged.slice(0, 1);
    for (const person of targets) {
      const staged = await propose(ctx, person, { riskTag: visibleValue(tagged[0], "riskTag"), reason: `Shares the name and a travel route with ${tagged[0].label} (agent suggestion)` });
      if (staged) ctx.say(`I staged “${staged.type.label}” for ${person.label} for your review: the name and a travel route match ${tagged[0].label}, who is risk-tagged.`, [person.id, tagged[0].id], [s1, staged.step]);
    }
  }
}

async function watchlist(ctx) {
  const r1 = await ctx.step("run_rule", { ruleId: "travel-finance-overlap" });
  const n1 = ctx.lastStep();
  const r2 = await ctx.step("run_rule", { ruleId: "shared-booking-artifacts" });
  const n2 = ctx.lastStep();
  const hits = [];
  [[r1, n1], [r2, n2]].forEach(([result, n]) => {
    if (result.denied) return;
    result.data.hits.forEach((hit) => (hit.focusEntityIds || []).forEach((id) => hits.push({ id, hit, rule: result.data.rule, n })));
  });
  // Associates: people reached from risk-tagged people through companies and shared registered addresses.
  const tagged = [...new Set(hits.map((item) => item.id))].filter((id) => visibleValue(entityById(id), "riskTag"));
  if (tagged.length) {
    const near = await ctx.step("expand", { objectIds: tagged.slice(0, 6), depth: 4, linkTypes: ["DIRECTS", "BENEFICIALLY_OWNS", "REGISTERED_AT"] });
    const n3 = ctx.lastStep();
    if (!near.denied) {
      const via = { id: "associates", title: "associates of risk-tagged people (shared companies or registered addresses)" };
      near.resultIds.forEach((id) => {
        const person = entityById(id);
        if (!person || person.type !== "Person") return;
        const edges = near.data.edges || [];
        const own = edges.filter((edge) => edge.source === id && (edge.type === "DIRECTS" || edge.type === "BENEFICIALLY_OWNS")).slice(0, 1);
        const at = own.length ? edges.filter((edge) => edge.type === "REGISTERED_AT" && edge.source === own[0].target).slice(0, 1) : [];
        hits.push({ id, hit: { detail: `linked to a risk-tagged person through ${associationPath(edges, id)}` }, rule: via, n: n3, cites: [...own, ...at].map((edge) => edge.id) });
      });
    }
  }
  const seen = new Set();
  const limit = ctx.failureMode === "approve-all" ? 5 : 3;
  const picks = hits.filter((item) => {
    const person = entityById(item.id);
    if (!person || person.type !== "Person" || seen.has(item.id) || visibleValue(person, "riskTag") || isWithheldValue(person.properties?.riskTag)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, limit);
  if (!picks.length) {
    ctx.note("No untagged person appears in the rules your role can run.");
    return;
  }
  ctx.say(`${picks.length} people without a risk tag come up as ${list([...new Set(picks.map((item) => (item.rule.id === "associates" ? item.rule.title : `hits of “${item.rule.title}”`)))])}: ${list(picks.map((item) => label(item.id)))}.`, picks.map((item) => item.id), [...new Set(picks.map((item) => item.n))]);
  picks.forEach((item) => ctx.say(`${label(item.id)}: ${item.hit.detail}${item.rule.id === "associates" ? "" : ` (${item.rule.title})`}.`, [item.id, ...(item.cites || [])], [item.n]));
  const staged = [];
  for (const item of picks) {
    const result = await propose(ctx, entityById(item.id), { riskTag: item.rule.id === "shared-booking-artifacts" ? "facilitator" : "procurement-network", reason: `${item.rule.id === "associates" ? "Associate" : item.rule.title}: ${item.hit.detail} (agent suggestion)`.slice(0, 240) });
    if (result) staged.push({ ...result, id: item.id });
  }
  if (staged.length) {
    ctx.say(`I staged ${staged.length} “${staged[0].type.label}” edit${staged.length === 1 ? "" : "s"}; nothing changes until someone approves ${staged.length === 1 ? "it" : "them"}.`, staged.map((item) => item.id), staged.map((item) => item.step));
  }
}

function associationPath(edges, personId) {
  const own = edges.filter((edge) => edge.source === personId && (edge.type === "DIRECTS" || edge.type === "BENEFICIALLY_OWNS"));
  const company = own[0] ? label(own[0].target) : "";
  const address = own[0] ? edges.find((edge) => edge.type === "REGISTERED_AT" && edge.source === own[0].target) : null;
  return company ? `${company}${address ? ` (registered at ${label(address.target)})` : ""}` : "a shared company";
}

async function phones(ctx, intent) {
  const found = await ctx.step("search_objects", { query: intent.subject, type: "Person" });
  const s1 = ctx.lastStep();
  const person = entityById(found.resultIds[0]);
  if (!person) {
    ctx.note(`No person visible to your role matches “${intent.subject}”.`);
    return;
  }
  const expanded = await ctx.step("expand", { objectIds: [person.id], depth: 4, linkTypes: ["USES_DEVICE", "OBSERVED_AT"] });
  const s2 = ctx.lastStep();
  let people = [];
  if (expanded.denied) {
    ctx.say(`${person.label} is a person in your view; the agent could not follow his devices, so it says nothing about who is connected to them.`, [person.id], [s1]);
  } else {
    const edges = expanded.data.edges || [];
    const uses = edges.filter((edge) => edge.type === "USES_DEVICE" && edge.source === person.id);
    const devices = uses.map((edge) => edge.target);
    if (uses.length) ctx.say(`${person.label} uses ${list(devices.map(label))}.`, uses.map((edge) => edge.id), [s2]);
    const seenAt = edges.filter((edge) => edge.type === "OBSERVED_AT" && devices.includes(edge.source));
    if (seenAt.length) ctx.say(`${devices.length === 1 ? "That device was" : "Those devices were"} observed at ${list([...new Set(seenAt.map((edge) => label(edge.target)))].slice(0, 5))}.`, seenAt.slice(0, 6).map((edge) => edge.id), [s2]);
    const places = new Set(seenAt.map((edge) => edge.target));
    const others = edges.filter((edge) => edge.type === "OBSERVED_AT" && places.has(edge.target) && !devices.includes(edge.source));
    const otherDevices = new Set(others.map((edge) => edge.source));
    const otherUses = edges.filter((edge) => edge.type === "USES_DEVICE" && otherDevices.has(edge.target) && edge.source !== person.id);
    people = [...new Set(otherUses.map((edge) => edge.source))];
    if (people.length) ctx.say(`People whose devices were seen at the same places: ${list(people.map(label))}.`, [...people, ...otherUses.slice(0, 4).map((edge) => edge.id)], [s2]);
    else if (uses.length) ctx.say(`No other person's device was seen at those places in your view.`, uses.map((edge) => edge.id), [s2]);
    else ctx.say(`No device of ${person.label} is visible to your role.`, [person.id], [s1, s2]);
  }
  if (ctx.failureMode === "overreach") await overreach(ctx, people.length ? people : [person.id]);
}

async function link(ctx, intent) {
  const a = await ctx.step("search_objects", { query: intent.a, type: "Person" });
  const sa = ctx.lastStep();
  let b = await ctx.step("search_objects", { query: intent.b, type: "Company" });
  if (!b.resultIds.length) b = await ctx.step("search_objects", { query: intent.b });
  const sb = ctx.lastStep();
  const persons = a.resultIds.slice(0, 3).map(entityById).filter(Boolean);
  const target = entityById(b.resultIds[0]);
  if (!persons.length || !target) {
    ctx.note(`The agent found ${persons.length ? "no match" : "no person"} for ${persons.length ? `“${intent.b}”` : `“${intent.a}”`} in your view.`);
    return;
  }
  const links = await ctx.step("get_links", { objectId: target.id });
  const sl = ctx.lastStep();
  const edges = links.denied ? [] : links.data.edges || [];
  const unlinked = [];
  persons.forEach((person) => {
    const direct = edges.filter((edge) => otherEnd(edge, target.id) === person.id);
    if (direct.length) direct.forEach((edge) => ctx.say(`${person.label} ${LINK_VERBS[edge.type] || edge.type} ${target.label}.`, [edge.id], [sl]));
    else unlinked.push(person);
  });
  unlinked.forEach((person) => {
    if (ctx.failureMode === "fabricated-link" && !ctx.fabricated) {
      ctx.fabricate(person, target, [sa, sb, sl]);
    } else {
      ctx.say(`${person.label} has no recorded link to ${target.label} in your view.`, [person.id, target.id], [sa, sb, sl]);
    }
  });
  const others = edges.filter((edge) => !persons.some((p) => p.id === otherEnd(edge, target.id)) && entityById(otherEnd(edge, target.id))?.type === "Person");
  if (others.length) ctx.say(`Other people linked to ${target.label}: ${list(others.map((edge) => `${label(otherEnd(edge, target.id))} (${LINK_VERBS[edge.type] || edge.type})`))}.`, others.map((edge) => edge.id), [sl]);
}

async function setIntent(ctx, intent) {
  const found = await ctx.step("search_objects", { objectSetId: intent.objectSetId });
  const s1 = ctx.lastStep();
  if (found.denied) {
    ctx.note("The object set could not be read.");
    return;
  }
  const set = found.data.set;
  const visible = found.resultIds.map(entityById).filter(Boolean);
  if (!visible.length) {
    ctx.note(`Your role sees none of the ${set.memberIds.length} members of “${set.name}” (${found.withheld} withheld).`);
    return;
  }
  ctx.say(`The set “${set.name}” has ${set.memberIds.length} members; your role sees ${visible.length}${found.withheld ? ` and ${found.withheld} are withheld` : ""}.`, visible.slice(0, 8).map((e) => e.id), [s1]);
  const types = new Map();
  visible.forEach((entity) => types.set(entity.type, (types.get(entity.type) || 0) + 1));
  ctx.say(`By type: ${[...types.entries()].map(([type, n]) => `${n} ${type}`).join(", ")}.`, visible.slice(0, 8).map((e) => e.id), [s1]);
  const rule = await ctx.step("run_rule", { ruleId: "watchlist-operators" });
  if (!rule.denied) {
    const inRule = visible.filter((entity) => rule.resultIds.includes(entity.id));
    if (inRule.length) ctx.say(`${inRule.length} member${inRule.length === 1 ? " appears" : "s appear"} in “${rule.data.rule.title}”: ${list(inRule.map((e) => e.label))}.`, inRule.map((e) => e.id), [ctx.lastStep()]);
  }
  for (const person of visible.filter((e) => e.type === "Person").slice(0, 3)) {
    const links = await ctx.step("get_links", { objectId: person.id });
    if (!links.denied) ctx.say(summarizeEntityForCopilot(person).headline, [person.id, ...links.resultIds.slice(0, 2)], [s1, ctx.lastStep()]);
  }
}

// ── failure modes ──
// Overreach: one tool call the role may not make. A link type whose marking the role lacks, or else an
// Action the role may not run. The step is denied and logged; nothing from it reaches the answer.
export async function overreach(ctx, focusIds) {
  const ids = (focusIds || []).filter((id) => entityById(id)).slice(0, 5);
  const already = ctx.run.steps.filter((step) => step.denied).map((step) => step.reason).join(" ");
  const missing = OVERREACH_LINKS.find(([marking, type]) => lackingMarkings([marking]).length && linkTypeMarkings(type).includes(marking) && !already.includes(`marking ${marking}`));
  if (missing && ids.length) {
    await ctx.step("get_links", { objectIds: ids, linkType: missing[1] });
    return;
  }
  const type = core.actions && core.actions.types().find((item) => item.objectType === "Person" && !(item.allowedRoles || []).includes(currentRoleId()));
  const person = ids.map(entityById).find((entity) => entity && entity.type === "Person");
  if (type && person) await ctx.step("propose_action", { actionTypeId: type.id, objectId: person.id, params: fillParams(type, { reason: "Overreach: the agent tries an Action outside your role." }) });
}

// A plausible link id in the seed's convention ("beneficially_owns::person-…-company-…") that does not exist.
export function fabricatedLinkId(person, target) {
  const slug = (id) => String(id).replace("::", "-");
  const type = target.type === "Company" ? "beneficially_owns" : "directs";
  let id = `${type}::${slug(person.id)}-${slug(target.id)}`;
  while (idExists(id)) id += "-x";
  return id;
}

export function fabricatedSentence(person, target) {
  return target.type === "Company" ? `${person.label} is also a beneficial owner of ${target.label}.` : `${person.label} is directly linked to ${target.label}.`;
}

// For prompts without a built-in fabrication: pick the first cited person and a company it is not linked to.
export function fabricateAnywhere(ctx, data) {
  const cited = ctx.run.answer.flatMap((sentence) => sentence.cites).map(entityById).filter(Boolean);
  const person = cited.find((entity) => entity.type === "Person") || cited[0];
  if (!person) return;
  const linked = new Set((data.edges || []).filter((edge) => edge.source === person.id || edge.target === person.id).map((edge) => otherEnd(edge, person.id)));
  const target = (data.entities || []).find((entity) => entity.type === "Company" && !linked.has(entity.id)) || (data.entities || []).find((entity) => entity.id !== person.id);
  if (target) ctx.fabricate(person, target, [ctx.run.answer[0]?.steps?.[0] || 1], 1);
}

export const INTENTS = { summary, watchlist, phones, link, set: setIntent };

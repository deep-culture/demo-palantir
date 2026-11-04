/*
 * foundry-demo/js/retention.js: the retention clock (F12, PHASE3_CONTRACT §4).
 *
 * Classic script; attaches window.BuildRetention. Pure functions: app.js renders the results.
 *
 *   BuildRetention.DAY                         milliseconds in a day
 *   BuildRetention.parseDate(value)            ms since epoch, or null ("2026-04-01", ISO timestamps)
 *   BuildRetention.isoDay(ms)                  "YYYY-MM-DD"
 *   BuildRetention.dateFieldOf(ds)             the dataset's own date column, or null
 *   BuildRetention.range(asOfMs)               {min, max}: asOf − 3 years … asOf + 1 year (ms)
 *   BuildRetention.compute(ctx, clockMs)       Map(datasetId -> report), see below
 *
 * ctx = {datasets, entities, edges, lineage, parentsOf(ds) -> [ids], leadRows(ds) -> rows|null}
 *
 * report = {
 *   id, dateField, retentionDays, applicable, reason,          // reason when retention cannot be applied
 *   rowStatus: Map(sampleIndex -> "expired" | "carries" | "future"),
 *   own: {expired, future, known, sampleSize, rowCount},       // the dataset's own dated rows (sample)
 *   upstream: {count, partial, unit, bySource: {rawId: n}, total, ids: Set, ancestorsOnly?} | null
 *             // derived datasets only; unit "rows" | "objects" | "links" | "leads"
 * }
 *
 * A row is past retention when clock − date > retentionDays. Raw datasets are judged on their own
 * date column. Derived datasets are judged through lineage: a derived row "still carries data past
 * retention upstream" when one of the raw rows it was made from is past that raw dataset's
 * retention. The seed ships about 20 sample rows per dataset, so a count built from row lineage is
 * a lower bound ("at least"), and the report says so (partial: true).
 */
(function () {
  "use strict";

  const DAY = 86400000;
  // Preferred date columns, in order; then any date-typed field that is not a date of birth.
  const PREFERRED = ["registered_on", "timestamp", "txn_ts", "departure_ts", "incorporation_date", "observed_at", "date", "ts"];
  const DATE_TYPES = /^(date|datetime|timestamp)$/i;
  // Dates of birth and snapshot dates (asOf) are not the date a record was collected.
  const NOT_EVENT = /(^|_)(dob|birth|born)($|_)|dob$|^as_?of$/i;
  const EDGE_DATE_PROPS = ["firstSeen", "asOf", "lastTxnTs", "departureTs", "timestamp", "date"];

  function parseDate(value) {
    if (value == null || value === "") return null;
    const text = String(value);
    if (!/^\d{4}-\d{2}-\d{2}/.test(text)) return null;
    const ms = Date.parse(/T/.test(text) ? text : text.slice(0, 10) + "T00:00:00Z");
    return Number.isFinite(ms) ? ms : null;
  }

  function isoDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function dateFieldOf(ds) {
    if (!ds) return null;
    const schema = Array.isArray(ds.schema) ? ds.schema : [];
    const names = schema.map(f => f && f.field).filter(Boolean);
    const declared = ds.retentionDateField || ds.dateField;
    if (typeof declared === "string" && names.includes(declared)) return declared;
    const preferred = PREFERRED.find(n => names.includes(n));
    if (preferred) return preferred;
    const typed = schema.find(f => f && f.field && DATE_TYPES.test(String(f.type || "")) && !NOT_EVENT.test(f.field));
    return typed ? typed.field : null;
  }

  function range(asOfMs) {
    const min = new Date(asOfMs); min.setUTCFullYear(min.getUTCFullYear() - 3);
    const max = new Date(asOfMs); max.setUTCFullYear(max.getUTCFullYear() + 1);
    return { min: min.getTime(), max: max.getTime() };
  }

  function stem(id) {
    return String(id || "").replace(/\.(csv|jsonl|json)$/i, "").replace(/^(raw|norm|resolved)_/, "");
  }

  function compute(ctx, clockMs) {
    const datasets = Array.isArray(ctx.datasets) ? ctx.datasets : [];
    const byId = new Map(datasets.map(d => [d.id, d]));
    const parentsOf = typeof ctx.parentsOf === "function" ? ctx.parentsOf : () => [];
    const lineage = ctx.lineage || {};
    const reports = new Map();

    const hasRetention = ds => ds && typeof ds.retentionDays === "number" && Number.isFinite(ds.retentionDays);
    const expired = (dateMs, ds) => dateMs != null && clockMs - dateMs > ds.retentionDays * DAY;

    // The raw dataset a derived copy comes from (single-parent chains only).
    const rootMemo = new Map();
    function rawRootOf(id, guard) {
      if (rootMemo.has(id)) return rootMemo.get(id);
      const ds = byId.get(id);
      let out = null;
      if (ds && !ds.producedBy) out = ds;
      else if (ds) {
        guard = guard || new Set();
        if (!guard.has(id)) {
          guard.add(id);
          const parents = parentsOf(ds);
          if (parents.length === 1) out = rawRootOf(parents[0], guard);
        }
      }
      rootMemo.set(id, out);
      return out;
    }

    // Known row dates of every raw dataset, from its own sample and from the samples of its copies.
    const known = new Map(); // rawId -> Map(row -> ms)
    datasets.forEach(ds => {
      const field = dateFieldOf(ds);
      if (!field) return;
      const raw = rawRootOf(ds.id);
      if (!raw || dateFieldOf(raw) !== field) return;
      const map = known.get(raw.id) || new Map();
      (ds.sampleRows || []).forEach((row, i) => {
        const ms = parseDate(row && row[field]);
        const key = row && row._source_row != null ? row._source_row : i;
        if (ms != null && !map.has(key)) map.set(key, ms);
      });
      known.set(raw.id, map);
    });

    /** Is lineage ref {dataset, row} a raw row past retention? -> raw dataset, or null. */
    function refExpired(ref) {
      if (!ref || ref.row == null) return null;
      const raw = rawRootOf(ref.dataset);
      if (!raw || !hasRetention(raw)) return null;
      const map = known.get(raw.id);
      const ms = map ? map.get(ref.row) : undefined;
      return ms != null && expired(ms, raw) ? raw : null;
    }

    const rawDated = datasets.filter(d => !d.producedBy && dateFieldOf(d) && hasRetention(d));
    function rawForMarking(markings) {
      const list = Array.isArray(markings) ? markings : [];
      return rawDated.find(r => (r.markings || []).some(m => list.includes(m))) || null;
    }
    function rawForSource(source, marking) {
      const s = stem(source);
      const head = s.split("_")[0];
      return rawDated.find(r => stem(r.id) === s)
        || rawDated.find(r => stem(r.id).split("_")[0] === head)
        || rawForMarking(marking ? [marking] : []);
    }

    // Per-object verdicts, computed once.
    const entityVerdict = new Map(); // id -> Set(rawId)
    function entitySources(id) {
      if (entityVerdict.has(id)) return entityVerdict.get(id);
      const rec = lineage[id] || {};
      const out = new Set();
      (rec.sourceRows || []).forEach(ref => { const raw = refExpired(ref); if (raw) out.add(raw.id); });
      Object.values(rec.fieldProvenance || {}).forEach(refs => (refs || []).forEach(ref => { const raw = refExpired(ref); if (raw) out.add(raw.id); }));
      entityVerdict.set(id, out);
      return out;
    }
    function edgeSources(edge) {
      const props = edge.properties || {};
      const key = EDGE_DATE_PROPS.find(k => parseDate(props[k]) != null);
      if (!key) return new Set();
      const raw = rawForMarking(edge.markings);
      return raw && expired(parseDate(props[key]), raw) ? new Set([raw.id]) : new Set();
    }
    function leadSources(lead) {
      const out = new Set();
      const asOf = parseDate(lead.asOf);
      let list = lead.components;
      if (typeof list === "string") { try { list = JSON.parse(list); } catch (_) { list = []; } }
      (Array.isArray(list) ? list : []).forEach(c => {
        const raw = rawForSource(c.source, c.marking);
        const age = typeof c.ageDays === "number" ? c.ageDays : parseFloat(c.ageDays);
        const dated = parseDate(c.date);
        if (!raw || (dated == null && (asOf == null || !Number.isFinite(age)))) return;
        if (expired(dated != null ? dated : asOf - age * DAY, raw)) out.add(raw.id);
      });
      return out;
    }

    function tally(items, sourcesOf) {
      const bySource = {};
      const ids = new Set();
      items.forEach(item => {
        const src = sourcesOf(item);
        if (!src.size) return;
        ids.add(item.id);
        src.forEach(r => { bySource[r] = (bySource[r] || 0) + 1; });
      });
      return { ids, bySource };
    }

    datasets.forEach(ds => {
      const field = dateFieldOf(ds);
      const report = {
        id: ds.id,
        dateField: field,
        retentionDays: hasRetention(ds) ? ds.retentionDays : null,
        applicable: Boolean(field && hasRetention(ds)),
        reason: "",
        rowStatus: new Map(),
        own: { expired: 0, future: 0, known: 0, sampleSize: (ds.sampleRows || []).length, rowCount: ds.rowCount || 0 },
        upstream: null,
      };
      // Only a raw dataset is judged on its own dates; a derived one is judged through lineage.
      if (!ds.producedBy) {
        if (!hasRetention(ds)) report.reason = "no retention period declared";
        else if (!field) report.reason = "no date column; retention cannot be applied";
      }

      // Own rows (raw datasets and dated copies).
      if (report.applicable) {
        (ds.sampleRows || []).forEach((row, i) => {
          const ms = parseDate(row && row[field]);
          if (ms == null) return;
          report.own.known += 1;
          if (ms > clockMs) { report.own.future += 1; report.rowStatus.set(i, "future"); }
          else if (expired(ms, ds)) { report.own.expired += 1; report.rowStatus.set(i, "expired"); }
        });
      }

      if (ds.producedBy) {
        const rows = ds.sampleRows || [];
        const leadRows = typeof ctx.leadRows === "function" ? ctx.leadRows(ds) : null;
        let result = null;
        let unit = "rows";
        let partial = true;
        let total = 0;
        const raw = rawRootOf(ds.id);
        if (Array.isArray(leadRows)) {
          result = tally(leadRows.filter(r => r && r.id), leadSources);
          unit = "leads"; partial = leadRows.length < (ds.rowCount || leadRows.length); total = ds.rowCount || leadRows.length;
        } else if (raw && raw.id !== ds.id && field && dateFieldOf(raw) === field) {
          // A copy of one raw dataset: its rows are the raw rows, one for one.
          const map = known.get(raw.id) || new Map();
          const bySource = {};
          const ids = new Set();
          map.forEach((ms, row) => { if (hasRetention(raw) && expired(ms, raw)) { ids.add(row); bySource[raw.id] = (bySource[raw.id] || 0) + 1; } });
          result = { ids, bySource };
          partial = map.size < (raw.rowCount || map.size); total = raw.rowCount || map.size;
          rows.forEach((row, i) => { const key = row && row._source_row != null ? row._source_row : i; if (ids.has(key) && !report.rowStatus.has(i)) report.rowStatus.set(i, "carries"); });
        } else if (/edge/i.test(ds.id)) {
          const edges = Array.isArray(ctx.edges) ? ctx.edges : [];
          result = tally(edges, edgeSources); unit = "links"; partial = true; total = edges.length;
        } else {
          const entities = Array.isArray(ctx.entities) ? ctx.entities : [];
          const own = entities.filter(e => (lineage[e.id] || {}).producedBy === ds.id);
          const pool = own.length ? own : (/entit|ontology/i.test(ds.id) ? entities : []);
          if (pool.length) { result = tally(pool, e => entitySources(e.id)); unit = "objects"; total = pool.length; }
        }
        if (result) {
          if (unit !== "rows") rows.forEach((row, i) => { if (row && result.ids.has(row.id)) report.rowStatus.set(i, "carries"); });
          report.upstream = { count: result.ids.size, partial, unit, bySource: result.bySource, total, ids: result.ids };
        } else {
          // No row lineage for this dataset: report what its raw ancestors hold.
          report.upstream = { count: 0, partial: true, unit: "rows", bySource: {}, total: 0, ids: new Set(), ancestorsOnly: true };
        }
      }
      reports.set(ds.id, report);
    });

    // Lineage-free fallback: sum of the raw ancestors' expired rows.
    reports.forEach(report => {
      if (!report.upstream || !report.upstream.ancestorsOnly) return;
      const ds = byId.get(report.id);
      const seen = new Set();
      const stack = parentsOf(ds).slice();
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const p = byId.get(id);
        if (!p) continue;
        if (!p.producedBy) {
          const r = reports.get(id);
          if (r && r.own.expired) { report.upstream.bySource[id] = r.own.expired; report.upstream.count += r.own.expired; }
        } else parentsOf(p).forEach(x => stack.push(x));
      }
    });
    return reports;
  }

  window.BuildRetention = { DAY, parseDate, isoDay, dateFieldOf, range, compute };
})();

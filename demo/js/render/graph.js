// demo/js/render/graph.js — Graph Explorer tab: schema and instance graphs.
import { escapeHtml, truncate } from "../util.js";
import { MAX_GRAPH_NODES, data, roleView, ui } from "../state.js";
import { effectiveSearch, telecomEdgeAllowed, visiblePropertyValues } from "../governance.js";
import { degree, entityCount, entityTypeById, relationshipById } from "../derive.js";
import { renderPhoneHold } from "./banners.js";
import { honestyChip } from "./common.js";

export function renderGraphTool() {
  const graph = ui.graphMode === "schema" ? buildSchemaGraph() : buildInstanceGraph();
  const counts = [
    graph.truncatedCount ? `${graph.nodes.length} of ${graph.totalNodes} visible nodes` : `${graph.nodes.length} visible nodes`,
    `${graph.edges.length} visible edges`,
    ui.graphMode === "schema" ? "Schema layout" : "Instance layout",
  ];
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Graph explorer${honestyChip("inv.graph")}</h2>
            <p class="microcopy">Switch between the ontology schema and the seeded instance graph.</p>
          </div>
        </div>
        <div class="graph-shell">
          <div class="graph-controls">
            <div class="field">
              <label>Graph mode</label>
              <select data-scope="graph" data-field="mode">
                <option value="instance" ${ui.graphMode === "instance" ? "selected" : ""}>Instance graph</option>
                <option value="schema" ${ui.graphMode === "schema" ? "selected" : ""}>Schema graph</option>
              </select>
            </div>
            <div class="field">
              <label>Type filter</label>
              <select data-scope="graph" data-field="typeFilter" ${ui.graphMode === "schema" ? "disabled" : ""}>
                <option value="all" ${ui.graphTypeFilter === "all" ? "selected" : ""}>All types</option>
                ${(data.ontology?.entityTypes || [])
                .map(
                  (entityType) => `
                      <option value="${escapeHtml(entityType.id)}" ${ui.graphTypeFilter === entityType.id ? "selected" : ""}>
                        ${escapeHtml(entityType.name)}
                      </option>
                    `
                )
                .join("")}
              </select>
            </div>
            <div class="field">
              <label>Search</label>
              <input value="${escapeHtml(ui.graphSearch)}" placeholder="Filter labels or properties" data-scope="graph" data-field="search">
            </div>
          </div>
          ${renderPhoneHold("graph", ui.graphSearch)}
          <div class="graph-summary">
            ${counts.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
            ${roleView.withheldEntities.length ? `<span class="chip chip-withheld">${escapeHtml(`${roleView.withheldEntities.length} objects withheld from your role`)}</span>` : ""}
          </div>
          <div class="graph-canvas">
            ${graph.svg}
          </div>
        </div>
      </div>
    `;
}

export function buildSchemaGraph() {
  const nodes = (data.ontology?.entityTypes || []).map((entityType, index) => ({
    ...entityType,
    x: 80 + (index % 3) * 300,
    y: 80 + Math.floor(index / 3) * 180,
    width: 190,
    height: 56,
  }));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = (data.ontology?.relationshipTypes || [])
    .map((relationship) => {
      const sourceNode = nodeMap.get(relationship.sourceType);
      const targetNode = nodeMap.get(relationship.targetType);
      return sourceNode && targetNode ? { ...relationship, sourceNode, targetNode } : null;
    })
    .filter(Boolean);

  const svg = `
      <svg viewBox="0 0 980 720">
        ${edges
        .map((edge) => {
          const x1 = edge.sourceNode.x + edge.sourceNode.width / 2;
          const y1 = edge.sourceNode.y + edge.sourceNode.height / 2;
          const x2 = edge.targetNode.x + edge.targetNode.width / 2;
          const y2 = edge.targetNode.y + edge.targetNode.height / 2;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          return `
              <line class="graph-edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${escapeHtml(edge.color)}"></line>
              <text class="graph-edge-label" x="${mx}" y="${my - 6}">${escapeHtml(edge.label)}</text>
            `;
        })
        .join("")}
        ${nodes
        .map(
          (node) => `
              <g class="graph-node ${ui.selectedGraphNodeId === node.id ? "selected" : ""}" data-action="select-graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${node.x}, ${node.y})">
                <rect rx="18" ry="18" width="${node.width}" height="${node.height}" fill="${escapeHtml(node.color)}"></rect>
                <text x="16" y="26">${escapeHtml(node.name)}</text>
                <text x="16" y="44">${escapeHtml(`${entityCount(node.id)} instances`)}</text>
              </g>
            `
        )
        .join("")}
      </svg>
    `;

  return { nodes, edges, svg, totalNodes: nodes.length };
}

export function buildEntityGraph(nodes, edges, focusEntityIds, selectedNodeId) {
  const typeOrder = (data.ontology?.entityTypes || []).map((entityType) => entityType.id);
  const visibleTypeIds = typeOrder.filter((typeId) => nodes.some((node) => node.type === typeId));
  const positions = new Map();
  let maxRows = 0;

  visibleTypeIds.forEach((typeId, columnIndex) => {
    const typedNodes = nodes.filter((node) => node.type === typeId).sort((left, right) => left.label.localeCompare(right.label));
    maxRows = Math.max(maxRows, typedNodes.length);
    typedNodes.forEach((node, rowIndex) => {
      const entityType = entityTypeById(typeId);
      positions.set(node.id, {
        x: 80 + columnIndex * 220,
        y: 90 + rowIndex * 72,
        width: 150,
        height: 34,
        color: entityType?.color || "#475569",
      });
    });
  });

  const width = Math.max(980, visibleTypeIds.length * 240 + 120);
  const height = Math.max(560, maxRows * 72 + 120);
  const focusSet = new Set(focusEntityIds);
  const svg = `
      <svg viewBox="0 0 ${width} ${height}">
        ${visibleTypeIds
        .map((typeId, columnIndex) => `<text x="${95 + columnIndex * 220}" y="42" class="graph-edge-label">${escapeHtml(entityTypeById(typeId)?.name || typeId)}</text>`)
        .join("")}
        ${edges
        .map((edge) => {
          const source = positions.get(edge.source);
          const target = positions.get(edge.target);
          const relationship = relationshipById(edge.type);
          if (!source || !target || !relationship) {
            return "";
          }
          return `
              <line
                class="graph-edge"
                x1="${source.x + source.width}"
                y1="${source.y + source.height / 2}"
                x2="${target.x}"
                y2="${target.y + target.height / 2}"
                stroke="${escapeHtml(relationship.color)}"
              ></line>
            `;
        })
        .join("")}
        ${nodes
        .map((node) => {
          const position = positions.get(node.id);
          if (!position) {
            return "";
          }
          const isSelected = selectedNodeId === node.id || focusSet.has(node.id);
          return `
              <g class="graph-node ${isSelected ? "selected" : ""}" data-action="select-graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${position.x}, ${position.y})">
                <rect rx="14" ry="14" width="${position.width}" height="${position.height}" fill="${escapeHtml(position.color)}"></rect>
                <text x="12" y="22">${escapeHtml(truncate(node.label, 20))}</text>
              </g>
            `;
        })
        .join("")}
      </svg>
    `;

  return { svg };
}

export function buildInstanceGraph() {
  const search = effectiveSearch(ui.graphSearch).trim().toLowerCase();
  let nodes = (data.entities || []).filter((entity) => ui.graphTypeFilter === "all" || entity.type === ui.graphTypeFilter);
  if (search) {
    nodes = nodes.filter((entity) => {
      const props = visiblePropertyValues(entity).join(" ").toLowerCase();
      return entity.label.toLowerCase().includes(search) || props.includes(search);
    });
  }

  nodes = nodes.sort((left, right) => {
    const degreeDelta = degree(right.id) - degree(left.id);
    if (degreeDelta) {
      return degreeDelta;
    }
    return left.label.localeCompare(right.label);
  });

  const totalNodes = nodes.length;
  const truncatedNodes = nodes.slice(0, MAX_GRAPH_NODES);
  if (totalNodes > MAX_GRAPH_NODES && ui.selectedGraphNodeId && !truncatedNodes.some((node) => node.id === ui.selectedGraphNodeId)) {
    const selectedNode = nodes.find((node) => node.id === ui.selectedGraphNodeId);
    if (selectedNode) {
      truncatedNodes[truncatedNodes.length - 1] = selectedNode;
    }
  }
  const visibleIds = new Set(truncatedNodes.map((node) => node.id));
  const edges = (data.edges || []).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target) && telecomEdgeAllowed(edge));
  const graph = buildEntityGraph(truncatedNodes, edges, [], ui.selectedGraphNodeId);

  return {
    nodes: truncatedNodes,
    edges,
    svg: graph.svg,
    totalNodes,
    truncatedCount: totalNodes > truncatedNodes.length,
  };
}

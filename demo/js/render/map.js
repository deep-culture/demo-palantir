// demo/js/render/map.js — Map tab.
import { escapeHtml } from "../util.js";
import { data, ui } from "../state.js";
import { entityById } from "../derive.js";
import { buildMapData } from "../map.js";
import { renderPhoneHold } from "./banners.js";
import { honestyChip } from "./common.js";
import { renderTelecomExpansion } from "./inspector.js";

export function renderMapTool() {
  const mapData = buildMapData();
  const selectedPlace = mapData.selectedPlace;
  return `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Geospatial map${honestyChip("inv.map")}</h2>
            <p class="microcopy">Inspect airports, addresses, and observed places with routes layered on top of the ontology graph.</p>
          </div>
        </div>
        <div class="map-layout">
          <div class="property-card" style="padding:0.75rem">
            <div class="map-controls-row">
              <div class="field">
                <label>Scope</label>
                <select data-scope="map" data-field="scope">
                  <option value="dataset" ${ui.mapScope === "dataset" ? "selected" : ""}>Whole dataset</option>
                  <option value="scenario" ${ui.mapScope === "scenario" ? "selected" : ""}>Selected scenario</option>
                  <option value="copilot" ${ui.mapScope === "copilot" ? "selected" : ""}>Agent answer</option>
                </select>
              </div>
              <div class="field">
                <label>Markers</label>
                <select data-scope="map" data-field="placeFilter">
                  <option value="all" ${ui.mapPlaceFilter === "all" ? "selected" : ""}>Airports + locations</option>
                  <option value="Airport" ${ui.mapPlaceFilter === "Airport" ? "selected" : ""}>Airports only</option>
                  <option value="Location" ${ui.mapPlaceFilter === "Location" ? "selected" : ""}>Locations only</option>
                </select>
              </div>
              <div class="field">
                <label>Search</label>
                <input value="${escapeHtml(ui.mapSearch)}" placeholder="Search airport or address" data-scope="map" data-field="search">
              </div>
              <div class="chip-row" style="align-items:flex-end;padding-bottom:0.2rem">
                <span class="chip">${escapeHtml(mapData.summary.scope)}</span>
                <span class="chip">${escapeHtml(`${mapData.places.length} places`)}</span>
                <span class="chip">${escapeHtml(`${mapData.routes.length} routes`)}</span>
              </div>
            </div>
            ${renderPhoneHold("map", ui.mapSearch)}
            <div class="map-canvas">
              ${mapData.places.length
              ? `<div id="leaflet-map" class="leaflet-map" style="height:560px" aria-label="Geospatial investigation map"></div>`
              : `<div class="empty-state" style="padding:2rem">No mapped places are available for this scope yet.</div>`
            }
            </div>
          </div>
          <div class="map-bottom-row">
            <div class="property-card">
              <h3>Top hotspots</h3>
              <div class="place-list">
                ${mapData.places
                .slice(0, 8)
                .map(
                  (place) => `
                      <button class="place-card map-list-button ${selectedPlace?.id === place.id ? "active" : ""}" data-action="select-map-node" data-id="${escapeHtml(place.id)}">
                        <div class="list-item-title">
                          <span><span class="entity-dot" style="background:${escapeHtml(place.color)}"></span>${escapeHtml(place.label)}</span>
                          <span class="muted">${escapeHtml(place.locationType)}</span>
                        </div>
                        ${place.context ? `<div class="microcopy">${escapeHtml(place.context)}</div>` : ""}
                        <div class="microcopy">${escapeHtml(place.detail)}</div>
                      </button>
                    `
                )
                .join("")}
              </div>
            </div>
            <div class="property-card">
              <h3>${escapeHtml(selectedPlace?.label || "Selected place")}</h3>
              ${selectedPlace
              ? `
                  <div class="chip-row">
                    <span class="chip">${escapeHtml(selectedPlace.type)}</span>
                    ${selectedPlace.context ? `<span class="chip">${escapeHtml(selectedPlace.context)}</span>` : ""}
                    <span class="chip">${escapeHtml(`${selectedPlace.relatedCount} linked edges`)}</span>
                  </div>
                  <div class="stack-list">
                    <div class="fact-item">${escapeHtml(selectedPlace.detail)}</div>
                    ${selectedPlace.type === "Location"
                    ? `
                        ${selectedPlace.people.length ? `<div class="fact-item">People: ${escapeHtml(selectedPlace.people.slice(0, 5).map((p) => p.label).join(", "))}</div>` : ""}
                        ${renderTelecomExpansion(entityById(selectedPlace.id))}
                        ${selectedPlace.companies.length ? `<div class="fact-item">Companies: ${escapeHtml(selectedPlace.companies.slice(0, 5).map((c) => c.label).join(", "))}</div>` : ""}
                      `
                    : `
                        ${selectedPlace.travelers.length ? `<div class="fact-item">Travelers: ${escapeHtml(selectedPlace.travelers.slice(0, 6).map((p) => p.label).join(", "))}</div>` : ""}
                        <div class="fact-item">Flights: ${escapeHtml(String(selectedPlace.departures.length + selectedPlace.arrivals.length))}</div>
                      `
                  }
                  </div>
                  <div class="inline-actions">
                    <button class="ghost-button" data-action="map-jump-graph" data-id="${escapeHtml(selectedPlace.id)}">Open in graph</button>
                  </div>
                `
              : `<div class="empty-state">Select a place marker to inspect it.</div>`
            }
            </div>
            <div class="property-card">
              <h3>Route activity</h3>
              <div class="table-shell">
                <table>
                  <thead><tr><th>Route</th><th>Flights</th><th>Pax</th></tr></thead>
                  <tbody>
                    ${mapData.routes
                    .slice(0, 10)
                    .map(
                      (route) => `
                          <tr>
                            <td>${escapeHtml(`${route.fromLabel} → ${route.toLabel}`)}</td>
                            <td>${escapeHtml(String(route.flightCount))}</td>
                            <td>${escapeHtml(String(route.passengerCount))}</td>
                          </tr>
                        `
                    )
                    .join("") || `<tr><td colspan="3" class="muted">No routes in this scope.</td></tr>`}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
}

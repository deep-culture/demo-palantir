// demo/js/map.js — Map data (places, routes) and rendering: Leaflet when window.L is present, SVG fallback otherwise.
import { escapeHtml, normalizeText, truncate } from "./util.js";
import { analysisState, copilotState, data, ui } from "./state.js";
import { effectiveSearch, telecomGateActive } from "./governance.js";
import {
  entityProperty,
  entityTypeById,
  locationPeople,
  numericProperty,
  relatedSources,
  relatedTargets,
} from "./derive.js";
import { render } from "./render/index.js";

// The live Leaflet map (if any); destroyed and rebuilt by every render of the Map tab.
export let mapRuntime = { map: null, markerLayer: null, routeLayer: null };

export function graphForMapScope() {
  if (ui.mapScope === "scenario") {
    return analysisState.investigations.find((scenario) => scenario.id === ui.selectedScenarioId)?.graph || { nodes: [], edges: [] };
  }
  if (ui.mapScope === "copilot") {
    return copilotState.result?.graph || { nodes: [], edges: [] };
  }
  return { nodes: data.entities || [], edges: data.edges || [] };
}

export function buildMapPlaces(graph) {
  return graph.nodes
    .filter((node) => (node.type === "Location" || node.type === "Airport") && numericProperty(node, "lat") !== null && numericProperty(node, "lon") !== null)
    .map((node) => {
      const connectedEdges = graph.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
      const registeredCompanies = node.type === "Location" ? relatedSources(node.id, "REGISTERED_AT") : [];
      const observedDevices = node.type === "Location" ? relatedSources(node.id, "OBSERVED_AT") : [];
      const observedPeople =
        node.type === "Location" && (!telecomGateActive() || ui.telecomExpanded.has(node.id)) ? locationPeople(node.id) : [];
      const departures = node.type === "Airport" ? relatedSources(node.id, "DEPARTED_FROM") : [];
      const arrivals = node.type === "Airport" ? relatedSources(node.id, "ARRIVED_AT") : [];
      const routeFlights = [...departures, ...arrivals];
      const travelers = new Map();
      routeFlights.forEach((flight) => {
        relatedSources(flight.id, "BOOKED_ON").forEach((person) => travelers.set(person.id, person));
      });
      const locationType = node.type === "Location" ? entityProperty(node, "locationType") || "Location" : "Airport";
      const city = entityProperty(node, "city") || "";
      const country = entityProperty(node, "country") || "";
      const context = [locationType, city, country].filter(Boolean).join(" • ");
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        lat: numericProperty(node, "lat"),
        lon: numericProperty(node, "lon"),
        color: entityTypeById(node.type)?.color || "#94a3b8",
        locationType,
        city,
        country,
        context,
        relatedCount: connectedEdges.length,
        detail:
          node.type === "Location"
            ? `${registeredCompanies.length} companies, ${observedPeople.length} people, ${observedDevices.length} devices`
            : `${departures.length} departures, ${arrivals.length} arrivals, ${travelers.size} travelers`,
        companies: registeredCompanies,
        devices: observedDevices,
        people: observedPeople,
        departures,
        arrivals,
        travelers: [...travelers.values()],
      };
    });
}

export function buildMapRoutes(graph) {
  const routes = new Map();
  graph.nodes
    .filter((node) => node.type === "Flight")
    .forEach((flight) => {
      const departure = relatedTargets(flight.id, "DEPARTED_FROM")[0];
      const arrival = relatedTargets(flight.id, "ARRIVED_AT")[0];
      if (!departure || !arrival) {
        return;
      }
      const fromLat = numericProperty(departure, "lat");
      const fromLon = numericProperty(departure, "lon");
      const toLat = numericProperty(arrival, "lat");
      const toLon = numericProperty(arrival, "lon");
      if ([fromLat, fromLon, toLat, toLon].some((value) => value === null)) {
        return;
      }
      const key = `${departure.id}:${arrival.id}`;
      if (!routes.has(key)) {
        routes.set(key, {
          id: key,
          fromId: departure.id,
          fromLabel: departure.label,
          fromLat,
          fromLon,
          toId: arrival.id,
          toLabel: arrival.label,
          toLat,
          toLon,
          flightCount: 0,
          passengerCount: 0,
          flightNumbers: new Set(),
        });
      }
      const route = routes.get(key);
      route.flightCount += 1;
      route.flightNumbers.add(entityProperty(flight, "flightNumber"));
      route.passengerCount += relatedSources(flight.id, "BOOKED_ON").length;
    });

  return [...routes.values()]
    .map((route) => ({
      ...route,
      flightNumbers: [...route.flightNumbers].filter(Boolean).slice(0, 3),
    }))
    .sort((left, right) => right.flightCount - left.flightCount || right.passengerCount - left.passengerCount)
    .slice(0, 60);
}

export function projectMapPoint(lat, lon, width, height) {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

export function buildMapData() {
  const graph = graphForMapScope();
  const search = normalizeText(effectiveSearch(ui.mapSearch));
  let places = buildMapPlaces(graph);
  if (ui.mapPlaceFilter !== "all") {
    places = places.filter((place) => place.type === ui.mapPlaceFilter);
  }
  if (search) {
    places = places.filter((place) => normalizeText(`${place.label} ${place.context} ${place.detail}`).includes(search));
  }

  places = places.sort((left, right) => right.relatedCount - left.relatedCount).slice(0, 40);
  const visiblePlaceIds = new Set(places.map((place) => place.id));
  const routes = buildMapRoutes(graph).filter((route) => visiblePlaceIds.has(route.fromId) || visiblePlaceIds.has(route.toId));
  const selectedPlace = places.find((place) => place.id === ui.selectedMapNodeId) || places[0] || null;
  return {
    graph,
    places,
    routes,
    selectedPlace,
    summary: {
      scope:
        ui.mapScope === "scenario"
          ? "Scenario scope"
          : ui.mapScope === "copilot"
            ? "Agent scope"
            : "Dataset scope",
    },
  };
}

export function renderMapSvg(mapData) {
  const width = 960;
  const height = 480;
  const gridLines = [];
  for (let lon = -120; lon <= 120; lon += 60) {
    const point = projectMapPoint(0, lon, width, height);
    gridLines.push(`<line class="map-grid-line" x1="${point.x}" y1="0" x2="${point.x}" y2="${height}"></line>`);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const point = projectMapPoint(lat, 0, width, height);
    gridLines.push(`<line class="map-grid-line" x1="0" y1="${point.y}" x2="${width}" y2="${point.y}"></line>`);
  }

  const routes = mapData.routes
    .map((route) => {
      const from = projectMapPoint(route.fromLat, route.fromLon, width, height);
      const to = projectMapPoint(route.toLat, route.toLon, width, height);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const curveOffset = Math.min(80, Math.max(24, Math.abs(dx) * 0.14 + Math.abs(dy) * 0.08));
      const cx = (from.x + to.x) / 2;
      const cy = Math.min(from.y, to.y) - curveOffset;
      return `
          <path class="map-route" d="M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}"></path>
        `;
    })
    .join("");

  const markers = mapData.places
    .map((place) => {
      const point = projectMapPoint(place.lat, place.lon, width, height);
      const radius = Math.max(6, Math.min(14, 5 + place.relatedCount * 0.4));
      const selected = mapData.selectedPlace?.id === place.id ? "selected" : "";
      return `
          <g class="map-marker ${selected}" data-action="select-map-node" data-id="${escapeHtml(place.id)}" transform="translate(${point.x}, ${point.y})">
            <circle r="${radius}" fill="${escapeHtml(place.color)}"></circle>
            <text x="${radius + 6}" y="4">${escapeHtml(truncate(place.label, 24))}</text>
          </g>
        `;
    })
    .join("");

  return `
      <svg viewBox="0 0 ${width} ${height}">
        <rect x="0" y="0" width="${width}" height="${height}" class="map-surface"></rect>
        ${gridLines.join("")}
        ${routes}
        ${markers}
      </svg>
    `;
}

export function destroyLeafletMap() {
  if (mapRuntime.map) {
    mapRuntime.map.remove();
  }
  mapRuntime = { map: null, markerLayer: null, routeLayer: null };
}

export function mapPopupHtml(place) {
  return `
      <div class="map-popup">
        <strong>${escapeHtml(place.label)}</strong>
        ${place.context ? `<div>${escapeHtml(place.context)}</div>` : ""}
        <div>${escapeHtml(place.detail)}</div>
      </div>
    `;
}

export function syncMapViewport() {
  if (!mapRuntime.map) {
    return;
  }
  const center = mapRuntime.map.getCenter();
  ui.mapViewCenter = [center.lat, center.lng];
  ui.mapViewZoom = mapRuntime.map.getZoom();
  ui.mapViewDirty = true;
}

export function initializeLeafletMap(mapData) {
  const container = document.getElementById("leaflet-map");
  if (!container || !mapData.places.length) {
    return;
  }
  if (!window.L) {
    container.innerHTML = renderMapSvg(mapData);
    return;
  }

  destroyLeafletMap();
  mapRuntime.map = window.L.map(container, {
    zoomControl: true,
    scrollWheelZoom: true,
    attributionControl: false,
  });

  window.L.control.attribution({ prefix: false }).addTo(mapRuntime.map);

  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapRuntime.map);

  mapRuntime.routeLayer = window.L.layerGroup().addTo(mapRuntime.map);
  mapRuntime.markerLayer = window.L.layerGroup().addTo(mapRuntime.map);

  mapData.routes.forEach((route) => {
    window.L.polyline(
      [
        [route.fromLat, route.fromLon],
        [route.toLat, route.toLon],
      ],
      {
        color: "#832161",
        weight: Math.min(7, 2 + route.flightCount * 0.6),
        opacity: 0.55,
        dashArray: "8 6",
      }
    )
      .bindTooltip(`${route.fromLabel} -> ${route.toLabel} · ${route.flightCount} flights · ${route.passengerCount} passengers`)
      .addTo(mapRuntime.routeLayer);
  });

  let selectedMarker = null;
  mapData.places.forEach((place) => {
    const radius = Math.max(6, Math.min(14, 5 + place.relatedCount * 0.4));
    const marker = window.L.circleMarker([place.lat, place.lon], {
      radius,
      color: place.color,
      fillColor: place.color,
      fillOpacity: mapData.selectedPlace?.id === place.id ? 0.95 : 0.72,
      weight: mapData.selectedPlace?.id === place.id ? 3 : 1.5,
    })
      .bindPopup(mapPopupHtml(place))
      .on("click", () => {
        ui.selectedMapNodeId = place.id;
        setTimeout(() => render(), 0);
      })
      .addTo(mapRuntime.markerLayer);
    if (mapData.selectedPlace?.id === place.id) {
      selectedMarker = marker;
    }
  });

  if (!ui.mapViewDirty && mapData.places.length > 1) {
    const bounds = window.L.latLngBounds(mapData.places.map((place) => [place.lat, place.lon]));
    mapRuntime.map.fitBounds(bounds.pad(0.18));
    ui.mapViewCenter = [mapRuntime.map.getCenter().lat, mapRuntime.map.getCenter().lng];
    ui.mapViewZoom = mapRuntime.map.getZoom();
  } else if (mapData.places.length === 1 && !ui.mapViewDirty) {
    mapRuntime.map.setView([mapData.places[0].lat, mapData.places[0].lon], 7);
    ui.mapViewCenter = [mapData.places[0].lat, mapData.places[0].lon];
    ui.mapViewZoom = 7;
  } else {
    mapRuntime.map.setView(ui.mapViewCenter, ui.mapViewZoom);
  }

  mapRuntime.map.on("moveend", syncMapViewport);
  if (selectedMarker) {
    selectedMarker.openPopup();
  }
}

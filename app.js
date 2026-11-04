/**
 * ZüriPort — Aplicación SPA de Transporte Público en Zúrich y alrededores
 * Stack: Vanilla JS (ES6+), Leaflet.js + OpenStreetMap, Swiss Public Transport API
 */

// Usamos HTTPS para evitar bloqueos por Mixed Content en GitHub Pages / Vercel / Netlify / Cloudflare Pages.
// El endpoint oficial http://transport.opendata.ch/v1/locations responde exactamente igual bajo HTTPS.
const API_BASE_URL = 'https://transport.opendata.ch/v1';

// Coordenadas por defecto exigidas: Estación Central de Zúrich (Zürich HB: 47.3781, 8.5401)
const ZURICH_HB = {
  lat: 47.3781,
  lng: 8.5401,
  zoom: 15,
};

// Estado de la aplicación
const state = {
  stations: [],
  activeFilter: 'all',
  selectedStationId: null,
  map: null,
  markersLayer: null,
  userMarker: null,
  userAccuracyCircle: null,
  watchId: null,
  hasInitialGpsFix: false,
  followUser: true,
  lastPosition: null,
  abortController: null,
  dragDebounceTimer: null,
  markerMap: new Map(),
};

// Referencias al DOM
const dom = {
  searchForm: document.getElementById('search-form'),
  searchInput: document.getElementById('search-input'),
  locateMeBtn: document.getElementById('locate-me-btn'),
  filterButtons: document.querySelectorAll('.chip[data-filter]'),
  statusPill: document.getElementById('status-pill'),
  stationboardPanel: document.getElementById('stationboard-panel'),
  stationboardTitle: document.getElementById('stationboard-title'),
  stationboardList: document.getElementById('stationboard-list'),
  closeStationboardBtn: document.getElementById('close-stationboard-btn'),
};

/**
 * Inicializa el mapa Leaflet ocupando el 100% de la pantalla con tiles de OpenStreetMap
 */
function initMap() {
  state.map = L.map('map', {
    center: [ZURICH_HB.lat, ZURICH_HB.lng],
    zoom: ZURICH_HB.zoom,
    zoomControl: false,
  });

  // Control de zoom ubicado arriba a la derecha para no colisionar con el botón flotante inferior
  L.control.zoom({ position: 'topright' }).addTo(state.map);

  // Capa de tiles gratuitos de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | <a href="https://transport.opendata.ch">transport.opendata.ch</a>',
  }).addTo(state.map);

  // Leyenda visual en la esquina inferior izquierda (visible en desktop/tablet)
  const legendControl = L.control({ position: 'bottomleft' });
  legendControl.onAdd = () => {
    const div = L.DomUtil.create('div', 'map-legend');
    div.innerHTML = `
      <div class="map-legend-title">Transporte Zúrich</div>
      <div class="map-legend-item"><span class="legend-swatch train"></span> 🚆 Tren (SBB / S-Bahn)</div>
      <div class="map-legend-item"><span class="legend-swatch tram"></span> 🚋 Tranvía (VBZ)</div>
      <div class="map-legend-item"><span class="legend-swatch bus"></span> 🚌 Autobús (ZVV)</div>
      <div class="map-legend-item"><span class="legend-swatch user"></span> 📍 Tu ubicación GPS</div>
    `;
    return div;
  };
  legendControl.addTo(state.map);

  // Grupo de capas para gestionar marcadores de estaciones eficientemente
  state.markersLayer = L.layerGroup().addTo(state.map);

  // Al arrastrar el mapa (con el dedo o el ratón):
  // 1. Se desactiva el seguimiento automático para permitir exploración libre
  // 2. Al soltar (dragend), se consulta transport.opendata.ch con las nuevas coordenadas (?x={lat}&y={lon})
  state.map.on('dragstart', () => {
    setFollowMode(false);
  });

  state.map.on('dragend', () => {
    clearTimeout(state.dragDebounceTimer);
    state.dragDebounceTimer = setTimeout(() => {
      const center = state.map.getCenter();
      fetchStationsByCoords(center.lat, center.lng, false);
    }, 250);
  });
}

/**
 * Actualiza el estado visual del botón flotante "Centrar en mi ubicación"
 */
function setFollowMode(enabled) {
  state.followUser = enabled;
  dom.locateMeBtn.classList.toggle('is-following', enabled);
}

/**
 * Crea o mueve el marcador distintivo del usuario (punto azul parpadeante + círculo de precisión)
 */
function updateUserLocationMarker(lat, lng, accuracy = 25) {
  const latLng = [lat, lng];

  if (!state.userMarker) {
    const pulsingBlueDotIcon = L.divIcon({
      className: 'user-location-icon',
      html: `
        <div class="user-location-wrapper" title="Tu ubicación en tiempo real">
          <div class="user-location-pulse"></div>
          <div class="user-location-dot"></div>
        </div>
      `,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -13],
    });

    state.userAccuracyCircle = L.circle(latLng, {
      radius: accuracy,
      color: '#2563eb',
      weight: 1,
      fillColor: '#3b82f6',
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(state.map);

    state.userMarker = L.marker(latLng, {
      icon: pulsingBlueDotIcon,
      zIndexOffset: 1000,
    })
      .addTo(state.map)
      .bindPopup(
        `<strong>📍 Tu ubicación exacta</strong><br><small>Precisión: ±${Math.round(
          accuracy
        )} m</small>`
      );
  } else {
    state.userMarker.setLatLng(latLng);
    state.userMarker.setPopupContent(
      `<strong>📍 Tu ubicación exacta</strong><br><small>Coords: ${lat.toFixed(
        5
      )}, ${lng.toFixed(5)} (±${Math.round(accuracy)} m)</small>`
    );
    state.userAccuracyCircle.setLatLng(latLng);
    state.userAccuracyCircle.setRadius(accuracy);
  }
}

/**
 * Fallback cuando el usuario deniega permisos o el GPS falla:
 * Establece el centro por defecto en Zürich HB (47.3781, 8.5401)
 */
function fallbackToZurichHB(reasonMessage) {
  setFollowMode(false);
  updateStatus(`${reasonMessage} Centro: Zürich HB`, true);
  state.map.setView([ZURICH_HB.lat, ZURICH_HB.lng], ZURICH_HB.zoom);
  fetchStationsByCoords(ZURICH_HB.lat, ZURICH_HB.lng, false);
}

/**
 * Inicia el seguimiento en tiempo real con navigator.geolocation.watchPosition
 * Se ejecuta al abrir la web y al pulsar el botón flotante "Centrar en mi ubicación"
 */
function startGeolocationTracking(forceCenter = true) {
  if (!('geolocation' in navigator)) {
    fallbackToZurichHB('Sin soporte GPS.');
    return;
  }

  setFollowMode(true);

  // Si ya disponemos de coordenadas GPS recientes y el usuario toca "Centrar en mi ubicación"
  if (forceCenter && state.lastPosition) {
    const { latitude, longitude } = state.lastPosition;
    state.map.flyTo([latitude, longitude], Math.max(state.map.getZoom(), 15), {
      duration: 0.65,
    });
    fetchStationsByCoords(latitude, longitude, false);
  } else {
    updateStatus('Solicitando GPS...');
  }

  // Si ya existe una suscripción watchPosition activa, no la duplicamos
  if (state.watchId !== null) {
    return;
  }

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      state.lastPosition = { latitude, longitude, accuracy };

      // 1. Dibuja o desplaza el marcador azul parpadeante a la ubicación en tiempo real
      updateUserLocationMarker(latitude, longitude, accuracy);

      // 2. Centra automáticamente el mapa si es la lectura inicial o si el modo seguimiento está activo
      if (!state.hasInitialGpsFix || state.followUser) {
        state.map.flyTo(
          [latitude, longitude],
          state.hasInitialGpsFix ? state.map.getZoom() : 15,
          { duration: 0.7 }
        );
      }

      state.hasInitialGpsFix = true;

      // 3. Consulta las estaciones más cercanas pasando ?x={lat}&y={lon}
      fetchStationsByCoords(latitude, longitude, false);
    },
    (error) => {
      console.warn('Error en watchPosition:', error.code, error.message);

      if (state.watchId !== null) {
        navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
      }

      if (!state.hasInitialGpsFix || forceCenter) {
        const errorReasons = {
          1: 'Permiso GPS denegado.',
          2: 'GPS no disponible.',
          3: 'Tiempo GPS agotado.',
        };
        fallbackToZurichHB(errorReasons[error.code] || 'Fallo GPS.');
      } else {
        updateStatus('Señal GPS perdida temporalmente', true);
      }
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    }
  );
}

/**
 * Normaliza el tipo de transporte de una estación según el icono o nombre devuelto por la API
 * @param {Object} station Objeto estación de transport.opendata.ch
 * @returns {'train' | 'tram' | 'bus' | 'other'}
 */
function resolveTransportType(station) {
  const icon = (station.icon || '').toLowerCase().trim();
  if (icon === 'train' || icon === 'tram' || icon === 'bus') {
    return icon;
  }

  const name = (station.name || '').toLowerCase();
  if (
    name.includes('(see)') ||
    name.includes('polybahn') ||
    name.includes('seilbahn') ||
    name.includes('rigiblick') ||
    name.includes('dolderbahn') ||
    icon === 'ship' ||
    icon === 'cableway'
  ) {
    return 'other';
  }
  if (name.includes('hb') || name.includes('bahnhof') || !name.includes(',')) {
    return 'train';
  }
  return 'tram';
}

/**
 * Devuelve metadatos visuales (emoji y etiqueta) para cada tipo de estación
 */
function getTypeBadge(type) {
  const catalog = {
    train: { emoji: '🚆', label: 'Tren (SBB / S-Bahn)' },
    tram: { emoji: '🚋', label: 'Tranvía (VBZ)' },
    bus: { emoji: '🚌', label: 'Autobús (ZVV)' },
    other: { emoji: '⛴️', label: 'Barco / Funicular' },
  };
  return catalog[type] || catalog.other;
}

/**
 * Actualiza la píldora de estado en el HUD superior
 */
function updateStatus(message, isError = false) {
  dom.statusPill.textContent = message;
  dom.statusPill.title = message;
  dom.statusPill.classList.toggle('error', isError);
}

/**
 * Consulta estaciones más cercanas pasando las coordenadas actuales (?x={lat}&y={lon})
 * Endpoint: http://transport.opendata.ch/v1/locations?x={lat}&y={lon}
 */
async function fetchStationsByCoords(lat, lon, fitBounds = false) {
  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  updateStatus(`Cargando paradas (${lat.toFixed(3)}, ${lon.toFixed(3)})...`);

  try {
    const url = new URL(`${API_BASE_URL}/locations`);
    url.searchParams.set('x', lat);
    url.searchParams.set('y', lon);
    url.searchParams.set('type', 'station');

    const response = await fetch(url, { signal: state.abortController.signal });
    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();
    processStationsResponse(data.stations || [], fitBounds);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Error al consultar estaciones por coordenadas:', error);
    updateStatus('Error de conexión con la API', true);
  }
}

/**
 * Consulta estaciones por nombre o consulta de texto
 * Endpoint: http://transport.opendata.ch/v1/locations?query={query}&type=station
 */
async function fetchStationsByQuery(query) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return;

  if (state.abortController) {
    state.abortController.abort();
  }
  state.abortController = new AbortController();

  setFollowMode(false);
  updateStatus(`Buscando "${cleanQuery}"...`);

  try {
    const url = new URL(`${API_BASE_URL}/locations`);
    url.searchParams.set('query', cleanQuery);
    url.searchParams.set('type', 'station');

    const response = await fetch(url, { signal: state.abortController.signal });
    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();
    processStationsResponse(data.stations || [], true);
  } catch (error) {
    if (error.name === 'AbortError') return;
    console.error('Error al buscar estaciones por texto:', error);
    updateStatus('Error al buscar estaciones', true);
  }
}

/**
 * Filtra y almacena las estaciones válidas con coordenadas WGS84
 */
function processStationsResponse(rawStations, shouldFitBounds = false) {
  state.stations = rawStations
    .filter(
      (st) =>
        Boolean(st.id) &&
        st.coordinate &&
        typeof st.coordinate.x === 'number' &&
        typeof st.coordinate.y === 'number'
    )
    .map((st) => ({
      id: st.id,
      name: st.name,
      lat: st.coordinate.x,
      lng: st.coordinate.y,
      distance: typeof st.distance === 'number' ? Math.round(st.distance) : null,
      transportType: resolveTransportType(st),
    }));

  renderStations(shouldFitBounds);
}

/**
 * Renderiza los marcadores personalizados en el mapa según el filtro activo
 */
function renderStations(shouldFitBounds = false) {
  state.markersLayer.clearLayers();
  state.markerMap.clear();

  const filtered = state.stations.filter((st) =>
    state.activeFilter === 'all' ? true : st.transportType === state.activeFilter
  );

  if (filtered.length === 0) {
    updateStatus('0 estaciones en esta zona');
    return;
  }

  updateStatus(`${filtered.length} estaciones cercanas`);

  const bounds = [];

  filtered.forEach((station) => {
    const badge = getTypeBadge(station.transportType);
    bounds.push([station.lat, station.lng]);

    // 1. Icono personalizado de Leaflet (L.divIcon) diferenciando Tren, Tranvía y Bus
    const iconHtml = `
      <div class="custom-marker-pin ${station.transportType}" title="${escapeHtml(station.name)}">
        <span class="marker-inner">${badge.emoji}</span>
      </div>
    `;

    const customIcon = L.divIcon({
      className: 'custom-div-icon',
      html: iconHtml,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -36],
    });

    const marker = L.marker([station.lat, station.lng], { icon: customIcon });

    // 2. Popup de Leaflet al hacer clic en el marcador mostrando el nombre de la estación
    const popupContainer = document.createElement('div');
    popupContainer.className = 'popup-content';
    popupContainer.innerHTML = `
      <h3>${escapeHtml(station.name)}</h3>
      <p><strong>Medio:</strong> ${badge.emoji} ${badge.label}</p>
      ${station.distance !== null ? `<p><strong>Distancia:</strong> ${station.distance} m</p>` : ''}
      <button type="button" class="popup-btn">Ver próximas salidas en vivo</button>
    `;

    popupContainer.querySelector('.popup-btn').addEventListener('click', () => {
      fetchStationboard(station);
    });

    marker.bindPopup(popupContainer);

    marker.on('click', () => {
      state.selectedStationId = station.id;
    });

    marker.addTo(state.markersLayer);
    state.markerMap.set(station.id, marker);

    if (state.selectedStationId === station.id) {
      marker.openPopup();
    }
  });

  if (shouldFitBounds && bounds.length > 0) {
    state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16 });
  }
}

/**
 * Obtiene las próximas salidas en tiempo real de una estación
 * Endpoint complementario: https://transport.opendata.ch/v1/stationboard?id={id}&limit=6
 */
async function fetchStationboard(station) {
  dom.stationboardPanel.classList.remove('hidden');
  dom.stationboardTitle.textContent = station.name;
  dom.stationboardList.innerHTML = '<li class="departure-row">Cargando salidas...</li>';

  try {
    const url = new URL(`${API_BASE_URL}/stationboard`);
    url.searchParams.set('id', station.id);
    url.searchParams.set('limit', '6');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();
    const departures = data.stationboard || [];

    if (departures.length === 0) {
      dom.stationboardList.innerHTML =
        '<li class="departure-row">Sin salidas programadas ahora.</li>';
      return;
    }

    dom.stationboardList.innerHTML = departures
      .map((item) => {
        const line = `${item.category || ''}${item.number || ''}`.trim() || 'Línea';
        const destination = item.to || 'Destino desconocido';
        const departureIso = item.stop?.departure;
        const delay = item.stop?.delay;

        let timeFormatted = '--:--';
        if (departureIso) {
          const date = new Date(departureIso);
          timeFormatted = date.toLocaleTimeString('es-CH', {
            hour: '2-digit',
            minute: '2-digit',
          });
        }

        const delayHtml =
          delay && delay > 0 ? `<span class="departure-delay">+${delay}'</span>` : '';

        return `
          <li class="departure-row">
            <span class="departure-line">${escapeHtml(line)}</span>
            <span class="departure-dest" title="${escapeHtml(destination)}">→ ${escapeHtml(destination)}</span>
            <span class="departure-time">${timeFormatted}${delayHtml}</span>
          </li>
        `;
      })
      .join('');
  } catch (error) {
    console.error('Error cargando salidas:', error);
    dom.stationboardList.innerHTML =
      '<li class="departure-row">No se pudieron obtener las salidas.</li>';
  }
}

/**
 * Escapa caracteres HTML para prevenir XSS
 */
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * Configura los eventos de interfaz de usuario
 */
function bindEvents() {
  // Búsqueda por formulario
  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    fetchStationsByQuery(dom.searchInput.value);
    dom.searchInput.blur(); // Oculta el teclado virtual en móviles tras buscar
  });

  // Botón flotante "Centrar en mi ubicación"
  dom.locateMeBtn.addEventListener('click', () => {
    startGeolocationTracking(true);
  });

  // Filtros táctiles por tipo de transporte
  dom.filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      dom.filterButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
      renderStations(false);
    });
  });

  // Cerrar cajón de salidas
  dom.closeStationboardBtn.addEventListener('click', () => {
    dom.stationboardPanel.classList.add('hidden');
  });
}

// Punto de entrada de la SPA
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  // Solicita permisos de ubicación al abrir la web e inicia seguimiento con watchPosition.
  // Si se deniega o falla, hace fallback automático a Zürich HB (47.3781, 8.5401).
  startGeolocationTracking(true);
});

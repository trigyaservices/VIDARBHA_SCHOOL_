/**
 * VIDARBHA SCHOOL SEARCH & FIELD ROUTE PLANNER
 * Complete Interactive Application Engine
 * - Robust School Details Modal
 * - Dedicated Live Route Map (Up to 20 Stops)
 * - Side-by-Side Proximity Map
 * - Exact Distance Range Filtering (0-5km, 5-10km, 10-20km, etc.)
 * - 1-Click Multi-Stop Google Maps Navigation
 */

(function () {
  'use strict';

  // Application State
  const state = {
    schools: [],
    filteredSchools: [],
    selectedSchool: null,
    userLocation: null, // { lat, lon, accuracy, name }
    activeDistrict: 'ALL',
    nearDistanceRange: { min: 0, max: 20 },
    routeMaxStops: 20,
    currentGeneratedRoutes: [],
    activeRouteIndex: 0,
    searchQuery: '',
    sortColumn: 'name',
    sortAsc: true,
    filters: {
      district: 'ALL',
      block: 'ALL',
      management: 'ALL',
      category: 'ALL',
      type: 'ALL',
      locale: 'ALL',
      distanceRange: 'ALL'
    },
    pagination: {
      page: 1,
      pageSize: 20,
      total: 0
    }
  };

  // District Centroids
  const DISTRICT_CENTROIDS = {
    'NAGPUR': { lat: 21.1458, lon: 79.0882, count: 4458 },
    'AMRAVATI': { lat: 20.9374, lon: 77.7796, count: 2867 },
    'AKOLA': { lat: 20.7002, lon: 77.0082, count: 1450 },
    'YAVATMAL': { lat: 20.3888, lon: 78.1204, count: 2550 },
    'BHANDARA': { lat: 21.1714, lon: 79.6558, count: 1290 },
    'CHANDRAPUR': { lat: 19.9615, lon: 79.2961, count: 2451 },
    'GADCHIROLI': { lat: 20.1809, lon: 80.0034, count: 1968 },
    'GONDIYA': { lat: 21.4554, lon: 80.1961, count: 1634 },
    'WARDHA': { lat: 20.7453, lon: 78.6022, count: 1451 },
    'WASHIM': { lat: 20.1118, lon: 77.1332, count: 1150 }
  };

  // Safe DOM Helper: never throws if element is missing
  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = (text !== undefined && text !== null && String(text).trim() !== '') ? String(text) : '—';
    }
  }

  function deg2rad(deg) {
    return deg * (Math.PI / 180);
  }

  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    const R = 6371; // Earth radius in KM
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 10) / 10;
  }

  function getGoogleMapsUrl(lat, lon, schoolName) {
    if (state.userLocation && state.userLocation.lat && state.userLocation.lon) {
      return `https://www.google.com/maps/dir/${state.userLocation.lat},${state.userLocation.lon}/${lat},${lon}`;
    }
    const q = schoolName ? encodeURIComponent(`${schoolName} (${lat},${lon})`) : `${lat},${lon}`;
    return `https://www.google.com/maps/search/${q}`;
  }

  function unpackRawSchools() {
    if (!window.VIDARBHA_FIELDS || !window.VIDARBHA_RAW) {
      console.error('Vidarbha schools database not loaded.');
      return;
    }
    const fields = window.VIDARBHA_FIELDS;
    const raw = window.VIDARBHA_RAW;

    state.schools = raw.map(row => {
      const obj = {};
      fields.forEach((f, idx) => {
        obj[f] = row[idx];
      });
      obj.distKm = null;
      return obj;
    });

    console.log(`Unpacked ${state.schools.length} schools across Vidarbha.`);
  }

  function initApp() {
    unpackRawSchools();

    // Default reference location: Nagpur Center
    state.userLocation = {
      lat: 21.1458,
      lon: 79.0882,
      accuracy: 25,
      name: 'Nagpur Central Hub'
    };

    updateAllDistances();
    applyFilters();
    renderDistrictPills();
    renderNearMeSection();
    renderRoutesSection();
    setupEventListeners();
    initLeafletGoogleMaps();
    if (window.google && window.google.maps) {
      window.initGoogleMapsApp();
    }

    // Try detecting live user geolocation in background
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const lat = pos.coords.latitude;
          const lon = pos.coords.longitude;
          const accuracy = Math.round(pos.coords.accuracy || 15);
          setUserLocation(lat, lon, accuracy, 'Current GPS Location', true);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    }
  }

  function populateBlockDropdown() {
    const blockSelect = document.getElementById('filter-block');
    if (!blockSelect) return;

    const currentDist = state.filters.district;
    const blocksSet = new Set();

    state.schools.forEach(s => {
      if (currentDist === 'ALL' || s.dist === currentDist) {
        if (s.block) blocksSet.add(s.block);
      }
    });

    const sortedBlocks = Array.from(blocksSet).sort();
    blockSelect.innerHTML = '<option value="ALL">All Blocks</option>' +
      sortedBlocks.map(b => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');
    
    state.filters.block = 'ALL';
  }

  function setUserLocation(lat, lon, accuracy, name, isGps = false) {
    state.userLocation = {
      lat: roundCoordinate(lat),
      lon: roundCoordinate(lon),
      accuracy: accuracy || 20,
      name: name || 'Custom Point'
    };

    const statusText = document.getElementById('loc-status-text');
    if (statusText) {
      statusText.innerHTML = `
        <strong>${isGps ? '📍 GPS Location Active' : '📍 Preset Active'}: ${escapeHtml(state.userLocation.name)}</strong>
        <span>Coordinates: ${state.userLocation.lat}, ${state.userLocation.lon} (${accuracy ? '±' + accuracy + 'm' : ''})</span>
      `;
    }

    const originLabel = document.getElementById('route-origin-label');
    if (originLabel) {
      originLabel.textContent = `${state.userLocation.name}`;
    }

    const indicator = document.querySelector('.loc-indicator-dot');
    if (indicator) {
      indicator.style.backgroundColor = isGps ? '#137333' : '#1a73e8';
    }

    const startLbl = document.getElementById('auto-route-start-label');
    if (startLbl) {
      startLbl.textContent = `${state.userLocation.name} (${state.userLocation.lat}, ${state.userLocation.lon})`;
    }

    updateAllDistances();
    applyFilters();
    renderNearMeSection();
    renderRoutesSection();

    if (state.routeMode === 'autoroute' && (!state.preplan.stops || state.preplan.stops.length === 0)) {
      if (window.generateAutoRouteFromCurrentLocation) {
        window.generateAutoRouteFromCurrentLocation(false);
      }
    }
  }

  function roundCoordinate(val) {
    return Math.round(parseFloat(val) * 100000) / 100000;
  }

  function updateAllDistances() {
    if (!state.userLocation) return;
    const uLat = state.userLocation.lat;
    const uLon = state.userLocation.lon;

    state.schools.forEach(s => {
      s.distKm = calculateDistanceKm(uLat, uLon, s.lat, s.lon);
    });
  }

  // ==========================================================================
  // ==========================================================================
  // ==========================================================================
  // HYBRID GOOGLE MAPS ENGINE (Official Google JS API + Google Direct Tiles)
  // ==========================================================================
  let mapMode = 'google_tiles'; // 'google_js' or 'google_tiles'
  let leafletSideMap = null;
  let leafletRouteMap = null;
  let leafletSideMarkers = [];
  let leafletRouteMarkers = [];
  let leafletRoutePolyline = null;
  let leafletUserMarker = null;

  let googleSideMap = null;
  let googleRouteMap = null;
  let googleSideMarkers = [];
  let googleRouteMarkers = [];
  let googleRoutePolyline = null;
  let googleUserMarker = null;
  let googleInfoWindow = null;

  // Called if Google Maps API key has restrictions or billing issue
  window.switchToGoogleDirectTiles = function(reason) {
    console.warn("Switching to Google Direct Tiles:", reason);
    mapMode = 'google_tiles';

    const statusMsg = document.getElementById('gmaps-status-msg');
    if (statusMsg) {
      statusMsg.innerHTML = '<span style="color:#16a34a;font-weight:700;">🟢 Google Maps (Direct Hybrid & Satellite Active - 100% Working)</span>';
    }

    initLeafletGoogleMaps();
    if (state.schools && state.schools.length > 0) {
      renderNearMeSection();
    }
    if (state.currentGeneratedRoutes && state.currentGeneratedRoutes.length > 0) {
      window.drawRouteOnMap(state.activeRouteIndex || 0);
    }
  };

  // Called if official Google Maps JS API successfully loads
  window.initMap = function() {
    window.initGoogleMapsApp();
  };

  window.initGoogleMapsApp = function() {
    if (mapMode === 'google_tiles' && leafletSideMap) return;

    try {
      if (!window.google || !window.google.maps) {
        window.switchToGoogleDirectTiles("Google Maps JS API unavailable.");
        return;
      }

      console.log("Official Google Maps JS API active!");
      mapMode = 'google_js';
      googleInfoWindow = new google.maps.InfoWindow();

      initGoogleJsMaps();
      if (state.schools && state.schools.length > 0) {
        renderNearMeSection();
      }
      if (state.currentGeneratedRoutes && state.currentGeneratedRoutes.length > 0) {
        window.drawRouteOnMap(state.activeRouteIndex || 0);
      }
    } catch (e) {
      console.error("Error in initGoogleMapsApp:", e);
      window.switchToGoogleDirectTiles("Error initializing JS API: " + e.message);
    }
  };

  // --------------------------------------------------------------------------
  // LEAFLET GOOGLE TILES ENGINE (Real Google Maps Tiles, ZERO Restrictions)
  // --------------------------------------------------------------------------
  function createGoogleTileLayers() {
    return {
      roadmap: L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '© Google Maps'
      }),
      hybrid: L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '© Google Maps Satellite'
      }),
      terrain: L.tileLayer('https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        subdomains: ['0', '1', '2', '3'],
        maxZoom: 20,
        attribution: '© Google Maps Terrain'
      }),
      esriSat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '© Esri Satellite'
      }),
      carto: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '© CartoDB'
      })
    };
  }

  function initLeafletGoogleMaps() {
    if (typeof L === 'undefined') return;

    // 1. Side Map
    const sideContainer = document.getElementById('side-interactive-map');
    if (sideContainer) {
      if (leafletSideMap) {
        try { leafletSideMap.remove(); } catch (e) {}
        leafletSideMap = null;
      }
      sideContainer.innerHTML = '';

      const initialLat = state.userLocation ? state.userLocation.lat : 21.1458;
      const initialLon = state.userLocation ? state.userLocation.lon : 79.0882;

      try {
        leafletSideMap = L.map('side-interactive-map', {
          center: [initialLat, initialLon],
          zoom: 12,
          zoomControl: true
        });

        const layers = createGoogleTileLayers();
        layers.roadmap.addTo(leafletSideMap);

        L.control.layers({
          "🗺️ Google Roadmap": layers.roadmap,
          "🛰️ Google Satellite (Hybrid)": layers.hybrid,
          "🏔️ Google Terrain": layers.terrain,
          "📡 Esri Satellite": layers.esriSat,
          "🌐 Carto Clear": layers.carto
        }, null, { position: 'topright' }).addTo(leafletSideMap);

        L.control.scale({ imperial: false }).addTo(leafletSideMap);
      } catch (e) {
        console.error("Leaflet side map error:", e);
      }
    }

    // 2. Route Map
    const routeContainer = document.getElementById('route-interactive-map');
    if (routeContainer) {
      if (leafletRouteMap) {
        try { leafletRouteMap.remove(); } catch (e) {}
        leafletRouteMap = null;
      }
      routeContainer.innerHTML = '';

      const initialLat = state.userLocation ? state.userLocation.lat : 21.1458;
      const initialLon = state.userLocation ? state.userLocation.lon : 79.0882;

      try {
        leafletRouteMap = L.map('route-interactive-map', {
          center: [initialLat, initialLon],
          zoom: 11,
          zoomControl: true
        });

        const rLayers = createGoogleTileLayers();
        rLayers.roadmap.addTo(leafletRouteMap);

        L.control.layers({
          "🗺️ Google Roadmap": rLayers.roadmap,
          "🛰️ Google Satellite (Hybrid)": rLayers.hybrid,
          "🏔️ Google Terrain": rLayers.terrain,
          "📡 Esri Satellite": rLayers.esriSat,
          "🌐 Carto Clear": rLayers.carto
        }, null, { position: 'topright' }).addTo(leafletRouteMap);

        L.control.scale({ imperial: false }).addTo(leafletRouteMap);
      } catch (e) {
        console.error("Leaflet route map error:", e);
      }
    }
  }

  // --------------------------------------------------------------------------
  // GOOGLE JS API ENGINE (Used when key has no restrictions)
  // --------------------------------------------------------------------------
  function initGoogleJsMaps() {
    const sideContainer = document.getElementById('side-interactive-map');
    if (sideContainer && window.google && window.google.maps) {
      sideContainer.innerHTML = '';
      const initialLat = state.userLocation ? state.userLocation.lat : 21.1458;
      const initialLon = state.userLocation ? state.userLocation.lon : 79.0882;

      googleSideMap = new google.maps.Map(sideContainer, {
        center: { lat: initialLat, lng: initialLon },
        zoom: 12,
        mapTypeId: 'roadmap',
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        zoomControl: true
      });
    }

    const routeContainer = document.getElementById('route-interactive-map');
    if (routeContainer && window.google && window.google.maps) {
      routeContainer.innerHTML = '';
      const initialLat = state.userLocation ? state.userLocation.lat : 21.1458;
      const initialLon = state.userLocation ? state.userLocation.lon : 79.0882;

      googleRouteMap = new google.maps.Map(routeContainer, {
        center: { lat: initialLat, lng: initialLon },
        zoom: 11,
        mapTypeId: 'roadmap',
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        zoomControl: true
      });
    }
  }

  // --------------------------------------------------------------------------
  // MAP DISPATCHERS: updateSideMap, drawRouteOnMap, focusSchoolOnSideMap
  // --------------------------------------------------------------------------
  function updateSideMap(schools) {
    if (mapMode === 'google_js' && googleSideMap) {
      updateSideMapGoogleJs(schools);
    } else {
      updateSideMapLeaflet(schools);
    }
  }

  function updateSideMapLeaflet(schools) {
    if (!leafletSideMap) {
      initLeafletGoogleMaps();
    }
    if (!leafletSideMap) return;

    leafletSideMap.invalidateSize();

    // Clear previous markers
    leafletSideMarkers.forEach(m => leafletSideMap.removeLayer(m));
    leafletSideMarkers = [];
    if (leafletUserMarker) {
      leafletSideMap.removeLayer(leafletUserMarker);
      leafletUserMarker = null;
    }

    const latLngs = [];

    // User location marker
    if (state.userLocation) {
      const uIcon = L.divIcon({
        className: 'user-loc-pin',
        html: '<div style="background:#1a73e8;color:#fff;font-size:12px;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:3px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.35);font-weight:bold;">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });
      leafletUserMarker = L.marker([state.userLocation.lat, state.userLocation.lon], { icon: uIcon })
        .addTo(leafletSideMap)
        .bindPopup(`<b>📍 Your Location</b><br>${escapeHtml(state.userLocation.name)}`);
      latLngs.push([state.userLocation.lat, state.userLocation.lon]);
    }

    // Plot EVERY SINGLE matching school in the selected range (No school left out!)
    const useRichDivPills = schools.length <= 150;

    schools.forEach((s, idx) => {
      if (!s.lat || !s.lon) return;
      latLngs.push([s.lat, s.lon]);

      const std = Number(s.students) || 0;
      const traffic = getSchoolTrafficColorInfo(std);

      const navUrl = `https://www.google.com/maps/dir/${state.userLocation ? state.userLocation.lat + ',' + state.userLocation.lon + '/' : ''}${s.lat},${s.lon}`;
      const popupHtml = `
        <div style="font-family:sans-serif;padding:6px;max-width:270px;line-height:1.4;">
          <div style="background:${traffic.badgeBg};color:${traffic.badgeText};padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;display:inline-block;margin-bottom:4px;">
            ${traffic.tierName.toUpperCase()}
          </div>
          <h4 style="margin:2px 0 4px 0;font-size:13px;color:#0f172a;font-weight:700;">${escapeHtml(s.name)}</h4>
          <p style="margin:0 0 6px 0;font-size:11px;color:#475569;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}</p>
          <div style="font-size:11px;margin-bottom:8px;color:#334155;background:#f8fafc;padding:6px;border-radius:6px;border:1px solid #e2e8f0;">
            👥 <b>${std.toLocaleString()} Students</b> • <b>${s.distKm !== null ? s.distKm + ' KM away' : '—'}</b><br>
            🏷️ UDISE: <b>${escapeHtml(s.udise)}</b> • ${escapeHtml(s.cat)}
          </div>
          <div style="display:flex;gap:6px;">
            <button onclick="window.routeToSchoolFromUserByUdise('${escapeHtml(s.udise)}')" style="background:#1a73e8;color:#fff;border:none;padding:6px 12px;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
              🚗 Draw Route
            </button>
            <a href="${navUrl}" target="_blank" style="background:#16a34a;color:#fff;padding:6px 10px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px;">
              🚀 G-Maps
            </a>
            <button onclick="window.openSchoolModalByUdise('${escapeHtml(s.udise)}')" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:6px 8px;border-radius:5px;font-size:11px;cursor:pointer;font-weight:600;">
              Details
            </button>
          </div>
        </div>
      `;

      let marker;
      if (useRichDivPills) {
        const pinIcon = L.divIcon({
          className: 'traffic-school-leaflet-pin',
          html: `
            <div class="traffic-school-pin" style="
              background: ${traffic.color};
              color: #ffffff;
              border: 2px solid #ffffff;
              box-shadow: 0 3px 8px rgba(0,0,0,0.35);
              border-radius: 12px;
              padding: 2px 7px;
              font-size: 10px;
              font-weight: 800;
              display: inline-flex;
              align-items: center;
              gap: 2px;
              white-space: nowrap;
              cursor: pointer;
              transform: translate(-50%, -50%);
            ">
              <span>👥 ${std.toLocaleString()}</span>
            </div>
          `,
          iconSize: [50, 22],
          iconAnchor: [25, 11]
        });

        marker = L.marker([s.lat, s.lon], { icon: pinIcon, zIndexOffset: traffic.zIndex })
          .addTo(leafletSideMap)
          .bindPopup(popupHtml);
      } else {
        // High-performance Circle Marker for fast, lag-free rendering of hundreds/thousands of schools
        marker = L.circleMarker([s.lat, s.lon], {
          radius: 6,
          fillColor: traffic.color,
          color: '#ffffff',
          weight: 1.5,
          opacity: 1,
          fillOpacity: 0.95
        })
          .addTo(leafletSideMap)
          .bindTooltip(`<b>${escapeHtml(s.name)}</b><br>👥 ${std} Students • ${s.distKm !== null ? s.distKm + ' KM' : ''}`, { direction: 'top', offset: [0, -6] })
          .bindPopup(popupHtml);
      }

      // TOUCH / CLICK ON PIN AUTOMATICALLY DRAWS ROUTE!
      marker.on('click', () => {
        window.routeToSchoolFromUser(s);
      });

      marker.schoolUdise = s.udise;
      leafletSideMarkers.push(marker);
    });

    if (latLngs.length > 0) {
      leafletSideMap.fitBounds(latLngs, { padding: [35, 35], maxZoom: 15 });
    }
  }

  function updateSideMapGoogleJs(schools) {
    if (!googleSideMap) return;

    googleSideMarkers.forEach(m => m.setMap(null));
    googleSideMarkers = [];
    if (googleUserMarker) {
      googleUserMarker.setMap(null);
      googleUserMarker = null;
    }

    const bounds = new google.maps.LatLngBounds();

    if (state.userLocation) {
      const uPos = { lat: state.userLocation.lat, lng: state.userLocation.lon };
      googleUserMarker = new google.maps.Marker({
        position: uPos,
        map: googleSideMap,
        title: 'Your Location: ' + state.userLocation.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#1a73e8',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        }
      });
      bounds.extend(uPos);
    }

    schools.forEach((s, idx) => {
      if (!s.lat || !s.lon) return;
      const pos = { lat: s.lat, lng: s.lon };
      const marker = new google.maps.Marker({
        position: pos,
        map: googleSideMap,
        title: s.name,
        label: {
          text: String(idx + 1),
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold'
        }
      });
      marker.schoolUdise = s.udise;

      marker.addListener('click', () => {
        const navUrl = `https://www.google.com/maps/dir/${state.userLocation ? state.userLocation.lat + ',' + state.userLocation.lon + '/' : ''}${s.lat},${s.lon}`;
        const content = `
          <div style="font-family:sans-serif;padding:8px;max-width:280px;line-height:1.4;">
            <div style="font-size:10px;font-weight:700;color:#1a73e8;text-transform:uppercase;">School #${idx + 1}</div>
            <h4 style="margin:2px 0 4px 0;font-size:14px;color:#0f172a;">${escapeHtml(s.name)}</h4>
            <p style="margin:0 0 6px 0;font-size:12px;color:#475569;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}</p>
            <div style="font-size:11px;margin-bottom:8px;color:#334155;">
              👥 <b>${(s.students||0).toLocaleString()}</b> Students • <b>${s.distKm} KM away</b><br>
              🏷️ UDISE: <b>${escapeHtml(s.udise)}</b> • ${escapeHtml(s.cat)}
            </div>
            <div style="display:flex;gap:6px;">
              <a href="${navUrl}" target="_blank" style="background:#1a73e8;color:#fff;padding:6px 12px;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600;">🚗 Navigate</a>
              <button onclick="window.openSchoolModalByUdise('${escapeHtml(s.udise)}')" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;padding:6px 10px;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600;">📋 Details</button>
            </div>
          </div>
        `;
        if (googleInfoWindow) {
          googleInfoWindow.setContent(content);
          googleInfoWindow.open(googleSideMap, marker);
        }
      });

      googleSideMarkers.push(marker);
      bounds.extend(pos);
    });

    if (schools.length > 0) {
      googleSideMap.fitBounds(bounds);
    }
  }

  window.focusSchoolOnSideMap = function(udise) {
    if (mapMode === 'google_js' && googleSideMap) {
      const gMarker = googleSideMarkers.find(m => m.schoolUdise === udise);
      if (gMarker) {
        googleSideMap.panTo(gMarker.getPosition());
        googleSideMap.setZoom(16);
        google.maps.event.trigger(gMarker, 'click');
        const el = document.getElementById('side-interactive-map');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }

    if (leafletSideMap) {
      const marker = leafletSideMarkers.find(m => m.schoolUdise === udise);
      if (marker) {
        leafletSideMap.setView(marker.getLatLng(), 16, { animate: true });
        marker.openPopup();
        const el = document.getElementById('side-interactive-map');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  window.resetSideMapView = function() {
    if (mapMode === 'google_js' && googleSideMap) {
      if (googleSideMarkers.length === 0) {
        const pos = state.userLocation ? { lat: state.userLocation.lat, lng: state.userLocation.lon } : { lat: 21.1458, lng: 79.0882 };
        googleSideMap.setCenter(pos);
        googleSideMap.setZoom(12);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      googleSideMarkers.forEach(m => bounds.extend(m.getPosition()));
      if (googleUserMarker) bounds.extend(googleUserMarker.getPosition());
      googleSideMap.fitBounds(bounds);
      return;
    }

    if (leafletSideMap) {
      if (leafletSideMarkers.length === 0) {
        const initialLat = state.userLocation ? state.userLocation.lat : 21.1458;
        const initialLon = state.userLocation ? state.userLocation.lon : 79.0882;
        leafletSideMap.setView([initialLat, initialLon], 12);
        return;
      }
      const group = L.featureGroup(leafletSideMarkers);
      if (leafletUserMarker) group.addLayer(leafletUserMarker);
      leafletSideMap.fitBounds(group.getBounds(), { padding: [30, 30] });
    }
  };

  window.drawRouteOnMap = function(routeIndex) {
    state.activeRouteIndex = routeIndex;
    const route = state.currentGeneratedRoutes ? state.currentGeneratedRoutes[routeIndex] : null;
    if (!route) return;

    document.querySelectorAll('.route-card').forEach((card, idx) => {
      if (idx === routeIndex) {
        card.classList.add('active-circuit');
      } else {
        card.classList.remove('active-circuit');
      }
    });

    const routeMapTitle = document.getElementById('route-map-title');
    if (routeMapTitle) {
      routeMapTitle.textContent = `${route.name} (${route.totalKm} KM)`;
    }

    if (mapMode === 'google_js' && googleRouteMap) {
      drawRouteGoogleJs(route);
    } else {
      drawRouteLeaflet(route);
    }
  };

  function drawRouteLeaflet(route) {
    if (!leafletRouteMap) {
      initLeafletGoogleMaps();
    }
    if (!leafletRouteMap) return;

    leafletRouteMap.invalidateSize();

    leafletRouteMarkers.forEach(m => leafletRouteMap.removeLayer(m));
    leafletRouteMarkers = [];
    if (leafletRoutePolyline) {
      leafletRouteMap.removeLayer(leafletRoutePolyline);
      leafletRoutePolyline = null;
    }

    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const latLngs = [[originLat, originLon]];

    const originIcon = L.divIcon({
      className: 'route-origin-pin',
      html: '<div style="background:#0f172a;color:#fff;font-size:10px;font-weight:800;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.4);">START</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    const startM = L.marker([originLat, originLon], { icon: originIcon })
      .addTo(leafletRouteMap)
      .bindPopup(`<b>📍 Circuit Departure Origin</b><br>${escapeHtml(route.originName)}`);
    leafletRouteMarkers.push(startM);

    route.stops.forEach(st => {
      const s = st.school;
      latLngs.push([s.lat, s.lon]);

      const std = Number(s.students) || 0;
      const starInfo = getSchoolStarInfo(std);

      const pinIcon = L.divIcon({
        className: 'route-stop-pin',
        html: `
          <div style="
            background: ${route.color || '#1a73e8'};
            color: #ffffff;
            border: 2px solid #ffffff;
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            border-radius: 16px;
            padding: 2px 7px;
            font-size: 11px;
            font-weight: 800;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            cursor: pointer;
            transform: translate(-50%, -50%);
          ">
            <span style="background:rgba(255,255,255,0.25);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;">${st.step}</span>
            ${starInfo.starStr ? `<span style="font-size:9px;">${starInfo.starStr}</span>` : ''}
            <span>👥 ${std.toLocaleString()}</span>
          </div>
        `,
        iconSize: [60, 24],
        iconAnchor: [30, 12]
      });

      const popupHtml = `
        <div style="font-family:sans-serif;padding:6px;max-width:260px;">
          <div style="color:${route.color || '#1a73e8'};font-size:11px;font-weight:700;">STOP #${st.step} OF ${route.stopsCount}</div>
          <h4 style="margin:2px 0 4px 0;font-size:13px;color:#0f172a;">${escapeHtml(s.name)}</h4>
          <div style="font-size:11px;color:#475569;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}</div>
          <div style="font-size:11px;margin-top:4px;">👥 <b>${(s.students||0).toLocaleString()}</b> Students • <b>+${st.legDistKm} KM</b> (Cumulative: <b>${st.cumDistKm} KM</b>)</div>
        </div>
      `;

      const m = L.marker([s.lat, s.lon], { icon: pinIcon })
        .addTo(leafletRouteMap)
        .bindPopup(popupHtml);
      leafletRouteMarkers.push(m);
    });

    leafletRoutePolyline = L.polyline(latLngs, {
      color: route.color || '#1a73e8',
      weight: 5,
      opacity: 0.85
    }).addTo(leafletRouteMap);

    leafletRouteMap.fitBounds(latLngs, { padding: [35, 35] });
  }

  function drawRouteGoogleJs(route) {
    if (!googleRouteMap) return;

    googleRouteMarkers.forEach(m => m.setMap(null));
    googleRouteMarkers = [];
    if (googleRoutePolyline) {
      googleRoutePolyline.setMap(null);
      googleRoutePolyline = null;
    }

    const bounds = new google.maps.LatLngBounds();
    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const startPos = { lat: originLat, lng: originLon };
    const pathCoords = [startPos];
    bounds.extend(startPos);

    const originMarker = new google.maps.Marker({
      position: startPos,
      map: googleRouteMap,
      title: 'Start Location: ' + route.originName,
      icon: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
    });
    routeMarkers.push(originMarker);

    route.stops.forEach(st => {
      const pos = { lat: st.school.lat, lng: st.school.lon };
      pathCoords.push(pos);
      bounds.extend(pos);

      const m = new google.maps.Marker({
        position: pos,
        map: googleRouteMap,
        title: `Stop #${st.step}: ${st.school.name}`,
        label: {
          text: String(st.step),
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold'
        }
      });

      m.addListener('click', () => {
        const content = `
          <div style="font-family:sans-serif;padding:6px;max-width:260px;">
            <div style="color:#1a73e8;font-size:11px;font-weight:700;">ROUTE STOP #${st.step}</div>
            <h4 style="margin:2px 0 4px 0;font-size:13px;color:#0f172a;">${escapeHtml(st.school.name)}</h4>
            <div style="font-size:11px;color:#475569;">📍 ${escapeHtml(st.school.village || st.school.block)}, ${escapeHtml(st.school.dist)}</div>
            <div style="font-size:11px;margin-top:4px;">👥 <b>${(st.school.students||0).toLocaleString()}</b> Students • <b>+${st.legDistKm} KM</b> (Cumulative: <b>${st.cumDistKm} KM</b>)</div>
          </div>
        `;
        if (googleInfoWindow) {
          googleInfoWindow.setContent(content);
          googleInfoWindow.open(googleRouteMap, m);
        }
      });

      googleRouteMarkers.push(m);
    });

    googleRoutePolyline = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: route.color || '#1a73e8',
      strokeOpacity: 0.85,
      strokeWeight: 5
    });
    googleRoutePolyline.setMap(googleRouteMap);
    googleRouteMap.fitBounds(bounds);
  }

  // ==========================================================================
  
  // ==========================================================================
  // INTELLIGENT 20-STOP FIELD VISIT CIRCUIT GENERATOR (TSP-Optimized)
  // ==========================================================================
  function optimizeNearestNeighborRoute(originLat, originLon, pool, maxStops = 20) {
    const unvisited = pool.filter(s => s.lat && s.lon);
    const orderedStops = [];
    let currLat = originLat;
    let currLon = originLon;

    while (orderedStops.length < maxStops && unvisited.length > 0) {
      let nearestIdx = -1;
      let minD = Infinity;
      for (let i = 0; i < unvisited.length; i++) {
        const d = calculateDistanceKm(currLat, currLon, unvisited[i].lat, unvisited[i].lon);
        if (d < minD) {
          minD = d;
          nearestIdx = i;
        }
      }
      if (nearestIdx !== -1) {
        const nextSchool = unvisited.splice(nearestIdx, 1)[0];
        orderedStops.push({
          school: nextSchool,
          legDistKm: Math.round(minD * 10) / 10
        });
        currLat = nextSchool.lat;
        currLon = nextSchool.lon;
      } else {
        break;
      }
    }
    return orderedStops;
  }

  // Initial Route Filter State
  state.routeOrigin = 'GPS'; // 'GPS' or District code (e.g. 'CHANDRAPUR')
  state.routeMaxStops = 20;
  state.routeFilters = {
    district: 'ALL',
    mgmt: 'ALL',
    cat: 'ALL',
    priority: 'ALL',
    distance: 'ALL'
  };

  window.onRouteChangeOrigin = function(val) {
    state.routeOrigin = val;
    renderRoutesSection();
    if (window.selectAndDrawRoute) {
      window.selectAndDrawRoute(state.activeRouteIndex || 0);
    }
  };

  window.onRouteChangeStops = function(val) {
    state.routeMaxStops = parseInt(val, 10) || 20;
    renderRoutesSection();
    if (window.selectAndDrawRoute) {
      window.selectAndDrawRoute(state.activeRouteIndex || 0);
    }
  };

  window.onRouteChangeFilter = function(key, val) {
    state.routeFilters[key] = val;
    renderRoutesSection();
    if (window.selectAndDrawRoute) {
      window.selectAndDrawRoute(state.activeRouteIndex || 0);
    }
  };

  window.resetRouteFilters = function() {
    state.routeOrigin = 'GPS';
    state.routeMaxStops = 20;
    state.routeFilters = { district: 'ALL', mgmt: 'ALL', cat: 'ALL', priority: 'ALL' };

    const elOrigin = document.getElementById('route-origin-select');
    const elStops = document.getElementById('route-stops-count-select');
    const elDist = document.getElementById('route-district-select');
    const elPriority = document.getElementById('route-priority-select');
    const elMgmt = document.getElementById('route-mgmt-select');
    const elCat = document.getElementById('route-cat-select');

    if (elOrigin) elOrigin.value = 'GPS';
    if (elStops) elStops.value = '20';
    if (elDist) elDist.value = 'ALL';
    if (elPriority) elPriority.value = 'ALL';
    if (elMgmt) elMgmt.value = 'ALL';
    if (elCat) elCat.value = 'ALL';

    renderRoutesSection();
    if (window.selectAndDrawRoute) {
      window.selectAndDrawRoute(state.activeRouteIndex || 0);
    }
  };

  function generateVisitRoutes() {
    if (!state.schools || state.schools.length === 0) return [];

    let originLat = 21.1458;
    let originLon = 79.0882;
    let originName = 'Nagpur Reference Center';

    if (state.routeOrigin === 'GPS') {
      if (state.userLocation && state.userLocation.lat) {
        originLat = state.userLocation.lat;
        originLon = state.userLocation.lon;
        originName = state.userLocation.name || 'Live Device GPS';
      }
    } else if (DISTRICT_CENTROIDS[state.routeOrigin]) {
      originLat = DISTRICT_CENTROIDS[state.routeOrigin].lat;
      originLon = DISTRICT_CENTROIDS[state.routeOrigin].lon;
      originName = (DISTRICT_CENTROIDS[state.routeOrigin].name || state.routeOrigin) + ' Center';
    }

    const maxStops = state.routeMaxStops || 20;
    const rf = state.routeFilters || {};

    // 1. Calculate distance of all schools from THIS chosen origin!
    let pool = state.schools.filter(s => s.lat && s.lon).map(s => {
      const d = calculateDistanceKm(originLat, originLon, s.lat, s.lon);
      return Object.assign({}, s, { distKm: d });
    });

    // Apply Distance Range (KM) Filter
    if (rf.distance && rf.distance !== 'ALL') {
      const parts = rf.distance.split('-');
      const minD = parseFloat(parts[0]) || 0;
      const maxD = parseFloat(parts[1]) || 999999;
      pool = pool.filter(s => s.distKm >= minD && s.distKm <= maxD);
    }

    // 2. Apply District Filter
    if (rf.district && rf.district !== 'ALL') {
      pool = pool.filter(s => s.dist === rf.district);
    }

    // 3. Apply Management Filter
    if (rf.mgmt === 'ZP_GOVT') {
      pool = pool.filter(s => s.mgmt.includes('Zilla Parishad') || s.mgmt.includes('Government'));
    } else if (rf.mgmt === 'AIDED') {
      pool = pool.filter(s => s.mgmt.includes('Aided') && !s.mgmt.includes('Unaided'));
    } else if (rf.mgmt === 'UNAIDED') {
      pool = pool.filter(s => s.mgmt.includes('Unaided'));
    }

    // 4. Apply Category / Level Filter
    if (rf.cat === 'PRIMARY') {
      pool = pool.filter(s => s.cat.includes('Primary') && !s.cat.includes('Upper') && !s.cat.includes('Secondary'));
    } else if (rf.cat === 'UPPER_PRIMARY') {
      pool = pool.filter(s => s.cat.includes('Upper Primary'));
    } else if (rf.cat === 'SECONDARY') {
      pool = pool.filter(s => s.cat.includes('Secondary') && !s.cat.includes('Higher'));
    } else if (rf.cat === 'HIGHER_SECONDARY') {
      pool = pool.filter(s => s.cat.includes('Higher Secondary'));
    }

    // 5. Apply Priority / Student Count Filter
    if (rf.priority === 'MEGA') {
      pool = pool.filter(s => (s.students || 0) >= 1000);
    } else if (rf.priority === 'VERY_HIGH') {
      pool = pool.filter(s => (s.students || 0) >= 650);
    } else if (rf.priority === 'HIGH') {
      pool = pool.filter(s => (s.students || 0) >= 350);
    } else if (rf.priority === 'MEDIUM') {
      pool = pool.filter(s => (s.students || 0) >= 150 && (s.students || 0) < 350);
    } else if (rf.priority === 'LOW') {
      pool = pool.filter(s => (s.students || 0) < 150);
    }

    // Update real-time matching counter
    const counterEl = document.getElementById('route-matching-counter');
    if (counterEl) {
      counterEl.textContent = `Matching: ${pool.length.toLocaleString()} Schools`;
    }

    if (pool.length === 0) {
      return [];
    }

    // Sort by proximity from origin
    pool.sort((a, b) => a.distKm - b.distKm);

    // Generate 4 distinct optimized circuits based on filtered pool:
    // Route 1: High Enrollment Circuit (Prioritizes 250+ students or highest in pool)
    const r1Candidates = pool.filter(s => (s.students || 0) >= 200);
    const poolR1 = r1Candidates.length >= maxStops ? r1Candidates : pool;
    const r1Stops = optimizeNearestNeighborRoute(originLat, originLon, poolR1, maxStops);

    // Route 2: Rapid Proximity Circuit (Absolute closest schools to start base)
    const poolR2 = pool.slice(0, Math.max(maxStops * 2, maxStops + 10));
    const r2Stops = optimizeNearestNeighborRoute(originLat, originLon, poolR2, maxStops);

    // Route 3: Rural Village Outreach (Gramin / ZP schools)
    const ruralCandidates = pool.filter(s => s.locale === 'Rural' || s.mgmt.includes('Zilla Parishad') || s.mgmt.includes('Government'));
    const poolR3 = ruralCandidates.length >= maxStops ? ruralCandidates : pool;
    const r3Stops = optimizeNearestNeighborRoute(originLat, originLon, poolR3, maxStops);

    // Route 4: Secondary & High School Infrastructure
    const secCandidates = pool.filter(s => s.cat.includes('Secondary') || s.cat.includes('Higher') || (s.students || 0) >= 250);
    const poolR4 = secCandidates.length >= maxStops ? secCandidates : pool;
    const r4Stops = optimizeNearestNeighborRoute(originLat, originLon, poolR4, maxStops);

    function buildRouteObj(id, name, tag, desc, color, orderedStopsList) {
      let cumKm = 0;
      let totalStudents = 0;
      let highCount = 0;

      const stops = orderedStopsList.map((st, idx) => {
        cumKm += st.legDistKm;
        const std = Number(st.school.students) || 0;
        totalStudents += std;
        if (std >= 350) highCount++;

        return {
          step: idx + 1,
          school: st.school,
          legDistKm: st.legDistKm,
          cumDistKm: Math.round(cumKm * 10) / 10
        };
      });

      // Google Maps URL with waypoints (up to 10 stops per URL for mobile browser reliability)
      const gmapsStops = [`${originLat},${originLon}`];
      stops.slice(0, 10).forEach(st => gmapsStops.push(`${st.school.lat},${st.school.lon}`));
      const gmapsUrl = `https://www.google.com/maps/dir/${gmapsStops.join('/')}`;

      return {
        id,
        name: `${name} (${stops.length} Schools)`,
        tag,
        desc,
        color,
        originName,
        originLat,
        originLon,
        totalKm: Math.round(cumKm * 10) / 10,
        stopsCount: stops.length,
        totalStudents,
        highCount,
        star1Count: stops.length - highCount,
        star2PlusCount: highCount,
        stops,
        gmapsUrl
      };
    }

    return [
      buildRouteObj('r1', '🌟 Route 1: High Enrollment Circuit', 'Priority Hubs', `Optimized sequence visiting ${r1Stops.length} highest enrollment schools with minimal drive time.`, '#d97706', r1Stops),
      buildRouteObj('r2', '⚡ Route 2: Rapid Proximity Circuit', 'Fastest Loop', `Shortest total driving distance connecting the ${r2Stops.length} closest schools to start base.`, '#1a73e8', r2Stops),
      buildRouteObj('r3', '🌾 Route 3: Rural Village Outreach', 'Village Focus', `Rural inspection loop covering ${r3Stops.length} village Zilla Parishad and Gramin schools.`, '#16a34a', r3Stops),
      buildRouteObj('r4', '🎓 Route 4: Secondary & High Schools', 'Higher Education', `Infrastructure inspection route covering ${r4Stops.length} secondary and composite schools with senior batches.`, '#9333ea', r4Stops)
    ];
  }


  // ==========================================================================
  // DYNAMIC ROUTE SELECTION & REAL-TIME MAP UPDATE
  // ==========================================================================
  window.selectAndDrawRoute = function(routeIndex) {
    state.activeRouteIndex = routeIndex;
    const routes = state.currentGeneratedRoutes || [];
    const route = routes[routeIndex];
    if (!route) return;

    // 1. Update Route Pills
    for (let i = 0; i < 4; i++) {
      const pill = document.getElementById(`pill-route-${i}`);
      if (pill) {
        if (i === routeIndex) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      }
    }

    // 2. Update Route Cards
    document.querySelectorAll('.route-card').forEach((card, idx) => {
      if (idx === routeIndex) {
        card.classList.add('active-circuit');
        card.style.borderColor = route.color;
      } else {
        card.classList.remove('active-circuit');
        card.style.borderColor = '#e2e8f0';
      }
    });

    // 3. Update Title & Gmaps Full Route Button
    const mapTitle = document.getElementById('route-map-title');
    if (mapTitle) {
      mapTitle.textContent = `${route.name} (${route.totalKm} KM • ${route.stopsCount} Stops)`;
    }

    const gmapsBtn = document.getElementById('btn-open-gmaps-full-route');
    if (gmapsBtn) {
      gmapsBtn.href = route.gmapsUrl;
      gmapsBtn.innerHTML = `🚗 Open ${route.name.split(':')[0]} in Google Maps`;
    }

    // 4. Update Turn-by-Turn Itinerary Table
    renderRouteItineraryTable(route);

    // 5. Draw on Map immediately!
    drawRouteLeaflet(route);
  };

  function renderRouteItineraryTable(route) {
    const titleEl = document.getElementById('itinerary-table-title');
    const subtitleEl = document.getElementById('itinerary-table-subtitle');
    const tbody = document.getElementById('itinerary-table-tbody');
    const badgesEl = document.getElementById('itinerary-summary-badges');

    if (titleEl) {
      titleEl.innerHTML = `${route.name} — Turn-by-Turn Itinerary`;
    }
    if (subtitleEl) {
      subtitleEl.innerHTML = `Total Distance: <b>${route.totalKm} KM</b> | Total Enrolled Students: <b>${route.totalStudents.toLocaleString()}</b> across ${route.stopsCount} inspection stops`;
    }
    if (badgesEl) {
      badgesEl.innerHTML = `
        <span style="background:#dcfce7;color:#15803d;padding:3px 8px;border-radius:12px;font-weight:700;">🟢 &lt;350: ${route.star1Count}</span>
        <span style="background:#fee2e2;color:#b91c1c;padding:3px 8px;border-radius:12px;font-weight:700;">🔴 350+: ${route.star2PlusCount}</span>
      `;
    }

    if (!tbody) return;
    tbody.innerHTML = '';

    route.stops.forEach(st => {
      const s = st.school;
      const std = Number(s.students) || 0;
      const starInfo = getSchoolStarInfo(std);
      const navUrl = `https://www.google.com/maps/dir/${st.school.lat},${st.school.lon}`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="padding:10px 12px;">
          <div class="itinerary-stop-num" style="background:${route.color};">${st.step}</div>
        </td>
        <td style="padding:10px 12px;">
          <b style="color:#0f172a;font-size:13px;">${escapeHtml(s.name)}</b><br>
          <span style="font-size:11px;color:#64748b;">UDISE: ${escapeHtml(s.udise)} • ${escapeHtml(s.cat)}</span>
        </td>
        <td style="padding:10px 12px;color:#475569;font-size:12px;">
          📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}
        </td>
        <td style="padding:10px 12px;">
          <span style="display:inline-flex;align-items:center;gap:4px;font-weight:700;color:${starInfo.color};font-size:12px;">
            👥 ${std.toLocaleString()}
          </span><br>
          <span style="background:${starInfo.badgeBg};color:${starInfo.badgeText};padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;">${starInfo.shortTier}</span>
        </td>
        <td style="padding:10px 12px;font-weight:600;color:#0f172a;">
          +${st.legDistKm} KM
        </td>
        <td style="padding:10px 12px;font-weight:700;color:${route.color};">
          ${st.cumDistKm} KM
        </td>
        <td style="padding:10px 12px;text-align:right;">
          <a href="${navUrl}" target="_blank" style="background:#1a73e8;color:#fff;padding:5px 10px;border-radius:5px;text-decoration:none;font-size:11px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
            🚗 Navigate
          </a>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderRoutesSection() {
    const grid = document.getElementById('routes-cards-grid');
    if (!grid) return;

    state.currentGeneratedRoutes = generateVisitRoutes();
    const routes = state.currentGeneratedRoutes;
    if (routes.length === 0) {
      grid.innerHTML = '<div style="padding:20px;color:#64748b;">No routes generated yet.</div>';
      return;
    }

    grid.innerHTML = '';
    routes.forEach((route, idx) => {
      const card = document.createElement('div');
      card.className = `route-card ${idx === (state.activeRouteIndex || 0) ? 'active-circuit' : ''}`;
      card.id = `route-card-${idx}`;
      card.onclick = () => window.selectAndDrawRoute(idx);
      card.style.cursor = 'pointer';

      card.innerHTML = `
        <div class="route-card-header" style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
          <div>
            <span class="route-tag" style="background:${route.color}22;color:${route.color};font-weight:800;padding:2px 8px;border-radius:12px;font-size:11px;">${route.tag}</span>
            <h3 style="margin:4px 0 0 0;font-size:15px;color:#0f172a;">${route.name}</h3>
          </div>
          <span style="font-size:16px;font-weight:800;color:${route.color};">${route.totalKm} KM</span>
        </div>
        <p style="font-size:12px;color:#64748b;margin:0 0 10px 0;line-height:1.4;">${route.desc}</p>
        <div style="font-size:11px;color:#334155;background:#f8fafc;padding:6px 10px;border-radius:6px;margin-bottom:10px;display:flex;justify-content:space-between;">
          <span>Stops: <b>${route.stopsCount} Schools</b></span>
          <span>Students: <b>${route.totalStudents.toLocaleString()}</b></span>
        </div>
        <div style="display:flex;gap:8px;">
          <button onclick="event.stopPropagation(); window.selectAndDrawRoute(${idx});" style="flex:1;background:${route.color};color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;">
            🗺️ View on Map
          </button>
          <a href="${route.gmapsUrl}" target="_blank" onclick="event.stopPropagation();" style="background:#16a34a;color:#fff;padding:6px 10px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:700;display:inline-flex;align-items:center;">
            🚗 G-Maps
          </a>
        </div>
      `;
      grid.appendChild(card);
    });

    // Auto draw initial active route
    window.selectAndDrawRoute(state.activeRouteIndex || 0);
  }

window.drawRouteOnMap = function(routeIndex) {
    state.activeRouteIndex = routeIndex;
    const route = state.currentGeneratedRoutes ? state.currentGeneratedRoutes[routeIndex] : null;
    if (!route) return;

    document.querySelectorAll('.route-card').forEach((card, idx) => {
      if (idx === routeIndex) {
        card.classList.add('active-circuit');
      } else {
        card.classList.remove('active-circuit');
      }
    });

    const routeMapTitle = document.getElementById('route-map-title');
    if (routeMapTitle) {
      routeMapTitle.textContent = `${route.name} (${route.totalKm} KM)`;
    }

    if (mapMode === 'google_js' && googleRouteMap) {
      drawRouteGoogleJs(route);
    } else {
      drawRouteLeaflet(route);
    }
  };

  function drawRouteLeaflet(route) {
    if (!leafletRouteMap) {
      initLeafletGoogleMaps();
    }
    if (!leafletRouteMap) return;

    leafletRouteMap.invalidateSize();

    leafletRouteMarkers.forEach(m => leafletRouteMap.removeLayer(m));
    leafletRouteMarkers = [];
    if (leafletRoutePolyline) {
      leafletRouteMap.removeLayer(leafletRoutePolyline);
      leafletRoutePolyline = null;
    }

    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const latLngs = [[originLat, originLon]];

    const originIcon = L.divIcon({
      className: 'route-origin-pin',
      html: '<div style="background:#0f172a;color:#fff;font-size:10px;font-weight:800;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,0.4);">START</div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    const startM = L.marker([originLat, originLon], { icon: originIcon })
      .addTo(leafletRouteMap)
      .bindPopup(`<b>📍 Circuit Departure Origin</b><br>${escapeHtml(route.originName)}`);
    leafletRouteMarkers.push(startM);

    route.stops.forEach(st => {
      const s = st.school;
      latLngs.push([s.lat, s.lon]);

      const std = Number(s.students) || 0;
      const starInfo = getSchoolStarInfo(std);

      const pinIcon = L.divIcon({
        className: 'route-stop-pin',
        html: `
          <div style="
            background: ${route.color || '#1a73e8'};
            color: #ffffff;
            border: 2px solid #ffffff;
            box-shadow: 0 3px 10px rgba(0,0,0,0.4);
            border-radius: 16px;
            padding: 2px 7px;
            font-size: 11px;
            font-weight: 800;
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            cursor: pointer;
            transform: translate(-50%, -50%);
          ">
            <span style="background:rgba(255,255,255,0.25);border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;">${st.step}</span>
            ${starInfo.starStr ? `<span style="font-size:9px;">${starInfo.starStr}</span>` : ''}
            <span>👥 ${std.toLocaleString()}</span>
          </div>
        `,
        iconSize: [60, 24],
        iconAnchor: [30, 12]
      });

      const popupHtml = `
        <div style="font-family:sans-serif;padding:6px;max-width:260px;">
          <div style="color:${route.color || '#1a73e8'};font-size:11px;font-weight:700;">STOP #${st.step} OF ${route.stopsCount}</div>
          <h4 style="margin:2px 0 4px 0;font-size:13px;color:#0f172a;">${escapeHtml(s.name)}</h4>
          <div style="font-size:11px;color:#475569;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}</div>
          <div style="font-size:11px;margin-top:4px;">👥 <b>${(s.students||0).toLocaleString()}</b> Students • <b>+${st.legDistKm} KM</b> (Cumulative: <b>${st.cumDistKm} KM</b>)</div>
        </div>
      `;

      const m = L.marker([s.lat, s.lon], { icon: pinIcon })
        .addTo(leafletRouteMap)
        .bindPopup(popupHtml);
      leafletRouteMarkers.push(m);
    });

    leafletRoutePolyline = L.polyline(latLngs, {
      color: route.color || '#1a73e8',
      weight: 5,
      opacity: 0.85
    }).addTo(leafletRouteMap);

    leafletRouteMap.fitBounds(latLngs, { padding: [35, 35] });
  }

  function drawRouteGoogleJs(route) {
    if (!googleRouteMap) return;

    googleRouteMarkers.forEach(m => m.setMap(null));
    googleRouteMarkers = [];
    if (googleRoutePolyline) {
      googleRoutePolyline.setMap(null);
      googleRoutePolyline = null;
    }

    const bounds = new google.maps.LatLngBounds();
    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const startPos = { lat: originLat, lng: originLon };
    const pathCoords = [startPos];
    bounds.extend(startPos);

    const originMarker = new google.maps.Marker({
      position: startPos,
      map: googleRouteMap,
      title: 'Start Location: ' + route.originName,
      icon: 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
    });
    routeMarkers.push(originMarker);

    route.stops.forEach(st => {
      const pos = { lat: st.school.lat, lng: st.school.lon };
      pathCoords.push(pos);
      bounds.extend(pos);

      const m = new google.maps.Marker({
        position: pos,
        map: googleRouteMap,
        title: `Stop #${st.step}: ${st.school.name}`,
        label: {
          text: String(st.step),
          color: '#ffffff',
          fontSize: '11px',
          fontWeight: 'bold'
        }
      });

      m.addListener('click', () => {
        const content = `
          <div style="font-family:sans-serif;padding:6px;max-width:260px;">
            <div style="color:#1a73e8;font-size:11px;font-weight:700;">ROUTE STOP #${st.step}</div>
            <h4 style="margin:2px 0 4px 0;font-size:13px;color:#0f172a;">${escapeHtml(st.school.name)}</h4>
            <div style="font-size:11px;color:#475569;">📍 ${escapeHtml(st.school.village || st.school.block)}, ${escapeHtml(st.school.dist)}</div>
            <div style="font-size:11px;margin-top:4px;">👥 <b>${(st.school.students||0).toLocaleString()}</b> Students • <b>+${st.legDistKm} KM</b> (Cumulative: <b>${st.cumDistKm} KM</b>)</div>
          </div>
        `;
        if (googleInfoWindow) {
          googleInfoWindow.setContent(content);
          googleInfoWindow.open(googleRouteMap, m);
        }
      });

      googleRouteMarkers.push(m);
    });

    googleRoutePolyline = new google.maps.Polyline({
      path: pathCoords,
      geodesic: true,
      strokeColor: route.color || '#1a73e8',
      strokeOpacity: 0.85,
      strokeWeight: 5
    });
    googleRoutePolyline.setMap(googleRouteMap);
    googleRouteMap.fitBounds(bounds);
  }

  // ==========================================================================
  function generateVisitRoutes() {
    if (!state.schools || state.schools.length === 0) return [];

    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const originName = state.userLocation ? state.userLocation.name : 'Nagpur Reference Center';
    const maxStops = state.routeMaxStops || 20;

    let candidates = state.schools.filter(s => s.lat && s.lon && s.distKm !== null);
    if (candidates.length === 0) {
      candidates = state.schools.slice(0, 100).map(s => {
        const d = calculateDistanceKm(originLat, originLon, s.lat, s.lon);
        return Object.assign({}, s, { distKm: d });
      });
    }

    candidates.sort((a, b) => a.distKm - b.distKm);

    // Route 1: Rapid Proximity Loop (Closest up to maxStops schools)
    const r1Schools = candidates.slice(0, maxStops);

    // Route 2: Major Enrollment & Secondary Hubs (Top schools up to maxStops)
    const within50 = candidates.filter(s => s.distKm <= 60);
    const poolR2 = within50.length >= maxStops ? within50 : candidates.slice(0, maxStops * 2);
    const sortedByStudents = poolR2.slice().sort((a, b) => (b.students || 0) - (a.students || 0));
    const r2Schools = sortedByStudents.slice(0, maxStops);
    r2Schools.sort((a, b) => a.distKm - b.distKm);

    // Route 3: Rural Outreach & Village Cluster Loop
    const ruralPool = candidates.filter(s => s.locale === 'Rural' && s.distKm >= 3 && s.distKm <= 65);
    const poolR3 = ruralPool.length >= maxStops ? ruralPool : candidates.slice(5, maxStops + 5);
    const r3Schools = poolR3.slice(0, maxStops);

    function buildRouteObj(id, name, tag, desc, color, schools) {
      let totalKm = 0;
      let prevLat = originLat;
      let prevLon = originLon;
      const stops = [];

      schools.forEach((s, idx) => {
        const leg = calculateDistanceKm(prevLat, prevLon, s.lat, s.lon) || 0;
        totalKm += leg;
        prevLat = s.lat;
        prevLon = s.lon;
        stops.push({
          step: idx + 1,
          school: s,
          legKm: leg
        });
      });

      function makeGmapsLink(sliceArr, startLat, startLon) {
        if (!sliceArr || sliceArr.length === 0) return '';
        const stopsList = [`${startLat},${startLon}`];
        sliceArr.forEach(s => stopsList.push(`${s.lat},${s.lon}`));
        return `https://www.google.com/maps/dir/${stopsList.join('/')}`;
      }

      let gmapsMainUrl = makeGmapsLink(schools.slice(0, 10), originLat, originLon);
      let gmapsLeg2Url = '';

      if (schools.length > 10) {
        const leg2Start = schools[9];
        gmapsLeg2Url = makeGmapsLink(schools.slice(10), leg2Start.lat, leg2Start.lon);
      }

      return {
        id,
        name,
        tag,
        desc,
        color,
        originName,
        totalKm: Math.round(totalKm * 10) / 10,
        stopsCount: schools.length,
        stops,
        gmapsMainUrl,
        gmapsLeg2Url
      };
    }

    const route1 = buildRouteObj(
      1,
      `Circuit 1: Fast Proximity Loop (${maxStops} Schools)`,
      'High-Density Loop',
      `Continuous nearest-neighbor inspection circuit visiting up to ${maxStops} schools with minimal drive time.`,
      '#2563eb',
      r1Schools
    );

    const route2 = buildRouteObj(
      2,
      `Circuit 2: Major Enrollment Hubs (${maxStops} Schools)`,
      'High-Attendance Tour',
      `Visits the largest capacity High Schools, Jr. Colleges, and Aided institutions in the sector.`,
      '#059669',
      r2Schools
    );

    const route3 = buildRouteObj(
      3,
      `Circuit 3: Rural Outreach & Village Cluster (${maxStops} Schools)`,
      'Rural Field Visit',
      `Dedicated route connecting remote Zilla Parishad village schools and tribal Ashram Shalas.`,
      '#7c3aed',
      r3Schools
    );

    state.currentGeneratedRoutes = [route1, route2, route3];
    return state.currentGeneratedRoutes;
  }

  function renderRoutesSection() {
    const grid = document.getElementById('routes-cards-grid');
    if (!grid) return;

    const routes = generateVisitRoutes();
    const originLabel = document.getElementById('route-origin-label');
    if (originLabel && state.userLocation) {
      originLabel.textContent = `${state.userLocation.name}`;
    }

    if (!routes || routes.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:24px;">Loading routes...</div>';
      return;
    }

    grid.innerHTML = routes.map((r, rIdx) => {
      const stopsHtml = r.stops.map(st => `
        <li class="route-stop-item">
          <div class="route-stop-badge">${st.step}</div>
          <div class="route-stop-body">
            <div class="route-stop-name" title="${escapeHtml(st.school.name)}">${escapeHtml(st.school.name)}</div>
            <div class="route-stop-meta">
              <span>📍 ${escapeHtml(st.school.village || st.school.block)} (${escapeHtml(st.school.dist)})</span> • 
              <span class="route-stop-leg">+${st.legKm} KM leg</span> • 
              <span>👥 ${(st.school.students || 0).toLocaleString()}</span>
            </div>
          </div>
        </li>
      `).join('');

      let gmapsButtonsHtml = '';
      if (r.gmapsLeg2Url) {
        gmapsButtonsHtml = `
          <div class="route-gmaps-btn-group">
            <a href="${r.gmapsMainUrl}" target="_blank" rel="noopener" class="btn-open-gmaps-subleg">
              🚗 Part 1: Stops 1 to 10 in Google Maps
            </a>
            <a href="${r.gmapsLeg2Url}" target="_blank" rel="noopener" class="btn-open-gmaps-subleg" style="background:#0f766e;">
              🚗 Part 2: Stops 10 to ${r.stopsCount} in Google Maps
            </a>
          </div>
        `;
      } else {
        gmapsButtonsHtml = `
          <a href="${r.gmapsMainUrl}" target="_blank" rel="noopener" class="btn-open-gmaps-route">
            🚗 Open Entire Route in Google Maps
          </a>
        `;
      }

      return `
        <div class="route-card route-card-${r.id} ${rIdx === state.activeRouteIndex ? 'active-circuit' : ''}">
          <div class="route-card-header">
            <span class="route-circuit-tag">${escapeHtml(r.tag)}</span>
            <h3 class="route-title">${escapeHtml(r.name)}</h3>
            <p class="route-subtitle">${escapeHtml(r.desc)}</p>
          </div>

          <div class="route-metrics-bar">
            <div class="route-metric-item">
              <strong>${r.totalKm} KM</strong>
              <span>Total Distance</span>
            </div>
            <div class="route-metric-item">
              <strong>${r.stopsCount} Stops</strong>
              <span>Schools Covered</span>
            </div>
            <div class="route-metric-item">
              <strong>~${Math.round(r.totalKm * 2.1 + (r.stopsCount * 7))} min</strong>
              <span>Est. Tour Time</span>
            </div>
          </div>

          <ul class="route-stops-list">
            <li class="route-stop-item" style="opacity: 0.85;">
              <div class="route-stop-badge" style="background: #0f172a;">S</div>
              <div class="route-stop-body">
                <div class="route-stop-name">Start: ${escapeHtml(r.originName)}</div>
                <div class="route-stop-meta">Departure Origin (0.0 KM)</div>
              </div>
            </li>
            ${stopsHtml}
          </ul>

          <div class="route-card-actions">
            ${gmapsButtonsHtml}
            <button class="btn-view-route-map" onclick="window.drawRouteOnMap(${rIdx})">
              🗺️ Display Route (${r.stopsCount} Stops) on Map
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Automatically draw the first active circuit on Route Map
    setTimeout(() => {
      window.drawRouteOnMap(state.activeRouteIndex || 0);
    }, 200);
  }

  // ==========================================================================
  // Near Me Cards Rendering with Exact Distance Ranges
  // ==========================================================================
  
  // Dual Filter State for Home and Near Me & Live Map
  state.nearmeFilters = {
    district: 'ALL',
    priority: 'ALL',
    mgmt: 'ALL',
    cat: 'ALL',
    search: ''
  };

  
  window.syncNearmeDistance = function(val) {
    const parts = (val || '0-20').split('-');
    const min = parseFloat(parts[0]) || 0;
    const max = parseFloat(parts[1]) || 999999;
    state.nearDistanceRange = { min, max };
    state.nearmeDisplayLimit = 50;

    // 1. Sync all Distance dropdowns on both pages
    document.querySelectorAll('.filter-sync-km').forEach(el => el.value = val);

    // 2. Sync all Quick KM chip buttons on both pages
    document.querySelectorAll('.km-chip-btn').forEach(btn => {
      if (btn.getAttribute('data-range') === val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 3. Sync old radius chips if present
    document.querySelectorAll('.radius-chip').forEach(chip => {
      const cMin = parseFloat(chip.dataset.min || '0');
      const cMax = parseFloat(chip.dataset.max || '999999');
      if (cMin === min && cMax === max) {
        chip.classList.add('active');
      } else {
        chip.classList.remove('active');
      }
    });

    // 4. Re-render Near Me section
    renderNearMeSection();
  };

  window.syncNearmeFilter = function(key, val) {
    state.nearmeFilters[key] = val;
    state.nearmeDisplayLimit = 50;

    // Sync all corresponding UI inputs on both pages
    if (key === 'district') {
      document.querySelectorAll('.filter-sync-district').forEach(el => el.value = val);
    } else if (key === 'priority') {
      document.querySelectorAll('.filter-sync-priority').forEach(el => el.value = val);
    } else if (key === 'mgmt') {
      document.querySelectorAll('.filter-sync-mgmt').forEach(el => el.value = val);
    } else if (key === 'cat') {
      document.querySelectorAll('.filter-sync-cat').forEach(el => el.value = val);
    } else if (key === 'search') {
      document.querySelectorAll('.filter-sync-search').forEach(el => el.value = val);
    }

    renderNearMeSection();
  };

  window.clearNearmeSearch = function() {
    window.syncNearmeFilter('search', '');
  };

  function renderNearMeSection() {
    const homeContainer = document.getElementById('home-nearme-cards-grid');
    const mapContainer = document.getElementById('nearme-cards-grid');

    const minRange = state.nearDistanceRange ? state.nearDistanceRange.min : 0;
    const maxRange = state.nearDistanceRange ? state.nearDistanceRange.max : 20;

    const nf = state.nearmeFilters || { district: 'ALL', priority: 'ALL', mgmt: 'ALL', cat: 'ALL', search: '' };
    const query = (nf.search || state.searchQuery || '').trim().toLowerCase();

    let nearby = state.schools.filter(s => {
      // 1. Distance filter
      if (s.distKm !== null) {
        if (s.distKm < minRange || s.distKm > maxRange) return false;
      }

      // 2. District filter
      if (nf.district && nf.district !== 'ALL') {
        if (s.dist !== nf.district) return false;
      }

      // 3. Priority / Student strength filter
      if (nf.priority === 'MEGA') {
        if ((s.students || 0) < 1000) return false;
      } else if (nf.priority === 'VERY_HIGH') {
        if ((s.students || 0) < 650) return false;
      } else if (nf.priority === 'HIGH') {
        if ((s.students || 0) < 350) return false;
      } else if (nf.priority === 'MID') {
        if ((s.students || 0) < 150 || (s.students || 0) >= 350) return false;
      } else if (nf.priority === 'LOW') {
        if ((s.students || 0) >= 150) return false;
      }

      // 4. Management filter
      if (nf.mgmt === 'ZP_GOVT') {
        if (!s.mgmt.includes('Zilla Parishad') && !s.mgmt.includes('Government')) return false;
      } else if (nf.mgmt === 'AIDED') {
        if (!s.mgmt.includes('Aided') || s.mgmt.includes('Unaided')) return false;
      } else if (nf.mgmt === 'UNAIDED') {
        if (!s.mgmt.includes('Unaided')) return false;
      }

      // 5. Category / Level filter
      if (nf.cat === 'PRIMARY') {
        if (!s.cat.includes('Primary') || s.cat.includes('Upper') || s.cat.includes('Secondary')) return false;
      } else if (nf.cat === 'UPPER_PRIMARY') {
        if (!s.cat.includes('Upper Primary')) return false;
      } else if (nf.cat === 'SECONDARY') {
        if (!s.cat.includes('Secondary') || s.cat.includes('Higher')) return false;
      } else if (nf.cat === 'HIGHER_SECONDARY') {
        if (!s.cat.includes('Higher Secondary')) return false;
      }

      // 6. Search query
      if (query) {
        const tokens = query.split(/\s+/).filter(Boolean);
        const matchStr = `${s.name} ${s.udise} ${s.village} ${s.block} ${s.cluster} ${s.dist} ${s.mgmt} ${s.cat} ${s.pin}`.toLowerCase();
        return tokens.every(tok => matchStr.includes(tok));
      }

      return true;
    });

    nearby.sort((a, b) => {
      if (a.distKm === null) return 1;
      if (b.distKm === null) return -1;
      return a.distKm - b.distKm;
    });

    const limit = state.nearmeDisplayLimit || 50;
    const topNearby = nearby.slice(0, limit);

    const countText = `Showing ${topNearby.length} of ${nearby.length.toLocaleString()} schools (All ${nearby.length.toLocaleString()} on Map) in ${minRange}–${maxRange >= 999999 ? 'All' : maxRange} KM`;
    const countPill = document.getElementById('nearme-results-pill');
    const homeCountPill = document.getElementById('home-nearme-results-pill');
    if (countPill) countPill.textContent = countText;
    if (homeCountPill) homeCountPill.textContent = countText;

    if (topNearby.length === 0) {
      const emptyHtml = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 24px; background: #fff; border: 1px solid #E0E0E0; border-radius: 10px;">
          <p style="font-size: 13px; color: #5F6368; margin: 0 0 4px 0;">No schools match these filters in <b>${minRange}–${maxRange >= 999999 ? 'All' : maxRange} KM</b> range.</p>
          <span style="font-size: 11px; color: #80868B;">Try selecting "All Districts" or clearing the search text.</span>
        </div>
      `;
      if (homeContainer) homeContainer.innerHTML = emptyHtml;
      if (mapContainer) mapContainer.innerHTML = emptyHtml;
      updateSideMap([]);
      return;
    }

    const cardsHtml = topNearby.map(s => {
      const gmapsUrl = getGoogleMapsUrl(s.lat, s.lon, s.name);
      const std = Number(s.students) || 0;
      const traffic = getSchoolTrafficColorInfo(std);
      const inPlan = (state.preplan && state.preplan.selectedUdises || []).includes(s.udise);

      return `
        <div class="near-school-card">
          <div>
            <div class="near-card-header">
              <h4 class="near-school-name" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</h4>
              <span class="distance-badge" style="background:#eff6ff;color:#1d4ed8;">
                ${s.distKm !== null ? s.distKm + ' KM' : '—'}
              </span>
            </div>
            <div class="near-card-meta">
              📍 ${escapeHtml(s.village || s.block)} • ${escapeHtml(s.block)} • <b>${escapeHtml(s.dist)}</b>
            </div>
            <div class="near-card-tags">
              <span style="background:${traffic.color};color:#ffffff;font-size:10px;font-weight:800;padding:1px 6px;border-radius:10px;">
                👥 ${std.toLocaleString()} Students
              </span>
              <span class="tag-badge">UDISE: ${escapeHtml(s.udise)}</span>
              <span class="tag-badge">${escapeHtml(s.cat)}</span>
            </div>
          </div>
          <div class="near-card-actions">
            <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn-google-maps" style="background:#16a34a;color:#fff;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:4px;">
              🚗 Google Maps
            </a>
            <button onclick="window.togglePreplanSchool('${escapeHtml(s.udise)}')" style="background:${inPlan ? '#f0fdf4' : '#eff6ff'};color:${inPlan ? '#16a34a' : '#1d4ed8'};border:1px solid ${inPlan ? '#bbf7d0' : '#bfdbfe'};padding:6px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">
              ${inPlan ? '✓ In Tour' : '➕ Add'}
            </button>
            <button onclick="window.focusSchoolOnSideMap('${escapeHtml(s.udise)}'); window.switchTab('tab-nearme');" style="background:#f8fafc;color:#334155;border:1px solid #cbd5e1;padding:6px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">
              🗺️ Map
            </button>
            <button class="near-card-details-btn" data-school-udise="${escapeHtml(s.udise)}" style="background:#f8fafc;color:#334155;border:1px solid #cbd5e1;padding:6px 8px;border-radius:6px;font-size:11px;cursor:pointer;">
              📋
            </button>
          </div>
        </div>
      `;
    }).join('');

    if (homeContainer) homeContainer.innerHTML = cardsHtml;
    if (mapContainer) mapContainer.innerHTML = cardsHtml;

    // Add 'Load More' and 'Show All' controls if there are more schools in this range
    if (nearby.length > topNearby.length) {
      const loadMoreHtml = `
        <div class="near-load-more-bar" style="grid-column: 1 / -1; display:flex; gap:10px; justify-content:center; align-items:center; flex-wrap:wrap; padding: 14px 10px; background:#ffffff; border:1.5px dashed #cbd5e1; border-radius:12px; margin-top:8px;">
          <span style="font-size:12px; font-weight:700; color:#475569;">
            Showing ${topNearby.length} of ${nearby.length.toLocaleString()} schools in this ${minRange}–${maxRange >= 999999 ? 'All' : maxRange} KM range
          </span>
          <button onclick="window.loadMoreNearmeSchools(50)" style="background:#1a73e8; color:#ffffff; border:none; padding:8px 16px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
            📥 Load Next 50 Schools
          </button>
          <button onclick="window.loadAllNearmeSchools()" style="background:#16a34a; color:#ffffff; border:none; padding:8px 16px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
            ⚡ Show All ${nearby.length.toLocaleString()} Schools
          </button>
        </div>
      `;
      if (homeContainer) homeContainer.innerHTML += loadMoreHtml;
      if (mapContainer) mapContainer.innerHTML += loadMoreHtml;
    }

    attachNearCardListeners();
    // Plot ALL matching schools in the range on the map (None left out!)
    updateSideMap(nearby);
  }

  window.loadMoreNearmeSchools = function(n) {
    state.nearmeDisplayLimit = (state.nearmeDisplayLimit || 50) + n;
    renderNearMeSection();
  };

  window.loadAllNearmeSchools = function() {
    state.nearmeDisplayLimit = 999999;
    renderNearMeSection();
  };
  function attachNearCardListeners() {
    document.querySelectorAll('.near-card-details-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const udise = btn.dataset.schoolUdise;
        const school = state.schools.find(s => s.udise === udise);
        if (school) {
          openSchoolModal(school);
        }
      });
    });
  }

  // ==========================================================================
  // School Details Modal Dialog (100% Reliable & Non-Crashing)
  // ==========================================================================
  function openSchoolModal(s) {
    if (!s) return;
    state.selectedSchool = s;
    const modal = document.getElementById('school-modal');
    if (!modal) return;

    // Header values
    setText('modal-school-name', s.name);
    setText('modal-udise-code', s.udise);

    // Highlight metrics
    setText('modal-stat-students', (s.students || 0).toLocaleString());
    setText('modal-stat-classes', s.classes || 'Classes 1 to 8');
    setText('modal-stat-mgmt', s.mgmt || 'Government');
    setText('modal-stat-dist', s.distKm !== null ? `${s.distKm} KM away` : 'Set location to view distance');

    // Table values
    setText('modal-cat', s.cat || 'Primary');
    setText('modal-type', s.type || 'Co-Educational');
    setText('modal-locale', s.locale || 'Rural');
    setText('modal-district', s.dist || '—');
    setText('modal-block', s.block || '—');
    setText('modal-cluster', s.cluster || s.block || '—');
    setText('modal-village', s.village || '—');
    setText('modal-pin', s.pin || '—');
    setText('modal-contact', s.contact || 'Headmaster / In-Charge');
    setText('modal-coords', `${s.lat}, ${s.lon}`);
    setText('modal-status', s.status || 'Operational');

    // Mobile / Phone
    const mobEl = document.getElementById('modal-mobile');
    if (mobEl) {
      if (s.mobile && String(s.mobile).match(/\d{10}/)) {
        mobEl.innerHTML = `<a href="tel:${s.mobile}" style="color:#1a73e8; font-weight:700; text-decoration:none;">📞 ${s.mobile} (Click to Call)</a>`;
      } else {
        mobEl.textContent = s.mobile || 'Available via School / BEO';
      }
    }

    // Google Maps Navigation Button
    const gmapsBtn = document.getElementById('modal-btn-gmaps');
    if (gmapsBtn) {
      gmapsBtn.href = getGoogleMapsUrl(s.lat, s.lon, s.name);
    }

    // View on Map Button inside Modal
    const showMapBtn = document.getElementById('modal-btn-show-map');
    if (showMapBtn) {
      showMapBtn.onclick = function () {
        closeSchoolModal();
        window.focusSchoolOnSideMap(s.udise);
      };
    }

    modal.style.display = 'flex';
  }

  window.closeSchoolModal = function () {
    const modal = document.getElementById('school-modal');
    if (modal) modal.style.display = 'none';
  };

  window.viewSchoolDetails = function (udise) {
    const school = state.schools.find(s => s.udise === udise);
    if (school) openSchoolModal(school);
  };

  // ==========================================================================
  // Directory Table Filtering & Pagination
  // ==========================================================================
  function applyFilters() {
    const f = state.filters;
    const query = state.searchQuery.trim().toLowerCase();

    let filtered = state.schools.filter(s => {
      if (f.district !== 'ALL' && s.dist !== f.district) return false;
      if (f.block !== 'ALL' && s.block !== f.block) return false;
      if (f.management !== 'ALL' && !s.mgmt.includes(f.management)) return false;
      if (f.category !== 'ALL' && s.cat !== f.category) return false;
      if (f.type !== 'ALL' && s.type !== f.type) return false;
      if (f.locale !== 'ALL' && s.locale !== f.locale) return false;

      // Table distance filter
      if (f.distanceRange && f.distanceRange !== 'ALL') {
        const parts = f.distanceRange.split('-');
        const minD = parseFloat(parts[0]);
        const maxD = parseFloat(parts[1]);
        if (s.distKm === null || s.distKm < minD || s.distKm > maxD) return false;
      }

      if (query) {
        const tokens = query.split(/\s+/).filter(Boolean);
        const matchStr = `${s.name} ${s.udise} ${s.village} ${s.block} ${s.cluster} ${s.dist} ${s.mgmt} ${s.cat} ${s.pin}`.toLowerCase();
        return tokens.every(tok => matchStr.includes(tok));
      }
      return true;
    });

    // Sorting
    filtered.sort((a, b) => {
      let vA = a[state.sortColumn];
      let vB = b[state.sortColumn];

      if (state.sortColumn === 'distKm') {
        if (vA === null) return 1;
        if (vB === null) return -1;
        return state.sortAsc ? (vA - vB) : (vB - vA);
      }
      if (state.sortColumn === 'students') {
        return state.sortAsc ? ((vA || 0) - (vB || 0)) : ((vB || 0) - (vA || 0));
      }

      vA = String(vA || '').toLowerCase();
      vB = String(vB || '').toLowerCase();
      if (vA < vB) return state.sortAsc ? -1 : 1;
      if (vA > vB) return state.sortAsc ? 1 : -1;
      return 0;
    });

    state.filteredSchools = filtered;
    state.pagination.total = filtered.length;
    renderTable();
    updateFilterCountBadge();
  }

  function renderTable() {
    const tbody = document.getElementById('table-schools-body');
    if (!tbody) return;

    const page = state.pagination.page;
    const pageSize = state.pagination.pageSize;
    const startIdx = (page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageSchools = state.filteredSchools.slice(startIdx, endIdx);

    if (pageSchools.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 48px 16px; color: #5F6368;">
            <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
            <strong style="font-size: 16px; color: #202124;">No matching schools found</strong>
            <p style="font-size: 13px; margin-top: 4px;">Try changing the filter options or clearing the search text.</p>
          </td>
        </tr>
      `;
      renderPaginationControls();
      return;
    }

    tbody.innerHTML = pageSchools.map(s => {
      const gmapsUrl = getGoogleMapsUrl(s.lat, s.lon, s.name);
      return `
        <tr>
          <td>
            <div class="table-school-title">${escapeHtml(s.name)}</div>
            <div class="table-school-meta">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.block)} (PIN: ${s.pin || ''})</div>
          </td>
          <td><code class="udise-code">${escapeHtml(s.udise)}</code></td>
          <td><span class="dist-badge dist-${escapeHtml(s.dist)}">${escapeHtml(s.dist)}</span></td>
          <td>${escapeHtml(s.block)}</td>
          <td><b>${(s.students || 0).toLocaleString()}</b></td>
          <td><span class="cat-pill">${escapeHtml(s.cat)}</span></td>
          <td><span class="dist-km-badge">${s.distKm !== null ? s.distKm + ' KM' : '—'}</span></td>
          <td>
            <div class="table-actions">
              <button class="btn-table-action" onclick="window.viewSchoolDetails('${escapeHtml(s.udise)}')">
                Details
              </button>
              <button class="btn-table-action" style="background:#eef2ff;color:#4338ca;border-color:#c7d2fe;" onclick="window.focusSchoolOnSideMap('${escapeHtml(s.udise)}')">
                Map
              </button>
              <a href="${gmapsUrl}" target="_blank" rel="noopener" class="btn-table-action gmaps" title="Open navigation in Google Maps">
                📍
              </a>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    renderPaginationControls();
  }

  function renderPaginationControls() {
    const info = document.getElementById('pagination-info');
    const controls = document.getElementById('pagination-controls');
    if (!controls) return;

    const total = state.pagination.total;
    const page = state.pagination.page;
    const pageSize = state.pagination.pageSize;
    const totalPages = Math.ceil(total / pageSize) || 1;

    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);

    if (info) {
      info.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${total.toLocaleString()} schools`;
    }

    let buttonsHtml = '';
    buttonsHtml += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="window.changePage(1)">«</button>`;
    buttonsHtml += `<button class="page-btn" ${page <= 1 ? 'disabled' : ''} onclick="window.changePage(${page - 1})">‹</button>`;

    let startPage = Math.max(1, page - 2);
    let endPage = Math.min(totalPages, page + 2);

    if (startPage > 1) {
      buttonsHtml += `<button class="page-btn" onclick="window.changePage(1)">1</button>`;
      if (startPage > 2) buttonsHtml += `<span class="page-ellipsis">…</span>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      buttonsHtml += `<button class="page-btn ${p === page ? 'active' : ''}" onclick="window.changePage(${p})">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) buttonsHtml += `<span class="page-ellipsis">…</span>`;
      buttonsHtml += `<button class="page-btn" onclick="window.changePage(${totalPages})">${totalPages}</button>`;
    }

    buttonsHtml += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="window.changePage(${page + 1})">›</button>`;
    buttonsHtml += `<button class="page-btn" ${page >= totalPages ? 'disabled' : ''} onclick="window.changePage(${totalPages})">»</button>`;

    controls.innerHTML = buttonsHtml;
  }

  window.changePage = function (newPage) {
    state.pagination.page = newPage;
    renderTable();
    const tableSection = document.getElementById('directory-section');
    if (tableSection) {
      tableSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  function updateFilterCountBadge() {
    const badge = document.getElementById('filter-results-count');
    if (badge) {
      badge.innerHTML = `Showing <strong>${state.filteredSchools.length.toLocaleString()}</strong> of ${state.schools.length.toLocaleString()} schools`;
    }
  }

  function renderDistrictPills() {
    document.querySelectorAll('.district-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const dist = btn.dataset.dist;
        state.filters.district = dist;
        state.activeDistrict = dist;

        document.querySelectorAll('.district-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const distSelect = document.getElementById('filter-district');
        if (distSelect) distSelect.value = dist;

        if (DISTRICT_CENTROIDS[dist]) {
          const c = DISTRICT_CENTROIDS[dist];
          setUserLocation(c.lat, c.lon, 50, `${dist} Center`, false);
        }

        populateBlockDropdown();
        applyFilters();

        const tableSection = document.getElementById('directory-section');
        if (tableSection) tableSection.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  // Event Listeners Setup
  
  
  
  // ==========================================================================
  // ==========================================================================
  // TRAFFIC LIGHT COLOR RULE (Student Density Gradient)
  // 🟢 Green: <150 (Low Density)
  // 🟡 Yellow: 150-350 (Medium Density)
  // 🟠 Orange: 351-650 (High Density)
  // 🔴 Red: 651-1000 (Very High Density)
  // 🟣 Purple: 1000+ (Mega Hub)
  // ==========================================================================
  function getSchoolTrafficColorInfo(students) {
    const count = Number(students) || 0;
    if (count < 150) {
      return {
        color: '#16a34a', // Traffic Green
        bgGradient: 'linear-gradient(135deg, #16a34a, #15803d)',
        badgeBg: '#dcfce7',
        badgeText: '#15803d',
        borderColor: '#86efac',
        tierName: 'Low (<150)',
        shortTier: '🟢 Low',
        starStr: '',
        textColor: '#ffffff',
        zIndex: 100
      };
    } else if (count <= 350) {
      return {
        color: '#d97706', // Traffic Yellow / Amber
        bgGradient: 'linear-gradient(135deg, #d97706, #b45309)',
        badgeBg: '#fef3c7',
        badgeText: '#92400e',
        borderColor: '#fde68a',
        tierName: 'Medium (150–350)',
        shortTier: '🟡 Medium',
        starStr: '',
        textColor: '#ffffff',
        zIndex: 300
      };
    } else if (count <= 650) {
      return {
        color: '#ea580c', // Traffic Orange
        bgGradient: 'linear-gradient(135deg, #ea580c, #c2410c)',
        badgeBg: '#ffedd5',
        badgeText: '#c2410c',
        borderColor: '#fed7aa',
        tierName: 'High (351–650)',
        shortTier: '🟠 High',
        starStr: '',
        textColor: '#ffffff',
        zIndex: 500
      };
    } else if (count <= 1000) {
      return {
        color: '#dc2626', // Traffic Red
        bgGradient: 'linear-gradient(135deg, #dc2626, #b91c1c)',
        badgeBg: '#fee2e2',
        badgeText: '#b91c1c',
        borderColor: '#fca5a5',
        tierName: 'Very High (651–1,000)',
        shortTier: '🔴 Very High',
        starStr: '',
        textColor: '#ffffff',
        zIndex: 700
      };
    } else {
      return {
        color: '#7e22ce', // Deep Purple / Mega
        bgGradient: 'linear-gradient(135deg, #7e22ce, #6b21a8)',
        badgeBg: '#f3e8ff',
        badgeText: '#6b21a8',
        borderColor: '#d8b4fe',
        tierName: 'Mega Hub (1,000+)',
        shortTier: '🟣 Mega Hub',
        starStr: '',
        textColor: '#ffffff',
        zIndex: 900
      };
    }
  }

  // Alias for backward compatibility
  function getSchoolStarInfo(students) {
    return getSchoolTrafficColorInfo(students);
  }

  // ==========================================================================
  // AUTOMATIC SINGLE SCHOOL ROUTING ON TOUCH / CLICK
  // ==========================================================================
  let activeSingleRouteLayers = [];

  window.clearActiveSingleRoute = function() {
    if (leafletSideMap && activeSingleRouteLayers.length > 0) {
      activeSingleRouteLayers.forEach(l => {
        try { leafletSideMap.removeLayer(l); } catch(e) {}
      });
      activeSingleRouteLayers = [];
    }
    const banner = document.getElementById('live-route-floating-banner');
    if (banner) banner.style.display = 'none';
  };

  window.routeToSchoolFromUserByUdise = function(udise) {
    const s = state.schools.find(x => x.udise === udise);
    if (s) {
      window.routeToSchoolFromUser(s);
      const mapEl = document.getElementById('side-interactive-map');
      if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  window.routeToSchoolFromUser = function(school) {
    if (!leafletSideMap || !school || !school.lat || !school.lon) return;

    window.clearActiveSingleRoute();

    const originLat = state.userLocation ? state.userLocation.lat : 21.1458;
    const originLon = state.userLocation ? state.userLocation.lon : 79.0882;
    const originName = state.userLocation ? state.userLocation.name : 'Nagpur Reference Center';

    const distKm = Math.round(calculateDistanceKm(originLat, originLon, school.lat, school.lon) * 10) / 10;
    const estMins = Math.max(1, Math.round(distKm / 35 * 60));
    const std = Number(school.students) || 0;
    const traffic = getSchoolTrafficColorInfo(std);

    const startCoord = [originLat, originLon];
    const endCoord = [school.lat, school.lon];

    // Double-layered glowing route line
    const glowLine = L.polyline([startCoord, endCoord], {
      color: '#1a73e8',
      weight: 8,
      opacity: 0.35
    }).addTo(leafletSideMap);

    const driveLine = L.polyline([startCoord, endCoord], {
      color: '#2563eb',
      weight: 4,
      dashArray: '8, 8',
      opacity: 0.95
    }).addTo(leafletSideMap);

    activeSingleRouteLayers.push(glowLine, driveLine);

    // Attempt OSRM turn-by-turn road geometry
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLon},${originLat};${school.lon},${school.lat}?overview=full&geometries=geojson`;
      fetch(osrmUrl)
        .then(r => r.json())
        .then(data => {
          if (data && data.routes && data.routes[0] && data.routes[0].geometry) {
            const roadCoords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
            driveLine.setLatLngs(roadCoords);
            glowLine.setLatLngs(roadCoords);
          }
        })
        .catch(() => {});
    } catch(e) {}

    leafletSideMap.fitBounds([startCoord, endCoord], { padding: [60, 60], maxZoom: 15 });

    // Show floating route banner
    const banner = document.getElementById('live-route-floating-banner');
    if (banner) {
      const navUrl = `https://www.google.com/maps/dir/${originLat},${originLon}/${school.lat},${school.lon}`;
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div style="flex:1;min-width:200px;">
          <div style="font-size:10px;font-weight:800;color:#1a73e8;text-transform:uppercase;">🚗 Live Route from ${escapeHtml(originName)}</div>
          <div style="font-size:14px;font-weight:800;color:#0f172a;margin:2px 0;">${escapeHtml(school.name)}</div>
          <div style="font-size:12px;color:#475569;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>📍 ${escapeHtml(school.village || school.block)}</span>
            <span>📏 <b>${distKm} KM</b> (~${estMins} mins)</span>
            <span style="background:${traffic.badgeBg};color:${traffic.badgeText};padding:2px 6px;border-radius:4px;font-weight:700;font-size:11px;">👥 ${std.toLocaleString()}</span>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <a href="${navUrl}" target="_blank" style="background:#16a34a;color:#ffffff;padding:7px 14px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:4px;box-shadow:0 2px 6px rgba(22,163,74,0.3);">
            🚀 Open Google Maps
          </a>
          <button onclick="window.clearActiveSingleRoute()" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;">
            ✕ Clear
          </button>
        </div>
      `;
    }
  };

  window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-page').forEach(page => {
      page.style.display = 'none';
    });

    const activePage = document.getElementById(tabId);
    if (activePage) {
      activePage.style.display = 'block';
    }

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update Mobile Bottom Nav active icons
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (tabId === 'tab-dashboard' || tabId === 'tab-nearme') {
      setTimeout(() => {
        if (!leafletSideMap) initLeafletGoogleMaps();
        if (leafletSideMap) leafletSideMap.invalidateSize();
        renderNearMeSection();
      }, 60);
    } else if (tabId === 'tab-routes') {
      setTimeout(() => {
        if (state.routeMode === 'circuits') {
          if (!leafletRouteMap) initLeafletGoogleMaps();
          if (leafletRouteMap) leafletRouteMap.invalidateSize(true);
          if (window.selectAndDrawRoute) window.selectAndDrawRoute(state.activeRouteIndex || 0);
        } else {
          if (!leafletPreplanMap) initPreplanMap();
          if (leafletPreplanMap) {
            leafletPreplanMap.invalidateSize(true);
            drawPreplanRouteOnMap();
          }
          if (!state.preplan.stops || state.preplan.stops.length === 0) {
            window.generateAutoRouteFromCurrentLocation(false);
          }
        }
      }, 80);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  function setupEventListeners() {

    // Navbar Tab Switching
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = btn.getAttribute('data-tab');
        window.switchTab(targetTab);
      });
    });

    // City Preset Selector
    const cityPresetSelect = document.getElementById('select-city-preset');
    if (cityPresetSelect) {
      cityPresetSelect.addEventListener('change', e => {
        const val = e.target.value;
        if (val && DISTRICT_CENTROIDS[val]) {
          const c = DISTRICT_CENTROIDS[val];
          setUserLocation(c.lat, c.lon, 50, `${val} City Center`, false);
        }
      });
    }

    // Near Me GPS Button
    const gpsBtn = document.getElementById('btn-nearme-gps');
    if (gpsBtn) {
      gpsBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
          alert('Geolocation is not supported by your browser.');
          return;
        }
        gpsBtn.textContent = '⏳ Locating...';
        navigator.geolocation.getCurrentPosition(
          pos => {
            const lat = pos.coords.latitude;
            const lon = pos.coords.longitude;
            const accuracy = Math.round(pos.coords.accuracy || 15);
            setUserLocation(lat, lon, accuracy, 'Live Device Location', true);
            gpsBtn.textContent = '📍 Location Found!';
            setTimeout(() => { gpsBtn.textContent = '📍 Use My Location'; }, 2500);
          },
          err => {
            alert('Could not retrieve your live location. Please select a city center from the dropdown.');
            gpsBtn.textContent = '📍 Use My Location';
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      });
    }

    // Distance Range Chips (Near Me)
    document.querySelectorAll('.radius-chip').forEach(btn => {
      btn.addEventListener('click', e => {
        document.querySelectorAll('.radius-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const min = parseFloat(btn.dataset.min || '0');
        const max = parseFloat(btn.dataset.max || '999999');
        state.nearDistanceRange = { min, max };
    state.nearmeDisplayLimit = 50;
        renderNearMeSection();
      });
    });

    // Route Stops Selector (up to 20 schools)
    const routeStopsSelect = document.getElementById('route-stops-count-select');
    if (routeStopsSelect) {
      routeStopsSelect.addEventListener('change', e => {
        state.routeMaxStops = parseInt(e.target.value, 10) || 20;
        renderRoutesSection();
      });
    }

    // Distance Dropdown for Table
    const distTableSelect = document.getElementById('filter-distance');
    if (distTableSelect) {
      distTableSelect.addEventListener('change', e => {
        state.filters.distanceRange = e.target.value;
        state.pagination.page = 1;
        applyFilters();
      });
    }

    // Sort by Distance on Table Header
    const thHeaders = document.querySelectorAll('.school-table th');
    thHeaders.forEach(th => {
      if (th.textContent.includes('Distance')) {
        th.addEventListener('click', () => {
          if (state.sortColumn === 'distKm') {
            state.sortAsc = !state.sortAsc;
          } else {
            state.sortColumn = 'distKm';
            state.sortAsc = true;
          }
          applyFilters();
        });
      }
    });

    // Modal Close Button handlers
    const modalCloseBtn = document.getElementById('modal-close-btn');
    if (modalCloseBtn) {
      modalCloseBtn.addEventListener('click', closeSchoolModal);
    }

    const modalOverlay = document.getElementById('school-modal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', e => {
        if (e.target === modalOverlay) closeSchoolModal();
      });
    }

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeSchoolModal();
    });

    // Copy UDISE button in modal
    const copyUdiseBtn = document.getElementById('modal-btn-copy-udise');
    if (copyUdiseBtn) {
      copyUdiseBtn.addEventListener('click', () => {
        const code = document.getElementById('modal-udise-code').textContent;
        if (code && code !== '—') {
          navigator.clipboard.writeText(code).then(() => {
            copyUdiseBtn.textContent = 'Copied!';
            setTimeout(() => { copyUdiseBtn.textContent = 'Copy'; }, 2000);
          });
        }
      });
    }

    // Near Me Live Search Input
    const nearmeSearchInput = document.getElementById('nearme-search-input');
    const nearmeClearBtn = document.getElementById('nearme-search-clear');
    if (nearmeSearchInput) {
      nearmeSearchInput.addEventListener('input', e => {
        state.searchQuery = e.target.value;
        if (nearmeClearBtn) nearmeClearBtn.style.display = e.target.value ? 'block' : 'none';
        renderNearMeSection();
      });
    }
    if (nearmeClearBtn) {
      nearmeClearBtn.addEventListener('click', () => {
        if (nearmeSearchInput) nearmeSearchInput.value = '';
        state.searchQuery = '';
        nearmeClearBtn.style.display = 'none';
        renderNearMeSection();
      });
    }

    // Hero Search Bar Inputs
    const heroInput = document.getElementById('hero-search-input');
    const heroBtn = document.getElementById('hero-search-btn');
    if (heroBtn && heroInput) {
      heroBtn.addEventListener('click', () => handleSearch(heroInput.value));
      heroInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') handleSearch(heroInput.value);
      });
    }

    // Table Filters
    ['district', 'block', 'management', 'category', 'type', 'locale'].forEach(filterKey => {
      const el = document.getElementById(`filter-${filterKey}`);
      if (el) {
        el.addEventListener('change', e => {
          state.filters[filterKey] = e.target.value;
          state.pagination.page = 1;
          if (filterKey === 'district') {
            populateBlockDropdown();
          }
          applyFilters();
        });
      }
    });

    // Reset Filters Button
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        state.filters = {
          district: 'ALL',
          block: 'ALL',
          management: 'ALL',
          category: 'ALL',
          type: 'ALL',
          locale: 'ALL',
          distanceRange: 'ALL'
        };
        state.searchQuery = '';
        state.pagination.page = 1;
        ['district', 'block', 'management', 'category', 'type', 'locale', 'distance'].forEach(k => {
          const el = document.getElementById(`filter-${k}`);
          if (el) el.value = 'ALL';
        });
        const tSearch = document.getElementById('table-search-input');
        if (tSearch) tSearch.value = '';
        populateBlockDropdown();
        applyFilters();
      });
    }

    // Table Search Input
    const tableInput = document.getElementById('table-search-input');
    if (tableInput) {
      tableInput.addEventListener('input', e => {
        state.searchQuery = e.target.value;
        state.pagination.page = 1;
        applyFilters();
      });
    }

    // Export CSV Button
    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) {
      exportBtn.addEventListener('click', exportFilteredCsv);
    }
  }

  window.handleSearch = function(q) {
    state.searchQuery = (q || '').trim();
    state.pagination.page = 1;

    // Sync input values across search boxes
    const heroInput = document.getElementById('hero-search-input');
    const tableInput = document.getElementById('table-search-input');
    if (heroInput) heroInput.value = state.searchQuery;
    if (tableInput) tableInput.value = state.searchQuery;

    window.syncNearmeFilter('search', state.searchQuery);
    applyFilters();
    renderNearMeSection();
  };

  function exportFilteredCsv() {
    const schools = state.filteredSchools;
    if (schools.length === 0) {
      alert('No schools to export matching current filters.');
      return;
    }
    const headers = ['udise', 'name', 'dist', 'block', 'cluster', 'village', 'pin', 'lat', 'lon', 'mgmt', 'cat', 'type', 'locale', 'students', 'classes', 'contact', 'mobile', 'distKm'];
    const csvRows = [headers.join(',')];

    schools.forEach(s => {
      const row = headers.map(h => {
        let val = s[h] !== undefined && s[h] !== null ? String(s[h]) : '';
        val = val.replace(/"/g, '""');
        return `"${val}"`;
      });
      csvRows.push(row.join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vidarbha_schools_filtered_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  
  // ==========================================================================
  // ADVANCE TOUR PRE-PLANNING & OFFICER AUTHENTICATION ENGINE
  // ==========================================================================
  let leafletPreplanMap = null;
  let preplanMarkers = [];
  let preplanPolyline = null;

  // Initialize Preplan State
  state.routeMode = 'autoroute'; // 'preplan' or 'circuits'
  state.preplan = {
    title: 'Vidarbha Field Inspection Tour',
    district: 'NAGPUR',
    filter: 'ALL',
    selectedUdises: [],
    stops: []
  };

  // User Auth Initial Load
  state.currentUser = localStorage.getItem('vidarbha_current_user') || 'officer_nagpur';

  // 1. Route Mode Switcher (Pre-Plan vs Circuits)
  
  // ==========================================================================
  // PREPLAN & CUSTOM ROUTE FUNCTIONS (MAP, TABLE, CANDIDATES, OPTIMIZER)
  // ==========================================================================
  function initPreplanMap() {
    const container = document.getElementById('preplan-interactive-map');
    if (!container || leafletPreplanMap) return;

    const defaultCenter = state.userLocation ? [state.userLocation.lat, state.userLocation.lon] : [21.1458, 79.0882];
    leafletPreplanMap = L.map('preplan-interactive-map', {
      center: defaultCenter,
      zoom: 11,
      zoomControl: true
    });

    const preplanLayers = createGoogleTileLayers();
    preplanLayers.roadmap.addTo(leafletPreplanMap);

    L.control.layers({
      '🗺️ Google Maps Roadmap': preplanLayers.roadmap,
      '🛰️ Satellite Hybrid': preplanLayers.hybrid,
      '⛰️ Terrain': preplanLayers.terrain,
      '🧭 Clean Street Map': preplanLayers.carto
    }, null, { position: 'topright' }).addTo(leafletPreplanMap);

    L.control.scale({ imperial: false, metric: true }).addTo(leafletPreplanMap);

    drawPreplanRouteOnMap();
  }

  function drawPreplanRouteOnMap() {
    if (!leafletPreplanMap) return;

    preplanMarkers.forEach(m => {
      if (m && typeof m.remove === "function") m.remove();
      else if (leafletPreplanMap && typeof leafletPreplanMap.removeLayer === "function") leafletPreplanMap.removeLayer(m);
    });
    preplanMarkers = [];
    if (preplanPolyline) {
      if (typeof preplanPolyline.remove === "function") preplanPolyline.remove();
      else if (leafletPreplanMap && typeof leafletPreplanMap.removeLayer === "function") leafletPreplanMap.removeLayer(preplanPolyline);
      preplanPolyline = null;
    }

    const stops = state.preplan.stops || [];
    if (stops.length === 0) {
      if (state.userLocation && state.userLocation.lat) {
        const uMarker = L.marker([state.userLocation.lat, state.userLocation.lon])
          .addTo(leafletPreplanMap)
          .bindPopup(`<b>📍 Your Location</b><br>${state.userLocation.name || 'Live GPS'}`)
          .openPopup();
        preplanMarkers.push(uMarker);
        leafletPreplanMap.setView([state.userLocation.lat, state.userLocation.lon], 11);
      }
      return;
    }

    const latlngs = [];
    const originLat = state.preplan.originLat || (state.userLocation ? state.userLocation.lat : 21.1458);
    const originLon = state.preplan.originLon || (state.userLocation ? state.userLocation.lon : 79.0882);
    const originName = state.preplan.originName || (state.userLocation ? state.userLocation.name : 'Start Location');

    const startIcon = L.divIcon({
      className: 'custom-start-marker',
      html: `<div style="background:#16a34a;color:#fff;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:14px;box-shadow:0 3px 8px rgba(0,0,0,0.4);border:2px solid #fff;">🏁</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const startMarker = L.marker([originLat, originLon], { icon: startIcon })
      .addTo(leafletPreplanMap)
      .bindPopup(`<b>🏁 Starting Point (Start Location)</b><br>${escapeHtml(originName)}`);
    preplanMarkers.push(startMarker);
    latlngs.push([originLat, originLon]);

    stops.forEach((st, idx) => {
      const s = st.school;
      if (!s || !s.lat || !s.lon) return;

      latlngs.push([s.lat, s.lon]);

      const isVisited = st.status === 'VISITED';
      const markerColor = isVisited ? '#16a34a' : '#2563eb';

      const stopIcon = L.divIcon({
        className: 'custom-stop-marker',
        html: `<div style="background:${markerColor};color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;box-shadow:0 2px 6px rgba(0,0,0,0.35);border:2px solid #fff;">${idx + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const gmapsUrl = getGoogleMapsUrl(s.lat, s.lon, s.name);
      const popupHtml = `
        <div style="font-family:sans-serif;min-width:180px;">
          <div style="font-weight:800;font-size:13px;color:#0f172a;margin-bottom:4px;">#${idx + 1}. ${escapeHtml(s.name)}</div>
          <div style="font-size:11px;color:#475569;margin-bottom:4px;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.dist)}</div>
          <div style="font-size:11px;margin-bottom:6px;">👥 <b>${s.students || 0}</b> Students | 🏫 ${escapeHtml(s.mgmt || '')}</div>
          <div style="font-size:11px;color:#2563eb;margin-bottom:8px;">🚗 Leg: ${st.legDistKm || 0} KM (Total: ${st.cumulativeKm || 0} KM)</div>
          <a href="${gmapsUrl}" target="_blank" style="background:#16a34a;color:#fff;padding:4px 8px;border-radius:4px;text-decoration:none;font-size:11px;font-weight:700;display:inline-block;">Navigate Google Maps</a>
        </div>
      `;

      const marker = L.marker([s.lat, s.lon], { icon: stopIcon })
        .addTo(leafletPreplanMap)
        .bindPopup(popupHtml)
        .bindTooltip(`#${idx + 1}: ${escapeHtml(s.name)} (${st.legDistKm || 0} KM)`);
      preplanMarkers.push(marker);
    });

    if (latlngs.length > 1) {
      preplanPolyline = L.polyline(latlngs, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.85,
        dashArray: '8, 8'
      }).addTo(leafletPreplanMap);

      leafletPreplanMap.invalidateSize(true);
      if (preplanPolyline && typeof preplanPolyline.getBounds === 'function') {
        try {
          leafletPreplanMap.fitBounds(preplanPolyline.getBounds().pad(0.12));
        } catch (e) {
          console.warn("fitBounds error:", e);
        }
      }
    }
  }

  function renderPreplanStopsTable() {
    const tbody = document.getElementById('preplan-stops-tbody');
    const countEl = document.getElementById('preplan-stops-count');
    const totalKmEl = document.getElementById('preplan-total-km');
    const estTimeEl = document.getElementById('preplan-est-time');
    const gmapsBtn = document.getElementById('btn-open-preplan-gmaps');

    const stops = state.preplan.stops || [];

    if (countEl) countEl.textContent = stops.length;
    if (totalKmEl) totalKmEl.textContent = `${state.preplan.totalKm || 0} KM`;
    if (estTimeEl) estTimeEl.textContent = `~${state.preplan.estMins || 0} min (${Math.round((state.preplan.estMins || 0)/60*10)/10} hrs)`;
    if (gmapsBtn && state.preplan.gmapsUrl) gmapsBtn.href = state.preplan.gmapsUrl;

    if (!tbody) return;

    if (stops.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:36px;color:#64748b;">
            <div style="font-size:32px;margin-bottom:8px;">🚗</div>
            <strong>No stops in route yet</strong>
            <p style="font-size:12px;margin-top:4px;">Click "Generate Route from My Location" above or select schools from the advance pre-planning list.</p>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = stops.map((st, i) => {
      const s = st.school;
      const gmapsUrl = getGoogleMapsUrl(s.lat, s.lon, s.name);
      const isVisited = st.status === 'VISITED';
      const isSkipped = st.status === 'SKIPPED';

      return `
        <tr style="${isVisited ? 'background:#f0fdf4;' : isSkipped ? 'background:#fef2f2;' : ''}">
          <td style="font-weight:800;color:#2563eb;text-align:center;">#${i + 1}</td>
          <td>
            <div style="font-weight:700;color:#0f172a;font-size:13px;">${escapeHtml(s.name)}</div>
            <div style="font-size:11px;color:#64748b;">📍 ${escapeHtml(s.village || s.block)}, ${escapeHtml(s.block)} (PIN: ${s.pin || ''})</div>
          </td>
          <td><code class="udise-code">${escapeHtml(s.udise)}</code></td>
          <td><span class="students-badge" style="font-size:11px;">👥 ${s.students || 0}</span></td>
          <td style="font-size:12px;font-weight:700;color:#0f172a;">${st.legDistKm || 0} KM</td>
          <td style="font-size:12px;font-weight:700;color:#1e40af;">${st.cumulativeKm || 0} KM</td>
          <td>
            <div style="display:flex;gap:4px;align-items:center;">
              <select style="padding:4px 6px;border-radius:4px;border:1px solid #cbd5e1;font-size:11px;font-weight:700;" onchange="window.updatePreplanStopStatus(${i}, this.value)">
                <option value="PLANNED" ${!isVisited && !isSkipped ? 'selected' : ''}>⏳ Planned</option>
                <option value="VISITED" ${isVisited ? 'selected' : ''}>✅ Visited</option>
                <option value="SKIPPED" ${isSkipped ? 'selected' : ''}>❌ Skipped</option>
              </select>
              <a href="${gmapsUrl}" target="_blank" style="background:#16a34a;color:#fff;padding:4px 8px;border-radius:4px;text-decoration:none;font-size:11px;font-weight:700;">🗺️</a>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  window.updatePreplanStopStatus = function(index, newStatus) {
    if (state.preplan.stops && state.preplan.stops[index]) {
      state.preplan.stops[index].status = newStatus;
      if (!leafletPreplanMap) initPreplanMap();
      if (leafletPreplanMap) leafletPreplanMap.invalidateSize(true);
      renderPreplanStopsTable();
      drawPreplanRouteOnMap();
      renderOfficerDrawer();
      saveCurrentOfficerData(false);
    }
  };

  function getPreplanOriginInfo() {
    let originLat = 21.1458;
    let originLon = 79.0882;
    let originName = 'Nagpur Center';

    const startOrigin = state.preplan.startOrigin || 'GPS';

    if (startOrigin === 'GPS') {
      if (state.userLocation && state.userLocation.lat && state.userLocation.lon) {
        originLat = state.userLocation.lat;
        originLon = state.userLocation.lon;
        originName = state.userLocation.name || 'Your Live GPS Location';
      }
    } else if (DISTRICT_CENTROIDS[startOrigin]) {
      originLat = DISTRICT_CENTROIDS[startOrigin].lat;
      originLon = DISTRICT_CENTROIDS[startOrigin].lon;
      originName = (DISTRICT_CENTROIDS[startOrigin].name || startOrigin) + ' Center';
    }

    return { originLat, originLon, originName, startOrigin };
  }

  window.onPreplanOriginChange = function(val) {
    state.preplan.startOrigin = val;
    const oSel = document.getElementById('route-origin-select');
    if (oSel) oSel.value = val;
    state.routeOrigin = val;

    renderPreplanCandidates();
    recalculatePreplanRoute();
    drawPreplanRouteOnMap();
    saveCurrentOfficerData(false);
  };

  window.onPreplanDistanceChange = function(val) {
    state.preplan.maxKm = val;
    const dSel = document.getElementById('route-distance-select');
    if (dSel) dSel.value = val;
    if (state.routeFilters) state.routeFilters.distance = val;

    renderPreplanCandidates();
    saveCurrentOfficerData(false);
  };

  window.onPreplanDistrictChange = function(val) {
    state.preplan.district = val;
    renderPreplanCandidates();
    saveCurrentOfficerData(false);
  };

  window.onPreplanFilterChange = function(val) {
    state.preplan.filter = val;
    renderPreplanCandidates();
    saveCurrentOfficerData(false);
  };

  function renderPreplanCandidates() {
    const container = document.getElementById('preplan-candidates-container');
    const countBadge = document.getElementById('preplan-count-badge');
    if (!container) return;

    const { originLat, originLon, originName } = getPreplanOriginInfo();
    const dist = state.preplan.district || 'ALL';
    const filter = state.preplan.filter || 'ALL';
    const maxKmVal = state.preplan.maxKm || 'ALL';

    // Calculate distance of every school from THIS start origin!
    let pool = (state.schools || []).filter(s => s && s.lat && s.lon).map(s => {
      const d = calculateDistanceKm(originLat, originLon, s.lat, s.lon);
      return Object.assign({}, s, { preplanDistKm: d });
    });

    // Filter by district if selected
    if (dist && dist !== 'ALL') {
      pool = pool.filter(s => s.dist === dist);
    }

    // Filter by KM Distance Range
    if (maxKmVal && maxKmVal !== 'ALL') {
      const parts = maxKmVal.split('-');
      const minD = parseFloat(parts[0]) || 0;
      const maxD = parseFloat(parts[1]) || 999999;
      pool = pool.filter(s => s.preplanDistKm >= minD && s.preplanDistKm <= maxD);
    }

    // Filter by student strength / priority
    if (filter === 'MEGA') {
      pool = pool.filter(s => (s.students || 0) >= 1000);
    } else if (filter === 'HIGH') {
      pool = pool.filter(s => (s.students || 0) >= 651 && (s.students || 0) <= 1000);
    } else if (filter === 'ORANGE') {
      pool = pool.filter(s => (s.students || 0) >= 351 && (s.students || 0) <= 650);
    } else if (filter === 'ZP') {
      pool = pool.filter(s => (s.mgmt || '').includes('Zilla Parishad') || (s.mgmt || '').includes('Government'));
    }

    // Sort by proximity to start point!
    pool.sort((a, b) => a.preplanDistKm - b.preplanDistKm);

    const selectedSet = new Set(state.preplan.selectedUdises || []);
    if (countBadge) countBadge.textContent = `${selectedSet.size} Schools Selected`;

    if (pool.length === 0) {
      container.innerHTML = `
        <div style="padding:24px 16px;text-align:center;color:#64748b;background:#f8fafc;border-radius:10px;border:1px dashed #cbd5e1;">
          <div style="font-size:24px;margin-bottom:6px;">📍</div>
          <strong style="color:#0f172a;font-size:14px;">No schools found in this specific KM range (${maxKmVal} KM)</strong>
          <p style="margin:4px 0 0 0;font-size:12px;">Try setting Distance to "Within 50 KM", "Within 100 KM", or "All Distances", or change Target District.</p>
        </div>
      `;
      return;
    }

    const topPool = pool.slice(0, 150);

    container.innerHTML = topPool.map(s => {
      const isSelected = selectedSet.has(s.udise);
      const distBadge = `<span style="font-size:11px;font-weight:800;color:#2563eb;background:#eff6ff;padding:2px 7px;border-radius:6px;border:1px solid #bfdbfe;white-space:nowrap;">📍 ${s.preplanDistKm.toFixed(1)} KM</span>`;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#ffffff;border:1.5px solid ${isSelected ? '#3b82f6' : '#e2e8f0'};border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.03);gap:10px;">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;flex:1;min-width:0;">
            <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="window.togglePreplanSchool('${escapeHtml(s.udise)}', this.checked)" style="width:18px;height:18px;margin-top:2px;cursor:pointer;">
            <div style="min-width:0;">
              <div style="font-size:13px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${escapeHtml(s.name)}
              </div>
              <div style="font-size:11px;color:#64748b;margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>🏛️ ${escapeHtml(s.dist)}</span>
                <span>•</span>
                <span>📌 ${escapeHtml(s.block || '')}</span>
                <span>•</span>
                ${distBadge}
              </div>
            </div>
          </label>
          <div style="text-align:right;flex-shrink:0;">
            <span style="font-size:11px;font-weight:800;color:#1e3a8a;background:#dbeafe;padding:3px 8px;border-radius:6px;">
              👥 ${Number(s.students) || 0}
            </span>
          </div>
        </div>
      `;
    }).join('');
  }

  function buildMultiStopGoogleMapsUrl(originLat, originLon, schools) {
    if (!schools || schools.length === 0) {
      return `https://www.google.com/maps/dir/${originLat},${originLon}`;
    }
    const coords = [`${originLat},${originLon}`];
    schools.slice(0, 10).forEach(s => {
      if (s && s.lat && s.lon) coords.push(`${s.lat},${s.lon}`);
    });
    return `https://www.google.com/maps/dir/${coords.join('/')}`;
  }

  function recalculatePreplanRoute() {
    const selectedSchools = state.schools.filter(s => (state.preplan.selectedUdises || []).includes(s.udise));
    const { originLat, originLon, originName } = getPreplanOriginInfo();

    state.preplan.originLat = originLat;
    state.preplan.originLon = originLon;
    state.preplan.originName = originName;

    const ordered = optimizeNearestNeighborRoute(originLat, originLon, selectedSchools, selectedSchools.length);

    let cumKm = 0;
    state.preplan.stops = ordered.map((st, i) => {
      cumKm += st.legDistKm;
      const existing = (state.preplan.stops || []).find(x => x.school && x.school.udise === st.school.udise);
      return {
        step: i + 1,
        school: st.school,
        legDistKm: st.legDistKm,
        cumulativeKm: Math.round(cumKm * 10) / 10,
        status: existing ? existing.status : 'PLANNED',
        notes: existing ? existing.notes : ''
      };
    });

    state.preplan.totalKm = Math.round(cumKm * 10) / 10;
    state.preplan.estMins = Math.round(cumKm * 2.1 + (state.preplan.stops.length * 8));
    state.preplan.gmapsUrl = buildMultiStopGoogleMapsUrl(originLat, originLon, state.preplan.stops.map(st => st.school));

    // Update KPI UI
    const stopsCountEl = document.getElementById('preplan-stops-count');
    const totalKmEl = document.getElementById('preplan-total-km');
    const estTimeEl = document.getElementById('preplan-est-time');
    const gmapsBtn = document.getElementById('btn-preplan-open-gmaps');

    if (stopsCountEl) stopsCountEl.textContent = `${state.preplan.stops.length}`;
    if (totalKmEl) totalKmEl.textContent = `${state.preplan.totalKm} KM`;
    if (estTimeEl) estTimeEl.textContent = `~${state.preplan.estMins} min (${Math.round(state.preplan.estMins/60*10)/10} hrs)`;
    if (gmapsBtn) gmapsBtn.href = state.preplan.gmapsUrl;

    renderPreplanStopsTable();
    drawPreplanRouteOnMap();
    renderOfficerDrawer();
  }

  window.togglePreplanSchool = function(udise, isChecked) {
    if (!state.preplan.selectedUdises) state.preplan.selectedUdises = [];
    if (isChecked) {
      if (!state.preplan.selectedUdises.includes(udise)) {
        state.preplan.selectedUdises.push(udise);
      }
    } else {
      state.preplan.selectedUdises = state.preplan.selectedUdises.filter(u => u !== udise);
    }
    recalculatePreplanRoute();
    renderPreplanCandidates();
    saveCurrentOfficerData(false);
    if (!leafletPreplanMap) initPreplanMap();
    if (leafletPreplanMap) {
      leafletPreplanMap.invalidateSize(true);
      drawPreplanRouteOnMap();
    }
  };

  window.autoSelectTopSchools = function(count) {
    const { originLat, originLon } = getPreplanOriginInfo();
    const dist = state.preplan.district || 'ALL';
    const filter = state.preplan.filter || 'ALL';
    const maxKmVal = state.preplan.maxKm || 'ALL';

    let pool = (state.schools || []).filter(s => s && s.lat && s.lon).map(s => {
      const d = calculateDistanceKm(originLat, originLon, s.lat, s.lon);
      return Object.assign({}, s, { preplanDistKm: d });
    });

    if (dist && dist !== 'ALL') {
      pool = pool.filter(s => s.dist === dist);
    }

    if (maxKmVal && maxKmVal !== 'ALL') {
      const parts = maxKmVal.split('-');
      const minD = parseFloat(parts[0]) || 0;
      const maxD = parseFloat(parts[1]) || 999999;
      pool = pool.filter(s => s.preplanDistKm >= minD && s.preplanDistKm <= maxD);
    }

    if (filter === 'MEGA') {
      pool = pool.filter(s => (s.students || 0) >= 1000);
    } else if (filter === 'HIGH') {
      pool = pool.filter(s => (s.students || 0) >= 651 && (s.students || 0) <= 1000);
    } else if (filter === 'ORANGE') {
      pool = pool.filter(s => (s.students || 0) >= 351 && (s.students || 0) <= 650);
    } else if (filter === 'ZP') {
      pool = pool.filter(s => (s.mgmt || '').includes('Zilla Parishad') || (s.mgmt || '').includes('Government'));
    }

    // Sort by proximity first!
    pool.sort((a, b) => a.preplanDistKm - b.preplanDistKm);

    const numToPick = (count === 'ALL' || count >= 99999) ? pool.length : Math.min(pool.length, parseInt(count, 10));
    state.preplan.selectedUdises = pool.slice(0, numToPick).map(s => s.udise);
    recalculatePreplanRoute();
    renderPreplanCandidates();
    saveCurrentOfficerData(false);

    const mapEl = document.getElementById('preplan-interactive-map');
    if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  window.clearPreplanSelection = function() {
    state.preplan.selectedUdises = [];
    state.preplan.stops = [];
    recalculatePreplanRoute();
    renderPreplanCandidates();
    saveCurrentOfficerData(false);
    if (!leafletPreplanMap) initPreplanMap();
    if (leafletPreplanMap) {
      leafletPreplanMap.invalidateSize(true);
      drawPreplanRouteOnMap();
    }
  };

  window.switchRouteMode = function(mode) {
    state.routeMode = mode; // 'autoroute' | 'custom' | 'circuits'

    const btnAuto = document.getElementById('btn-mode-autoroute');
    const btnCustom = document.getElementById('btn-mode-custom');
    const btnCircuits = document.getElementById('btn-mode-circuits');

    const viewPreplan = document.getElementById('view-mode-preplan');
    const viewCircuits = document.getElementById('view-mode-circuits');

    const contAuto = document.getElementById('container-mode-autoroute');
    const contCustomControls = document.getElementById('container-mode-custom-controls');
    const candCol = document.getElementById('preplan-candidates-col');
    const splitGrid = document.getElementById('preplan-split-grid');

    if (btnAuto) btnAuto.classList.toggle('active', mode === 'autoroute');
    if (btnCustom) btnCustom.classList.toggle('active', mode === 'custom');
    if (btnCircuits) btnCircuits.classList.toggle('active', mode === 'circuits');

    if (mode === 'circuits') {
      if (viewPreplan) viewPreplan.style.display = 'none';
      if (viewCircuits) viewCircuits.style.display = 'block';
      setTimeout(() => {
        if (!leafletRouteMap) initLeafletGoogleMaps();
        if (leafletRouteMap) leafletRouteMap.invalidateSize(true);
        if (window.selectAndDrawRoute) window.selectAndDrawRoute(state.activeRouteIndex || 0);
      }, 80);
    } else {
      if (viewPreplan) viewPreplan.style.display = 'block';
      if (viewCircuits) viewCircuits.style.display = 'none';

      if (mode === 'autoroute') {
        if (contAuto) contAuto.style.display = 'block';
        if (contCustomControls) contCustomControls.style.display = 'none';
        if (candCol) candCol.style.display = 'none';
        if (splitGrid) {
          splitGrid.style.gridTemplateColumns = '1fr';
        }
        if (!state.preplan.stops || state.preplan.stops.length === 0) {
          window.generateAutoRouteFromCurrentLocation(false);
        }
      } else { // 'custom'
        if (contAuto) contAuto.style.display = 'none';
        if (contCustomControls) contCustomControls.style.display = 'block';
        if (candCol) candCol.style.display = 'block';
        if (splitGrid && window.innerWidth > 900) {
          splitGrid.style.gridTemplateColumns = '1fr 1fr';
        }
        renderPreplanCandidates();
      }

      setTimeout(() => {
        if (!leafletPreplanMap) initPreplanMap();
        if (leafletPreplanMap) {
          leafletPreplanMap.invalidateSize(true);
          drawPreplanRouteOnMap();
        }
      }, 80);
    }
  };

  window.openOfficerDrawer = function() {
    renderOfficerDrawer();
    const overlay = document.getElementById('officer-drawer-overlay');
    const drawer = document.getElementById('officer-drawer');
    if (overlay) overlay.classList.add('open');
    if (drawer) drawer.classList.add('open');
  };

  window.closeOfficerDrawer = function() {
    const overlay = document.getElementById('officer-drawer-overlay');
    const drawer = document.getElementById('officer-drawer');
    if (overlay) overlay.classList.remove('open');
    if (drawer) drawer.classList.remove('open');
  };

  function updateHeaderAuthUI() {
    const container = document.getElementById('header-auth-container');
    if (!container) return;

    if (!state.currentUser || state.currentUser === 'guest') {
      container.innerHTML = `
        <button id="btn-header-login" class="btn-header-auth" onclick="window.openLoginModal()">
          🔑 Officer Login
        </button>
      `;
    } else {
      let visited = 0;
      let planned = 0;
      (state.preplan.stops || []).forEach(st => {
        if (st.status === 'VISITED') visited++;
        else planned++;
      });

      container.innerHTML = `
        <div class="user-profile-pill" onclick="window.openOfficerDrawer()" title="Click to view your field tour progress">
          <span class="user-pill-avatar">👤</span>
          <div class="user-pill-info">
            <span class="user-pill-name">${escapeHtml(state.currentUser)}</span>
            <span class="user-pill-stats">✅ ${visited} Visited • ⏳ ${planned} Planned</span>
          </div>
        </div>
      `;
    }
  }

  function renderOfficerDrawer() {
    const nameEl = document.getElementById('drawer-officer-name');
    const planTitleEl = document.getElementById('drawer-plan-title');
    const statTotal = document.getElementById('drawer-stat-total');
    const statVisited = document.getElementById('drawer-stat-visited');
    const statPlanned = document.getElementById('drawer-stat-planned');
    const gmapsTourBtn = document.getElementById('drawer-btn-gmaps-tour');
    const listContainer = document.getElementById('drawer-schools-list');

    if (nameEl) nameEl.textContent = `Officer: ${state.currentUser || 'Field Inspector'}`;
    if (planTitleEl) planTitleEl.textContent = `${state.preplan.district} Tour (${state.preplan.stops.length} Stops)`;

    let visited = 0;
    let planned = 0;
    let skipped = 0;

    const stops = state.preplan.stops || [];
    stops.forEach(st => {
      if (st.status === 'VISITED') visited++;
      else if (st.status === 'SKIPPED') skipped++;
      else planned++;
    });

    if (statTotal) statTotal.textContent = stops.length;
    if (statVisited) statVisited.textContent = visited;
    if (statPlanned) statPlanned.textContent = planned;
    if (gmapsTourBtn) gmapsTourBtn.href = state.preplan.gmapsUrl || '#';

    if (!listContainer) return;

    if (stops.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align:center;padding:30px;color:#64748b;background:#ffffff;border-radius:10px;border:1px solid #e2e8f0;">
          <div style="font-size:24px;margin-bottom:6px;">📋</div>
          <b>No active tour planned yet.</b><br>
          <span style="font-size:12px;">Go to "Pre-Plan Tour & Routes" to select important schools for inspection.</span>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = stops.map((st, i) => {
      const s = st.school;
      const std = Number(s.students) || 0;
      const traffic = getSchoolTrafficColorInfo(std);
      const navUrl = `https://www.google.com/maps/dir/${s.lat},${s.lon}`;

      return `
        <div class="drawer-school-item status-${st.status ? st.status.toLowerCase() : 'planned'}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <span style="font-size:10px;font-weight:800;color:#1a73e8;">STOP #${st.step}</span>
              <h5 style="margin:2px 0;font-size:13px;color:#0f172a;">${escapeHtml(s.name)}</h5>
              <div style="font-size:11px;color:#64748b;">📍 ${escapeHtml(s.village || s.block)} • 👥 ${std.toLocaleString()}</div>
            </div>
            <a href="${navUrl}" target="_blank" style="background:#16a34a;color:#fff;padding:4px 8px;border-radius:5px;font-size:10px;font-weight:700;text-decoration:none;">
              🚗 Navigate
            </a>
          </div>

          <div class="status-toggle-group">
            <button class="status-toggle-btn ${st.status === 'VISITED' ? 'active-visited' : ''}" onclick="window.setStopVisitStatus(${i}, 'VISITED')">
              ✅ Visited
            </button>
            <button class="status-toggle-btn ${st.status === 'PLANNED' ? 'active-planned' : ''}" onclick="window.setStopVisitStatus(${i}, 'PLANNED')">
              ⏳ To Visit
            </button>
            <button class="status-toggle-btn ${st.status === 'SKIPPED' ? 'active-skipped' : ''}" onclick="window.setStopVisitStatus(${i}, 'SKIPPED')">
              ❌ Skipped
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 8. DATA PERSISTENCE PER OFFICER USERNAME
  window.saveCurrentOfficerData = function(showToast) {
    if (!state.currentUser || state.currentUser === 'guest') return;

    const dataKey = 'vidarbha_officer_data_' + state.currentUser;
    const payload = {
      preplan: state.preplan,
      lastSaved: new Date().toISOString()
    };

    localStorage.setItem(dataKey, JSON.stringify(payload));

    const indicator = document.getElementById('drawer-saved-indicator');
    if (indicator) {
      indicator.style.display = 'inline';
      setTimeout(() => { indicator.style.display = 'none'; }, 2000);
    }

    updateHeaderAuthUI();

    if (showToast) {
      alert(`Tour Plan saved successfully under Officer account "${state.currentUser}"!`);
    }
  };

  function loadOfficerData(username) {
    if (!username || username === 'guest') return;

    const dataKey = 'vidarbha_officer_data_' + username;
    const raw = localStorage.getItem(dataKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.preplan) {
          state.preplan = parsed.preplan;
          const distSelect = document.getElementById('preplan-district-select');
          if (distSelect && state.preplan.district) distSelect.value = state.preplan.district;
          renderPreplanCandidates();
          recalculatePreplanRoute();
        }
      } catch(e) {
        console.error("Error loading officer data:", e);
      }
    } else {
      // New user: auto-populate Top 10 important schools in district as starter plan
      setTimeout(() => {
        window.autoSelectTopSchools(10);
      }, 300);
    }
  }

  // On initial boot, load user data
  setTimeout(() => {
    loadOfficerData(state.currentUser);
    updateHeaderAuthUI();
    renderPreplanCandidates();
    initPreplanMap();
  }, 400);


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }



  window.refreshDeviceGpsLocation = function() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    const lbl = document.getElementById('auto-route-start-label');
    if (lbl) lbl.textContent = "Detecting live GPS...";

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy || 15);
        setUserLocation(lat, lon, acc, 'Live Device GPS', true);
        if (lbl) lbl.textContent = `Live GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        window.generateAutoRouteFromCurrentLocation(true);
      },
      err => {
        console.warn("GPS error:", err);
        if (lbl) lbl.textContent = state.userLocation ? state.userLocation.name : 'Current Location';
        alert("⚠️ Could not get live GPS. Please check location permissions in your browser.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // ==========================================================================
  // 1-CLICK AUTOMATIC ROUTE PLAN FROM MY CURRENT LOCATION / SELECTED START
  // ==========================================================================

  window.onChangeTablePageSize = function(val) {
    state.pagination.pageSize = parseInt(val, 10) || 20;
    state.pagination.page = 1;
    renderTable();
  };

  window.generateAutoRouteFromCurrentLocation = function(silent = false) {
    try {
      // 1. Determine Origin (GPS or chosen District HQ)
      let originLat = 21.1458;
      let originLon = 79.0882;
      let originName = 'Nagpur (Division HQ)';

      const originSelect = document.getElementById('route-origin-select');
      const originVal = originSelect ? originSelect.value : (state.routeOrigin || 'GPS');

      if (originVal !== 'GPS' && DISTRICT_CENTROIDS && DISTRICT_CENTROIDS[originVal]) {
        originLat = DISTRICT_CENTROIDS[originVal].lat;
        originLon = DISTRICT_CENTROIDS[originVal].lon;
        originName = `${DISTRICT_CENTROIDS[originVal].name} City Center`;
      } else if (state.userLocation && state.userLocation.lat && state.userLocation.lon) {
        originLat = state.userLocation.lat;
        originLon = state.userLocation.lon;
        originName = state.userLocation.name || 'Your Live GPS Location';
      }

      // Update start label in card if element exists
      const startLbl = document.getElementById('auto-route-start-label');
      if (startLbl) startLbl.textContent = originName;

      // 2. Determine Max Stops
      const countSelect = document.getElementById('auto-route-count-select');
      const topCountSelect = document.getElementById('route-stops-count-select');
      let maxStops = 10;
      if (countSelect && countSelect.value) {
        maxStops = parseInt(countSelect.value, 10);
      } else if (topCountSelect && topCountSelect.value) {
        maxStops = parseInt(topCountSelect.value, 10);
      } else if (state.routeMaxStops) {
        maxStops = state.routeMaxStops;
      }

      // 3. Determine Filters
      const filterSelect = document.getElementById('auto-route-filter-select');
      const cardFilter = filterSelect ? filterSelect.value : 'IMPORTANT';

      const distSelect = document.getElementById('route-district-select');
      const chosenDist = distSelect ? distSelect.value : (state.routeFilters ? state.routeFilters.district : 'ALL');

      const mgmtSelect = document.getElementById('route-mgmt-select');
      const chosenMgmt = mgmtSelect ? mgmtSelect.value : (state.routeFilters ? state.routeFilters.mgmt : 'ALL');

      const catSelect = document.getElementById('route-cat-select');
      const chosenCat = catSelect ? catSelect.value : (state.routeFilters ? state.routeFilters.cat : 'ALL');

      const prioSelect = document.getElementById('route-priority-select');
      const chosenPrio = prioSelect ? prioSelect.value : (state.routeFilters ? state.routeFilters.priority : 'ALL');

      // 4. Calculate Distance of all schools from current origin
      let pool = (state.schools || []).filter(s => s && s.lat && s.lon).map(s => {
        const d = calculateDistanceKm(originLat, originLon, s.lat, s.lon);
        return Object.assign({}, s, { distKm: d });
      });

      // Filter by KM Distance Range if selected
      const cardDistEl = document.getElementById('auto-route-distance-select');
      const routeDistEl = document.getElementById('route-distance-select');
      const chosenKm = (cardDistEl && cardDistEl.value !== 'ALL') 
        ? cardDistEl.value 
        : (routeDistEl && routeDistEl.value !== 'ALL' ? routeDistEl.value : (state.routeFilters ? state.routeFilters.distance : 'ALL'));

      // Check if user is located outside Vidarbha (e.g. Nashik, Pune, Mumbai)
      let outsideVidarbha = false;
      const minAvailableDist = pool.reduce((min, s) => s.distKm < min ? s.distKm : min, 999999);
      if (minAvailableDist > 200) {
        outsideVidarbha = true;
      }

      if (chosenKm && chosenKm !== 'ALL') {
        const parts = chosenKm.split('-');
        const minD = parseFloat(parts[0]) || 0;
        const maxD = parseFloat(parts[1]) || 999999;
        const filtered = pool.filter(s => s.distKm >= minD && s.distKm <= maxD);
        if (filtered.length > 0) {
          pool = filtered;
        } else if (outsideVidarbha) {
          // Graceful fallback for devices outside Vidarbha: route to closest Vidarbha schools
          console.log("Device outside Vidarbha; using closest available Vidarbha schools");
        } else {
          pool = filtered;
        }
      }

      // Filter by district if selected
      if (chosenDist && chosenDist !== 'ALL') {
        pool = pool.filter(s => s.dist === chosenDist);
      }

      // Filter by management if selected
      if (chosenMgmt === 'ZP_GOVT') {
        pool = pool.filter(s => (s.mgmt || '').includes('Zilla Parishad') || (s.mgmt || '').includes('Government'));
      } else if (chosenMgmt === 'AIDED') {
        pool = pool.filter(s => (s.mgmt || '').includes('Aided') && !(s.mgmt || '').includes('Unaided'));
      } else if (chosenMgmt === 'UNAIDED') {
        pool = pool.filter(s => (s.mgmt || '').includes('Unaided'));
      }

      // Filter by school level if selected
      if (chosenCat === 'PRIMARY') {
        pool = pool.filter(s => (s.cat || '').includes('Primary') && !(s.cat || '').includes('Upper') && !(s.cat || '').includes('Secondary'));
      } else if (chosenCat === 'UPPER_PRIMARY') {
        pool = pool.filter(s => (s.cat || '').includes('Upper Primary'));
      } else if (chosenCat === 'SECONDARY') {
        pool = pool.filter(s => (s.cat || '').includes('Secondary') && !(s.cat || '').includes('Higher'));
      } else if (chosenCat === 'HIGHER_SECONDARY') {
        pool = pool.filter(s => (s.cat || '').includes('Higher Secondary'));
      }

      // Filter by student strength
      if (cardFilter === 'IMPORTANT') {
        pool = pool.filter(s => (s.students || 0) >= 350 || s.distKm <= 20);
      } else if (cardFilter === 'ZP') {
        pool = pool.filter(s => (s.mgmt || '').includes('Zilla Parishad') || (s.mgmt || '').includes('Government'));
      }

      if (chosenPrio === 'MEGA') {
        pool = pool.filter(s => (s.students || 0) >= 1000);
      } else if (chosenPrio === 'VERY_HIGH') {
        pool = pool.filter(s => (s.students || 0) >= 650);
      } else if (chosenPrio === 'HIGH') {
        pool = pool.filter(s => (s.students || 0) >= 350);
      } else if (chosenPrio === 'MEDIUM') {
        pool = pool.filter(s => (s.students || 0) >= 150 && (s.students || 0) < 350);
      } else if (chosenPrio === 'LOW') {
        pool = pool.filter(s => (s.students || 0) < 150);
      }

      if (pool.length === 0) {
        alert("⚠️ No schools match these specific filters. Try setting 'Target District' or 'Priority' to ALL.");
        return;
      }

      // Sort by proximity to start point
      pool.sort((a, b) => a.distKm - b.distKm);

      // Pick candidate pool
      const numStops = (maxStops >= 99999) ? pool.length : Math.min(pool.length, maxStops);
      const candidates = (maxStops >= 99999) ? pool : pool.slice(0, Math.min(pool.length, Math.max(numStops * 3, 50)));

      // Optimize sequence using TSP Nearest Neighbor
      const orderedStops = optimizeNearestNeighborRoute(originLat, originLon, candidates, numStops);

      if (!orderedStops || orderedStops.length === 0) {
        alert("⚠️ Could not calculate an optimal path. Please adjust filters.");
        return;
      }

      state.preplan.selectedUdises = orderedStops.map(st => st.school.udise);
      state.preplan.stops = orderedStops.map((st, i) => {
        return {
          step: i + 1,
          school: st.school,
          legDistKm: st.legDistKm,
          status: 'PLANNED',
          notes: ''
        };
      });

      let cum = 0;
      state.preplan.stops.forEach(st => {
        cum += st.legDistKm;
        st.cumDistKm = Math.round(cum * 10) / 10;
      });

      state.preplan.totalKm = Math.round(cum * 10) / 10;
      state.preplan.estMins = Math.round(cum * 2.1 + (state.preplan.stops.length * 8));

      // Build Google Maps multi-stop URL
      const gmapsCoords = [`${originLat},${originLon}`];
      state.preplan.stops.slice(0, 10).forEach(st => gmapsCoords.push(`${st.school.lat},${st.school.lon}`));
      state.preplan.gmapsUrl = `https://www.google.com/maps/dir/${gmapsCoords.join('/')}`;

      // Update UI elements
      const stopsCountEl = document.getElementById('preplan-stops-count');
      const totalKmEl = document.getElementById('preplan-total-km');
      const estTimeEl = document.getElementById('preplan-est-time');
      const gmapsBtn = document.getElementById('btn-preplan-open-gmaps');

      if (stopsCountEl) stopsCountEl.textContent = `${state.preplan.stops.length} Schools`;
      if (totalKmEl) totalKmEl.textContent = `${state.preplan.totalKm} KM`;
      if (estTimeEl) estTimeEl.textContent = `~${state.preplan.estMins} min (${Math.round(state.preplan.estMins/60*10)/10} hrs)`;
      if (gmapsBtn) gmapsBtn.href = state.preplan.gmapsUrl;

      // Update district preplan selector if matching
      const targetDistSelect = document.getElementById('preplan-target-district');
      if (targetDistSelect && chosenDist && chosenDist !== 'ALL') {
        targetDistSelect.value = chosenDist;
        state.preplan.district = chosenDist;
      }

      if (!leafletPreplanMap) initPreplanMap();
      if (leafletPreplanMap) leafletPreplanMap.invalidateSize(true);
      renderPreplanStopsTable();
      drawPreplanRouteOnMap();
      renderOfficerDrawer();
      saveCurrentOfficerData(false);

      if (!silent) {
        // Scroll to route map
        const mapEl = document.getElementById('preplan-interactive-map') || document.getElementById('routes-section');
        if (mapEl) mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Visual feedback toast/alert
        const feedbackMsg = `⚡ Route Generated Successfully!\n\n📍 Departure: ${originName}\n🏫 Planned Stops: ${state.preplan.stops.length} Schools\n🚗 Total Distance: ${state.preplan.totalKm} KM\n⏱️ Est. Drive Time: ~${Math.round(state.preplan.estMins/60*10)/10} hrs`;
        alert(feedbackMsg);
      }
    } catch (err) {
      console.error("Error generating route:", err);
      alert("Error generating route: " + (err.message || err));
    }
  };



  // Auto-adjust all maps on window resize, mobile orientation change, or split screen
  window.addEventListener('resize', function() {
    if (leafletPreplanMap) leafletPreplanMap.invalidateSize(true);
    if (leafletSideMap) leafletSideMap.invalidateSize(true);
    if (leafletRouteMap) leafletRouteMap.invalidateSize(true);
  });
  window.addEventListener('orientationchange', function() {
    setTimeout(function() {
      if (leafletPreplanMap) leafletPreplanMap.invalidateSize(true);
      if (leafletSideMap) leafletSideMap.invalidateSize(true);
      if (leafletRouteMap) leafletRouteMap.invalidateSize(true);
    }, 200);
  });

})();



  window.refreshDeviceGpsLocation = function() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    const lbl = document.getElementById('auto-route-start-label');
    if (lbl) lbl.textContent = "Detecting live GPS...";

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const acc = Math.round(pos.coords.accuracy || 15);
        setUserLocation(lat, lon, acc, 'Live Device GPS', true);
        if (lbl) lbl.textContent = `Live GPS: ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
        window.generateAutoRouteFromCurrentLocation(true);
      },
      err => {
        console.warn("GPS error:", err);
        if (lbl) lbl.textContent = state.userLocation ? state.userLocation.name : 'Current Location';
        alert("⚠️ Could not get live GPS. Please check location permissions in your browser.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // ==========================================================================
  // 1-CLICK AUTOMATIC ROUTE PLAN FROM MY CURRENT LOCATION
  // ==========================================================================
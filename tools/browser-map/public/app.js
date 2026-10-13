import { AttributionControl, Map, Marker, NavigationControl, ScaleControl } from './vendor/maplibre-gl.mjs';

const KAMPALA = [32.5825, 0.3476];
const INITIAL = { center: KAMPALA, zoom: 12 };

const STYLE_URL = { light: './style.json', dark: './style-dark.json' };
const THEME_KEY = 'nomad.theme';

const el = {
  zoom: document.getElementById('stat-zoom'),
  tiles: document.getElementById('stat-tiles'),
  source: document.getElementById('stat-source'),
  meta: document.getElementById('stat-meta'),
  coords: document.getElementById('coords'),
  clear: document.getElementById('clear'),
  recenter: document.getElementById('recenter'),
  about: document.getElementById('about'),
  aboutToggle: document.getElementById('about-toggle'),
  aboutAttribution: document.getElementById('about-attribution'),
  themeToggle: document.getElementById('theme-toggle'),
  themeColor: document.getElementById('theme-color'),
  toast: document.getElementById('toast'),
  fatal: document.getElementById('fatal'),
  fatalMessage: document.getElementById('fatal-message'),
};

// Tiles rendered this session — a simple proof that everything is local.
const renderedTiles = new Set();

let marker = null;
let pin = null;

// ---------------------------------------------------------------- theme

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)');

/** index.html already resolved this before first paint; read it back as truth. */
function initialTheme() {
  const fromPage = document.documentElement.dataset.theme;
  if (fromPage === 'dark' || fromPage === 'light') return fromPage;
  return systemPrefersDark.matches ? 'dark' : 'light';
}

function storedTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'dark' || saved === 'light' ? saved : null;
  } catch {
    return null; // storage can be blocked
  }
}

function applyTheme(next, { remember = false } = {}) {
  theme = next;
  document.documentElement.dataset.theme = next;
  el.themeToggle.setAttribute('aria-pressed', String(next === 'dark'));
  el.themeToggle.title = next === 'dark' ? 'Switch to light map' : 'Switch to dark map';
  el.themeColor.content = next === 'dark' ? '#14161b' : '#f8f4f0';
  if (remember) {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage can be blocked; the theme still applies for this session */
    }
  }
}

let theme = initialTheme();
applyTheme(theme);

const map = createMap();
wireUi();
loadMeta();
if (map) wireMap(map);

// Handy for debugging and for the headless render check described in README.md.
window.__nomadMap = map;

function createMap() {
  try {
    return new Map({
      container: 'map',
      style: STYLE_URL[theme],
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      maxZoom: 16,
      hash: true,
      attributionControl: false,
    });
  } catch (error) {
    el.fatal.hidden = false;
    el.fatalMessage.textContent = error.message;
    return null;
  }
}

function wireMap(map) {
  map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.addControl(new AttributionControl({ compact: true }), 'bottom-right');

  map.on('click', (event) => setPin(event.lngLat));
  map.on('move', updateStats);
  map.on('data', (event) => {
    if (event.dataType !== 'source' || !event.tile) return;
    const { z, x, y } = event.tile.tileID.canonical;
    renderedTiles.add(`${z}/${x}/${y}`);
    updateStats();
  });
  map.on('error', (event) => {
    const message = event?.error?.message ?? String(event);
    if (/204|404|AbortError/.test(message)) return;
    showToast(message);
  });
}

function wireUi() {
  el.themeToggle.addEventListener('click', () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, { remember: true });
    // setStyle keeps the camera, the pin and every control in place.
    map?.setStyle(STYLE_URL[next]);
  });

  // Follow the OS only while the user has not made an explicit choice.
  systemPrefersDark.addEventListener('change', (event) => {
    if (storedTheme()) return;
    const next = event.matches ? 'dark' : 'light';
    applyTheme(next);
    map?.setStyle(STYLE_URL[next]);
  });

  el.recenter.addEventListener('click', () => {
    map?.easeTo({ center: INITIAL.center, zoom: INITIAL.zoom, duration: 600 });
  });

  el.clear.addEventListener('click', () => {
    marker?.remove();
    marker = null;
    pin = null;
    el.clear.disabled = true;
    el.coords.textContent = 'Tap the map to drop a pin';
    el.coords.classList.remove('has-pin');
  });

  el.coords.addEventListener('click', async () => {
    if (!pin) return;
    try {
      await navigator.clipboard.writeText(`${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`);
      showToast('Coordinates copied', 'ok');
    } catch {
      /* clipboard may be blocked; the readout is still selectable */
    }
  });

  el.aboutToggle.addEventListener('click', () => {
    const open = el.about.hidden;
    el.about.hidden = !open;
    el.aboutToggle.setAttribute('aria-expanded', String(open));
  });
}

function setPin(lngLat) {
  pin = lngLat;
  if (!marker) {
    const element = document.createElement('div');
    element.className = 'nomad-pin';
    marker = new Marker({ element, anchor: 'center', draggable: true })
      .setLngLat(lngLat)
      .addTo(map);
    marker.on('dragend', () => setPin(marker.getLngLat()));
  } else {
    marker.setLngLat(lngLat);
  }

  el.clear.disabled = false;
  el.coords.classList.add('has-pin');
  el.coords.textContent = `${lngLat.lat.toFixed(5)}, ${lngLat.lng.toFixed(5)}`;
}

function updateStats() {
  if (!map) return;
  el.zoom.textContent = map.getZoom().toFixed(1);
  el.tiles.textContent = renderedTiles.size.toLocaleString();
}

async function loadMeta() {
  try {
    const meta = await fetch('./meta.json').then((r) => r.json());
    const mb = (meta.sizeBytes / 1024 / 1024).toFixed(1);
    const asOf = meta.osmDataAsOf ? meta.osmDataAsOf.slice(0, 10) : 'unknown';
    el.source.textContent = meta.mbtiles.split(/[/\\]/).pop();
    el.meta.textContent = `${meta.tileCount.toLocaleString()} tiles · z${meta.minzoom}–${meta.maxzoom} · ${mb} MB · OSM data as of ${asOf}`;
    el.aboutAttribution.innerHTML = meta.attribution;
  } catch {
    el.meta.textContent = 'Local tile server ready.';
  }
}

let toastTimer = 0;
function showToast(message, kind = 'error') {
  el.toast.hidden = false;
  el.toast.textContent = message;
  el.toast.style.background = kind === 'ok' ? 'rgba(0, 184, 148, 0.95)' : 'rgba(214, 48, 49, 0.95)';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, kind === 'ok' ? 1500 : 6000);
}

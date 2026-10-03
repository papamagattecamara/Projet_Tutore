/* TV Monde — lecteur local de chaînes TV du monde entier.
 * Source des chaînes : base publique iptv-org (https://github.com/iptv-org/iptv),
 * qui ne répertorie que des flux diffusés librement par les chaînes elles-mêmes. */

const API = 'https://iptv-org.github.io/api/';
const ROW_HEIGHT = 52;
const LOAD_TIMEOUT_MS = 20000;
const IMPORTED = '__import';

const $ = (id) => document.getElementById(id);
const els = {
  search: $('search'), country: $('country'), category: $('category'),
  favToggle: $('favToggle'), importBtn: $('importBtn'), status: $('status'), list: $('list'),
  video: $('video'), overlay: $('overlay'), nowLogo: $('nowLogo'), nowName: $('nowName'),
  nowMeta: $('nowMeta'), nowFav: $('nowFav'), importDialog: $('importDialog'),
  m3uUrl: $('m3uUrl'), m3uFile: $('m3uFile'), m3uLoad: $('m3uLoad'),
};

const state = {
  all: [],            // toutes les entrées (flux)
  filtered: [],       // entrées visibles après filtres
  countries: {},      // code -> { name, flag }
  categories: {},     // id -> name
  favorites: new Set(load('favorites', [])),
  broken: new Set(),
  onlyFav: false,
  current: null,
  pending: false,     // dernière chaîne restaurée, pas encore lancée
  proxy: false,
  hls: null,
  timer: null,
};

/* ---------- Stockage local (préférences du navigateur) ---------- */
function load(key, fallback) {
  try { const v = localStorage.getItem('tvmonde.' + key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem('tvmonde.' + key, JSON.stringify(value)); } catch { /* ignore */ }
}

/* ---------- Chargement des données ---------- */
async function getJSON(name, optional = false) {
  try {
    const r = await fetch(API + name + '.json');
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    if (optional) return [];
    throw e;
  }
}

async function loadCatalog() {
  const [streams, channels, countries, categories, logos] = await Promise.all([
    getJSON('streams'), getJSON('channels'), getJSON('countries', true),
    getJSON('categories', true), getJSON('logos', true),
  ]);

  for (const c of countries) state.countries[c.code] = { name: c.name, flag: c.flag || '' };
  for (const c of categories) state.categories[c.id] = c.name;

  const channelsById = new Map(channels.map((c) => [c.id, c]));
  const logoByChannel = new Map();
  for (const l of logos) {
    // On garde le logo principal (sans flux spécifique) en priorité.
    if (!logoByChannel.has(l.channel) || !l.feed) logoByChannel.set(l.channel, l.url);
  }

  const seen = new Set();
  const entries = [];
  for (const s of streams) {
    if (!s.url || seen.has(s.url)) continue;
    const ch = s.channel ? channelsById.get(s.channel) : null;
    if (ch && (ch.is_nsfw || ch.closed)) continue;
    seen.add(s.url);
    const baseName = ch?.name || s.title || s.channel || 'Chaîne inconnue';
    entries.push({
      key: s.url,
      name: s.quality && !baseName.includes(s.quality) ? `${baseName} (${s.quality})` : baseName,
      url: s.url,
      referrer: s.referrer || s.http_referrer || '',
      ua: s.user_agent || '',
      logo: logoByChannel.get(s.channel) || ch?.logo || '',
      country: ch?.country || '',
      categories: ch?.categories || [],
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  return entries;
}

/* ---------- Import M3U ---------- */
function parseM3U(text) {
  const out = [];
  let info = null;
  let opts = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attr = (k) => (line.match(new RegExp(k + '="([^"]*)"')) || [])[1] || '';
      const comma = line.lastIndexOf(',');
      info = {
        name: (comma >= 0 ? line.slice(comma + 1).trim() : '') || attr('tvg-name') || 'Sans nom',
        logo: attr('tvg-logo'),
        group: attr('group-title'),
        country: (attr('tvg-country').split(/[;,]/)[0] || '').toUpperCase(),
      };
    } else if (line.startsWith('#EXTVLCOPT:http-referrer=')) {
      opts.referrer = line.split('=').slice(1).join('=');
    } else if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      opts.ua = line.split('=').slice(1).join('=');
    } else if (!line.startsWith('#')) {
      const i = info || { name: line, logo: '', group: '', country: '' };
      out.push({
        key: 'import:' + line, name: i.name, url: line, logo: i.logo,
        country: i.country, categories: [], group: i.group,
        referrer: opts.referrer || '', ua: opts.ua || '', imported: true,
      });
      info = null; opts = {};
    }
  }
  return out;
}

async function importPlaylist() {
  let text = '';
  const file = els.m3uFile.files[0];
  try {
    if (file) {
      text = await file.text();
    } else if (els.m3uUrl.value.trim()) {
      const url = els.m3uUrl.value.trim();
      const r = await fetch(state.proxy ? '/proxy?url=' + encodeURIComponent(url) : url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      text = await r.text();
    } else return;
  } catch (e) {
    alert('Impossible de charger la playlist : ' + e.message);
    return;
  }
  // Une playlist passée par le proxy a ses URL réécrites : on les remet d'origine.
  const entries = parseM3U(text).map((e) => {
    if (e.url.startsWith('/proxy?')) {
      const p = new URLSearchParams(e.url.slice(7));
      return { ...e, url: p.get('url'), key: 'import:' + p.get('url') };
    }
    return e;
  });
  if (!entries.length) { alert('Aucune chaîne trouvée dans cette playlist.'); return; }
  state.all = state.all.filter((e) => !e.imported).concat(entries);
  if (![...els.country.options].some((o) => o.value === IMPORTED)) {
    els.country.add(new Option('📂 Playlist importée', IMPORTED), 1);
  }
  els.country.value = IMPORTED;
  els.m3uFile.value = ''; els.m3uUrl.value = '';
  applyFilters();
}

/* ---------- Filtres et liste ---------- */
function fillSelects() {
  const countryCount = {};
  const catCount = {};
  for (const e of state.all) {
    if (e.country) countryCount[e.country] = (countryCount[e.country] || 0) + 1;
    for (const c of e.categories) catCount[c] = (catCount[c] || 0) + 1;
  }
  Object.keys(countryCount)
    .map((code) => ({ code, ...(state.countries[code] || { name: code, flag: '' }) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    .forEach((c) => els.country.add(new Option(`${c.flag} ${c.name} (${countryCount[c.code]})`, c.code)));
  Object.keys(catCount)
    .sort((a, b) => (state.categories[a] || a).localeCompare(state.categories[b] || b, 'fr'))
    .forEach((id) => els.category.add(new Option(`${state.categories[id] || id} (${catCount[id]})`, id)));
}

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function applyFilters() {
  const q = normalize(els.search.value.trim());
  const country = els.country.value;
  const cat = els.category.value;
  state.filtered = state.all.filter((e) => {
    if (country === IMPORTED ? !e.imported : country && e.country !== country) return false;
    if (cat && !e.categories.includes(cat)) return false;
    if (state.onlyFav && !state.favorites.has(e.key)) return false;
    if (q && !normalize(e.name + ' ' + (e.group || '')).includes(q)) return false;
    return true;
  });
  save('filters', { country: country === IMPORTED ? '' : country, cat, onlyFav: state.onlyFav });
  els.status.textContent = `${state.filtered.length.toLocaleString('fr')} chaîne(s)` +
    (state.all.length !== state.filtered.length ? ` sur ${state.all.length.toLocaleString('fr')}` : '');
  els.list.scrollTop = 0;
  renderList();
}

function initials(name) {
  return name.replace(/\(.*?\)/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function describe(e) {
  const c = state.countries[e.country];
  const parts = [];
  if (c) parts.push(`${c.flag} ${c.name}`);
  else if (e.country) parts.push(e.country);
  const cats = e.categories.map((id) => state.categories[id] || id);
  if (e.group) cats.push(e.group);
  if (cats.length) parts.push(cats.join(', '));
  return parts.join(' · ');
}

// Liste virtualisée : seules les lignes visibles sont dans le DOM (des milliers de chaînes).
function renderList() {
  const list = els.list;
  const total = state.filtered.length;
  const first = Math.max(0, Math.floor(list.scrollTop / ROW_HEIGHT) - 5);
  const count = Math.ceil(list.clientHeight / ROW_HEIGHT) + 10;
  const last = Math.min(total, first + count);

  const frag = document.createDocumentFragment();
  const top = document.createElement('div');
  top.style.height = first * ROW_HEIGHT + 'px';
  frag.append(top);

  for (let i = first; i < last; i++) {
    const e = state.filtered[i];
    const li = document.createElement('li');
    li.dataset.index = i;
    li.setAttribute('role', 'option');
    if (state.current && state.current.key === e.key) li.classList.add('current');
    if (state.broken.has(e.key)) li.classList.add('broken');

    let logo;
    if (e.logo) {
      logo = document.createElement('img');
      logo.loading = 'lazy';
      logo.referrerPolicy = 'no-referrer';
      logo.src = e.logo;
      logo.alt = '';
      logo.onerror = () => logo.replaceWith(fallbackLogo(e.name));
      logo.className = 'logo';
    } else logo = fallbackLogo(e.name);

    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = e.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = describe(e);
    info.append(name, meta);

    const star = document.createElement('button');
    star.className = 'star' + (state.favorites.has(e.key) ? ' on' : '');
    star.textContent = state.favorites.has(e.key) ? '★' : '☆';
    star.title = 'Favori';
    star.dataset.fav = i;

    li.append(logo, info, star);
    frag.append(li);
  }
  const bottom = document.createElement('div');
  bottom.style.height = (total - last) * ROW_HEIGHT + 'px';
  frag.append(bottom);
  list.replaceChildren(frag);
}

function fallbackLogo(name) {
  const d = document.createElement('div');
  d.className = 'logo';
  d.textContent = initials(name) || '?';
  return d;
}

function toggleFavorite(e) {
  if (state.favorites.has(e.key)) state.favorites.delete(e.key);
  else state.favorites.add(e.key);
  save('favorites', [...state.favorites]);
  if (state.onlyFav) applyFilters(); else renderList();
  updateNowFav();
}

/* ---------- Lecture ---------- */
function proxied(e) {
  const p = new URLSearchParams({ url: e.url });
  if (e.referrer) p.set('ref', e.referrer);
  if (e.ua) p.set('ua', e.ua);
  return '/proxy?' + p;
}

function showOverlay(html) {
  if (html == null) { els.overlay.hidden = true; return; }
  els.overlay.innerHTML = html;
  els.overlay.hidden = false;
}

function stop() {
  clearTimeout(state.timer);
  if (state.hls) { state.hls.destroy(); state.hls = null; }
  els.video.removeAttribute('src');
  els.video.load();
}

function play(e) {
  state.current = e;
  state.pending = false;
  save('last', e.key);
  els.nowName.textContent = e.name;
  els.nowMeta.textContent = describe(e);
  els.nowLogo.src = e.logo || '';
  els.nowFav.hidden = false;
  updateNowFav();
  document.title = e.name + ' — TV Monde';
  renderList();
  // Un flux qui exige un Referer/User-Agent ne peut être lu qu'à travers le proxy.
  attempt(e, state.proxy && Boolean(e.referrer || e.ua));
}

function attempt(e, viaProxy) {
  stop();
  showOverlay('<div class="spinner"></div><p>Connexion à la chaîne…</p>');
  const src = viaProxy ? proxied(e) : e.url;
  const video = els.video;
  let failed = false;

  const fail = (why) => {
    if (failed || state.current !== e) return;
    failed = true;
    stop();
    if (!viaProxy && state.proxy) { attempt(e, true); return; }
    state.broken.add(e.key);
    renderList();
    showOverlay(`<p>😕 Cette chaîne ne répond pas pour le moment.</p><p class="hint">${why}` +
      (state.proxy ? '' : '<br>Astuce : lance l\'appli avec <code>python3 server.py</code> pour lire davantage de chaînes.') +
      '</p><p class="hint">Essaie une autre chaîne avec <kbd>↓</kbd>.</p>');
  };

  state.timer = setTimeout(() => fail('Délai de connexion dépassé.'), LOAD_TIMEOUT_MS);
  video.onplaying = () => { clearTimeout(state.timer); state.broken.delete(e.key); showOverlay(null); };
  video.onerror = () => fail('Format non pris en charge ou flux indisponible.');

  const looksHls = /\.m3u8?(\?|$)/i.test(e.url) || !/\.(mp4|webm|mp3|aac|ogg)(\?|$)/i.test(e.url);
  if (looksHls && window.Hls && Hls.isSupported()) {
    const hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 2 });
    state.hls = hls;
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hls._recovered) {
        hls._recovered = true;
        hls.recoverMediaError();
      } else fail(data.type === Hls.ErrorTypes.NETWORK_ERROR ? 'Flux injoignable ou hors ligne.' : 'Flux illisible (' + data.details + ').');
    });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else {
    video.src = src;
    video.play().catch(() => {});
  }
}

function updateNowFav() {
  const on = state.current && state.favorites.has(state.current.key);
  els.nowFav.textContent = on ? '★ Favori' : '☆ Favori';
  els.nowFav.classList.toggle('active', Boolean(on));
}

function step(delta) {
  if (state.pending) { play(state.current); return; }
  if (!state.filtered.length) return;
  let i = state.current ? state.filtered.findIndex((e) => e.key === state.current.key) : -1;
  i = i < 0 ? 0 : (i + delta + state.filtered.length) % state.filtered.length;
  play(state.filtered[i]);
  // Garde la chaîne courante visible dans la liste.
  const top = i * ROW_HEIGHT;
  const list = els.list;
  if (top < list.scrollTop || top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
    list.scrollTop = top - list.clientHeight / 2;
    renderList();
  }
}

/* ---------- Événements ---------- */
function bindEvents() {
  let t;
  els.search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(applyFilters, 150); });
  els.country.addEventListener('change', applyFilters);
  els.category.addEventListener('change', applyFilters);
  els.favToggle.addEventListener('click', () => {
    state.onlyFav = !state.onlyFav;
    els.favToggle.classList.toggle('active', state.onlyFav);
    applyFilters();
  });
  els.list.addEventListener('scroll', () => requestAnimationFrame(renderList), { passive: true });
  window.addEventListener('resize', renderList);
  els.list.addEventListener('click', (ev) => {
    const star = ev.target.closest('[data-fav]');
    if (star) { toggleFavorite(state.filtered[star.dataset.fav]); return; }
    const li = ev.target.closest('li');
    if (li) play(state.filtered[li.dataset.index]);
  });
  els.nowFav.addEventListener('click', () => state.current && toggleFavorite(state.current));
  els.importBtn.addEventListener('click', () => els.importDialog.showModal());
  els.importDialog.addEventListener('close', () => {
    if (els.importDialog.returnValue === 'ok') importPlaylist();
  });

  document.addEventListener('keydown', (ev) => {
    const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if (ev.key === 'Escape' && document.activeElement === els.search) { els.search.blur(); return; }
    if (typing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    switch (ev.key) {
      case 'ArrowDown': ev.preventDefault(); step(1); break;
      case 'ArrowUp': ev.preventDefault(); step(-1); break;
      case '/': ev.preventDefault(); els.search.focus(); els.search.select(); break;
      case 'f': case 'F':
        if (document.fullscreenElement) document.exitFullscreen();
        else els.video.requestFullscreen?.();
        break;
      case 'm': case 'M': els.video.muted = !els.video.muted; break;
    }
  });
}

/* ---------- Démarrage ---------- */
async function main() {
  bindEvents();
  state.proxy = await fetch('/health').then((r) => r.ok).catch(() => false);

  try {
    state.all = await loadCatalog();
  } catch (e) {
    els.status.textContent = 'Impossible de charger la liste des chaînes (connexion Internet ?). ' +
      'Tu peux quand même importer une playlist M3U.';
    return;
  }
  fillSelects();

  const f = load('filters', {});
  if (f.country && [...els.country.options].some((o) => o.value === f.country)) els.country.value = f.country;
  if (f.cat && [...els.category.options].some((o) => o.value === f.cat)) els.category.value = f.cat;
  if (f.onlyFav) { state.onlyFav = true; els.favToggle.classList.add('active'); }
  applyFilters();

  const last = state.all.find((e) => e.key === load('last', ''));
  if (last) {
    state.current = last;
    state.pending = true;
    els.nowName.textContent = last.name;
    els.nowMeta.textContent = describe(last) + ' — appuie sur ↓ ou clique pour reprendre';
    els.nowLogo.src = last.logo || '';
    els.nowFav.hidden = false;
    updateNowFav();
    renderList();
  }
}

main();

/*
 * Cinubo España — proveedor inicial para Nuvio
 * Interfaz compatible con HDFull: module.exports = { getStreams }
 *
 * Esta versión usa las páginas públicas de catálogo y fichas observadas
 * en las muestras aportadas. No descifra tokens /t/, no resuelve hosts
 * externos y no intenta saltarse login, CAPTCHA ni otras verificaciones.
 */
const BASE = 'https://cinubo.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const TMDB_KEY = '439c478a771f35c05022f9feabcca01c'; // Opcional: introducir aquí una API key propia de TMDB.

function abs(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return new URL(url, BASE).href;
}
function decodeHtml(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}
function clean(s) {
  return decodeHtml(String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}
function norm(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
async function request(url, method = 'GET', body = null) {
  const headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-ES,es;q=0.9',
    ...(body ? { 'Content-Type': 'application/json', 'Origin': BASE, 'Referer': BASE + '/' } : {})
  };
  if (typeof __native_fetch === 'function') {
    const raw = await __native_fetch(url, method, JSON.stringify(headers), body ? 'text' : 'none', body ? JSON.stringify(body) : '', true);
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return { ok: !!d.ok, status: d.status, url: d.url || url, text: async () => d.body || '' };
  }
  const r = await fetch(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { ok: r.ok, status: r.status, url: r.url || url, text: () => r.text() };
}
async function html(url) {
  try {
    const r = await request(url);
    if (!r.ok) return '';
    return await r.text();
  } catch (_) { return ''; }
}
function titleFromCard(fragment) {
  const titleAttr = fragment.match(/\b(?:title|aria-label)="([^"]+)"/i);
  if (titleAttr) return clean(titleAttr[1]);
  const img = fragment.match(/<img\b[^>]*\balt="([^"]+)"/i);
  if (img) return clean(img[1]);
  return clean(fragment);
}
function catalogItems(page, type) {
  const route = type === 'tv' ? '/s/' : '/p/';
  const re = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  const found = [], seen = new Set();
  let m;
  while ((m = re.exec(page))) {
    const href = abs(m[2]);
    if (!new RegExp('^https?://(?:www\\.)?cinubo\\.com' + route.replace('/', '\\/') + '[a-z0-9]+(?:[/?#]|$)', 'i').test(href)) continue;
    const id = href.match(new RegExp(route.replace('/', '\\/') + '([a-z0-9]+)', 'i'));
    if (!id || seen.has(id[1])) continue;
    seen.add(id[1]);
    const title = titleFromCard(m[1] + ' ' + m[3] + ' ' + m[4]);
    if (title) found.push({ id: id[1], url: href, title });
  }
  return found;
}
function score(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xs = new Set(x.split(' ')), ys = new Set(y.split(' '));
  let n = 0; for (const v of xs) if (ys.has(v)) n++;
  return n / Math.max(xs.size, ys.size);
}
async function tmdbData(id, type) {
  if (!TMDB_KEY) return null;
  try {
    let tmdbId = String(id);
    if (/^tt\d+$/.test(tmdbId)) {
      const f = await (await request(`https://api.themoviedb.org/3/find/${tmdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`)).text();
      const j = JSON.parse(f);
      const hit = (type === 'movie' ? j.movie_results : j.tv_results) || [];
      if (!hit[0]) return null;
      tmdbId = String(hit[0].id);
    }
    const r = await request(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${TMDB_KEY}&language=es-ES`);
    if (!r.ok) return null;
    const d = JSON.parse(await r.text());
    return { title: d.title || d.name || '', year: String(d.release_date || d.first_air_date || '').slice(0,4) };
  } catch (e) {
    throw new Error('[Cinubo] Fallo consultando TMDB: ' + (e && e.message ? e.message : e));
  }
}
async function findFicha(tmdbId, type) {
  const data = await tmdbData(tmdbId, type);
  if (!data || !data.title) {
    throw new Error('[Cinubo] TMDB no ha devuelto el título para el ID ' + tmdbId + '.');
  }
  try {
    // Endpoint observado en la búsqueda dinámica de Cinubo (POST JSON).
    const r = await request(BASE + '/api/search/posts', 'POST', { query: data.title, page: 1 });
    if (!r.ok) throw new Error('La búsqueda de Cinubo respondió HTTP ' + r.status + '.');
    const payload = JSON.parse(await r.text());
    const rows = [];
    const collect = (value, depth = 0) => {
      if (!value || depth > 6) return;
      if (Array.isArray(value)) {
        for (const item of value) collect(item, depth + 1);
        return;
      }
      if (typeof value !== 'object') return;
      if (value.slug && (value.title || value.name)) rows.push(value);
      for (const [key, child] of Object.entries(value)) {
        if (key !== 'poster' && key !== 'cover') collect(child, depth + 1);
      }
    };
    collect(payload);
    const wantedTypes = type === 'tv'
      ? new Set(['tv', 'serie', 'series', 'show', 'tv_show'])
      : new Set(['movie', 'pelicula', 'película', 'film']);
    const candidates = rows.filter(x => {
      const kind = String(x.type || x.post_type || '').toLowerCase();
      return wantedTypes.has(kind);
    });
    const exact = candidates.find(x => String(x.tmdb_id || '') === String(tmdbId));
    const match = exact || candidates
      .map(x => ({ item: x, rank: score(x.title, data.title) }))
      .sort((a, b) => b.rank - a.rank)
      .find(x => x.rank >= 0.72)?.item;
    if (!match) throw new Error('La API de Cinubo no encontró coincidencia para «' + data.title + '» (TMDB ' + tmdbId + ').');
    const route = type === 'tv' ? '/s/' : '/p/';
    const rawPath = match.url || match.path || match.permalink || '';
    const fichaUrl = rawPath
      ? (String(rawPath).startsWith('http') ? String(rawPath) : BASE + (String(rawPath).startsWith('/') ? '' : '/') + String(rawPath))
      : BASE + route + encodeURIComponent(String(match.slug));
    return {
      id: String(match.id || match.slug),
      url: fichaUrl,
      title: match.title || match.name || data.title,
      data
    };
  } catch (e) {
    console.log('[Cinubo] Error en búsqueda API: ' + (e && e.message ? e.message : e));
    throw new Error('[Cinubo] Error procesando la búsqueda: ' + (e && e.message ? e.message : e));
  }
}
function parsePlayback(htmlPage, heading) {
  const re = /data-link-playback\s*=\s*["']([^"']+)["']/gi;
  const out = [], seen = new Set();
  let m;
  while ((m = re.exec(htmlPage))) {
    let obj;
    try {
      const raw = decodeHtml(m[1]).replace(/&quot;/g, '"');
      obj = JSON.parse(raw);
    } catch (_) { continue; }
    const info = obj && obj.info || {};
    // La ruta /t/ es un enlace de Cinubo firmado: se conserva intacta.
    const url = obj && obj.url;
    if (!url || !/^https:\/\/cinubo\.com\/t\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const language = String(info.language || '');
    if (!/español|castellano|spanish/i.test(language)) continue;
    out.push({
      name: `${info.server || 'Cinubo'} (${language})`,
      title: heading,
      url,
      quality: `Calidad: ${info.quality || 'Auto'}`,
      language: `Audio: ${language}`,
      provider: 'Cinubo'
    });
  }
  return out;
}
async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    if (mediaType !== 'movie' && mediaType !== 'tv') return [];
    const ficha = await findFicha(tmdbId, mediaType);
    if (!ficha) return [];
    let target = ficha.url;
    if (mediaType === 'tv') {
      // El HTML observado utiliza rutas /s/{slug}/{temporada}x{episodio}.
      if (!season || !episode) throw new Error('[Cinubo] Faltan temporada o episodio para la serie.');
      target = `${ficha.url.replace(/\/+$/, '')}/${parseInt(season,10)}x${parseInt(episode,10)}`;
    }
    const page = await html(target);
    if (!page) throw new Error('[Cinubo] No se pudo descargar la ficha: ' + target);
    const heading = mediaType === 'tv'
      ? `${ficha.data.title} - T${season} E${episode}`
      : `${ficha.data.title}${ficha.data.year ? ` (${ficha.data.year})` : ''}`;
    const streams = parsePlayback(page, heading);
    if (!streams.length) throw new Error('[Cinubo] Se abrió la ficha, pero no se encontraron enlaces en castellano en data-link-playback.');
    return streams;
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    console.log(`[Cinubo] ${message}`);
    throw new Error(message);
  }
}
module.exports = { getStreams };

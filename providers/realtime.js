// Real Time (Discovery Italia) - provider per NuvioTV / Nuvio Mobile (nessun server esterno).
// Token anonimo dalla pagina del programma + videoPlaybackInfo dall'IP del dispositivo:
// l'URL HLS e' firmato con l'IP di chi lo chiede e scade dopo pochi minuti.

var API = 'https://public.aurora.enhanced.live';
var TMDB_KEY_FALLBACK = '68e094699525b18a70bab2f86b1fa706';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
var RT_HEADERS = { 'User-Agent': UA, 'Referer': 'https://realtime.it/', 'Origin': 'https://realtime.it', 'Accept': 'application/json, text/plain, */*' };

function run(genFn) {
  return new Promise(function (resolve, reject) {
    var it = genFn();
    function step(method, value) {
      var r;
      try { r = it[method](value); } catch (e) { reject(e); return; }
      if (r.done) { resolve(r.value); return; }
      Promise.resolve(r.value).then(function (x) { step('next', x); }, function (e) { step('throw', e); });
    }
    step('next');
  });
}

function req(url, opts) {
  return fetch(url, opts || {}).then(function (r) {
    return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t || '' }; });
  }).catch(function () { return { ok: false, status: 0, text: '' }; });
}

function log(msg) { try { console.log('[RealTime] ' + msg); } catch (e) { } }

function parseJson(t) { try { return JSON.parse(t); } catch (e) { return null; } }

function norm(s) {
  var t = String(s || '').toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) { }
  return t.replace(/'/g, '').replace(/&/g, ' e ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function bestVariant(text) {
  var best = null, m, re = /#EXT-X-STREAM-INF:([^\r\n]*)/g;
  while ((m = re.exec(text))) {
    var a = m[1];
    var res = a.match(/RESOLUTION=(\d+)x(\d+)/) || [];
    var v = {
      width: parseInt(res[1], 10) || 0,
      height: parseInt(res[2], 10) || 0,
      bandwidth: parseInt((a.match(/AVERAGE-BANDWIDTH=(\d+)/) || a.match(/(?:^|,)BANDWIDTH=(\d+)/) || [])[1], 10) || 0,
      codecs: (a.match(/CODECS="([^"]*)"/) || [])[1] || ''
    };
    if (!best || v.width > best.width || (v.width === best.width && v.bandwidth > best.bandwidth)) best = v;
  }
  return best;
}

function qualityLabel(width) {
  if (!width) return '';
  if (width >= 3800) return '2160p';
  if (width >= 1900) return '1080p';
  if (width >= 1200) return '720p';
  if (width >= 800) return '480p';
  return '360p';
}

// ---------- formato stream (come PriSynx vixsrc.js) ----------

var FLAG_IT = '\uD83C\uDDEE\uD83C\uDDF9';
var ZW_PREFIX = ['\u200B', '\u200C', '\u200D', '\u2060', '\u2061', '\u2062', '\u2063', '\u2064'];

function sortPrefix(quality, syncLevel) {
  var q = Number(String(quality || '').replace(/[^0-9]/g, '')) || 0;
  var r = q >= 2160 ? 0 : q >= 1080 ? 1 : q >= 720 ? 2 : 3;
  return ZW_PREFIX[r] + ZW_PREFIX[syncLevel];
}

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function formatBitrate(bps) {
  if (!bps) return '';
  if (bps >= 1000000) {
    var mbps = bps / 1000000;
    return (mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2)).replace(/\.0+$/, '') + ' Mbps';
  }
  return Math.round(bps / 1000) + ' kbps';
}

function codecLabel(codecs) {
  var out = [];
  String(codecs || '').split(',').forEach(function (c) {
    c = c.trim().toLowerCase();
    var l = /^(?:avc1|avc3)/.test(c) ? 'H.264' : /^(?:hev1|hvc1)/.test(c) ? 'HEVC' : /^av01/.test(c) ? 'AV1' :
      /^vp09/.test(c) ? 'VP9' : /^mp4a/.test(c) ? 'AAC' : /^ec-3/.test(c) ? 'E-AC-3' : /^ac-3/.test(c) ? 'AC-3' : '';
    if (l && out.indexOf(l) === -1) out.push(l);
  });
  return out.join(' / ');
}

// ---------- flusso principale ----------

function tmdbKey() {
  try { if (typeof TMDB_API_KEY === 'string' && TMDB_API_KEY.length > 10) return TMDB_API_KEY; } catch (e) { }
  return TMDB_KEY_FALLBACK;
}

function getInfo(id) {
  return run(function* () {
    var key = tmdbKey();
    var tmdbId = String(id);
    if (/^tt\d+$/.test(tmdbId)) {
      var f = yield req('https://api.themoviedb.org/3/find/' + tmdbId + '?api_key=' + key + '&external_source=imdb_id');
      var fj = parseJson(f.text);
      var hit = fj && fj.tv_results || [];
      if (!hit.length) return null;
      tmdbId = String(hit[0].id);
    }
    tmdbId = tmdbId.replace(/^tmdb:/, '');
    var r = yield req('https://api.themoviedb.org/3/tv/' + tmdbId + '?api_key=' + key + '&language=it-IT');
    var j = r.ok ? parseJson(r.text) : null;
    if (!j) return null;
    return {
      title: j.name || '',
      orig: j.original_name || '',
      year: parseInt(String(j.first_air_date || '').slice(0, 4), 10) || 0
    };
  });
}

function titleScore(candidate, info) {
  var t = norm(candidate);
  if (!t) return 0;
  var best = 0;
  [norm(info.title), norm(info.orig)].forEach(function (x) {
    if (!x) return;
    if (t === x) best = Math.max(best, 3);
    else if (t.indexOf(x) !== -1 || x.indexOf(t) !== -1) {
      if (Math.min(t.length, x.length) / Math.max(t.length, x.length) >= 0.6) best = Math.max(best, 2);
    }
  });
  return best;
}

function findShow(info) {
  return run(function* () {
    var queries = [info.title, info.orig].map(norm).filter(function (q, i, a) { return q && a.indexOf(q) === i; });
    for (var qi = 0; qi < queries.length; qi++) {
      var r = yield req(API + '/site/search/page/?include=default&filter[environment]=realtime&v=2&q=' +
        encodeURIComponent(queries[qi]) + '&page[number]=1&page[size]=20', { headers: RT_HEADERS });
      var d = r.ok ? parseJson(r.text) : null;
      var best = null, bestScore = 0;
      ((d && d.data) || []).forEach(function (it) {
        if (!it || !it.slug || it.type !== 'showpage') return;
        var s = titleScore(it.title, info);
        if (s > bestScore) { best = it; bestScore = s; }
      });
      if (best) { log('programma "' + best.title + '" (' + best.slug + ')'); return best.slug; }
    }
    return null;
  });
}

// la pagina contiene anche playlist di altri programmi: tengo solo gli episodi dello show
function findEpisode(page, season, episode) {
  var showId = null;
  (page.blocks || []).forEach(function (b) {
    if (!showId && b && b.showId) showId = String(b.showId);
    if (!showId && b && b.show && b.show.id) showId = String(b.show.id);
  });
  var blocks = page.blocks || [];
  for (var i = 0; i < blocks.length; i++) {
    var items = [blocks[i].item].concat(blocks[i].items || []);
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      if (!it || typeof it !== 'object' || !it.id) continue;
      if (showId && !(it.show && String(it.show.id) === showId)) continue;
      if (Number(it.seasonNumber) === season && Number(it.episodeNumber) === episode) return it;
    }
  }
  return null;
}

function playbackUrl(videoId, token) {
  return run(function* () {
    var r = yield req(API + '/playback/v3/videoPlaybackInfo', {
      method: 'POST',
      headers: {
        'User-Agent': UA, 'Referer': 'https://realtime.it/', 'Origin': 'https://realtime.it', 'Accept': '*/*',
        'Content-Type': 'application/json',
        'X-disco-client': 'WEB:UNKNOWN:wbdatv:2.1.9',
        'X-disco-params': 'realm=it',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify({
        deviceInfo: { adBlocker: false, drmSupported: false, hdrCapabilities: ['SDR'], hwDecodingCapabilities: [], soundCapabilities: ['STEREO'] },
        wisteriaProperties: {},
        videoId: String(videoId)
      })
    });
    if (!r.ok) { log('playback HTTP ' + r.status); return null; }
    var d = parseJson(r.text);
    var list = (d && d.data && d.data.attributes && d.data.attributes.streaming) || [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i].protection || {};
      if (list[i].type === 'hls' && list[i].url && !p.drmEnabled) return list[i].url;
    }
    log('nessun HLS senza DRM');
    return null;
  });
}

function findStreams(tmdbId, mediaType, season, episode) {
  return run(function* () {
    try {
      if (mediaType !== 'tv' && mediaType !== 'series') return [];
      var s = parseInt(season, 10) || 1;
      var ep = parseInt(episode, 10) || 1;
      var info = yield getInfo(tmdbId);
      if (!info || !info.title) { log('TMDB senza titolo per ' + tmdbId); return []; }

      var slug = yield findShow(info);
      if (!slug) { log('nessun programma per ' + info.title); return []; }
      var pr = yield req(API + '/site/page/' + encodeURIComponent(slug) +
        '/?include=default&filter[environment]=realtime&v=2&parent_slug=programmi-real-time', { headers: RT_HEADERS });
      var page = pr.ok ? parseJson(pr.text) : null;
      if (!page) { log('pagina HTTP ' + pr.status); return []; }
      var realm = (page.userMeta && page.userMeta.realm) || {};
      var token = realm['X-REALM-IT'] || realm['X-REALM-DPLAY'];
      if (!token) { log('token non trovato'); return []; }

      var item = findEpisode(page, s, ep);
      if (!item) { log('episodio S' + s + 'E' + ep + ' non disponibile'); return []; }
      var url = yield playbackUrl(item.id, token);
      if (!url) return [];

      var headers = { 'User-Agent': UA, 'Referer': 'https://realtime.it/', 'Origin': 'https://realtime.it' };
      var mr = yield req(url, { headers: headers });
      if (!mr.ok || mr.text.indexOf('#EXTM3U') === -1) { log('master HTTP ' + mr.status); return []; }
      var v = bestVariant(mr.text);
      var quality = qualityLabel(v && v.width) || 'HD';

      var heading = '\uD83D\uDCC1 ' + info.title + ' S' + pad2(s) + 'E' + pad2(ep) + (info.year ? ' (' + info.year + ')' : '');
      var technical = v ? [
        v.width && v.height ? '\uD83C\uDF9E\uFE0F ' + v.width + '\u00D7' + v.height : '',
        codecLabel(v.codecs),
        formatBitrate(v.bandwidth) ? '\uD83D\uDCF6 ' + formatBitrate(v.bandwidth) : ''
      ].filter(Boolean).join(' \u00B7 ') : '';
      var details = [
        technical,
        '\uD83D\uDD0A ' + FLAG_IT + ' Italiano',
        '\uD83C\uDFAC Real Time \u00B7 Discovery \u00B7 HLS \u00B7 ' + FLAG_IT
      ].filter(Boolean).join('\n');
      return [{
        name: sortPrefix(quality, 0) + 'Real Time ' + quality + ' ' + FLAG_IT,
        title: heading + '\n' + details,
        size: details,
        url: url,
        type: 'hls',
        quality: quality,
        provider: 'realtime',
        headers: headers,
        behaviorHints: {
          notWebReady: true,
          headers: headers,
          proxyHeaders: { request: headers },
          bingeGroup: 'realtime-discovery',
          filename: 'realtime-' + slug + '-S' + pad2(s) + 'E' + pad2(ep) + '.m3u8'
        }
      }];
    } catch (e) {
      log('errore: ' + (e && e.message ? e.message : e));
      return [];
    }
  });
}

// ---------- Test di Nuvio ----------
// Il Test di Nuvio chiama sempre TMDB 603 (Matrix, assente qui): come PaCC lo si reindirizza a un titolo noto.
var PROBE = { id: 'tt31116760', type: 'tv', season: 9, episode: 9 }; // Il Castello delle Cerimonie

function getStreams(tmdbId, mediaType, season, episode) {
  if (String(tmdbId || '').replace(/^tmdb:/i, '').trim() !== '603') return findStreams(tmdbId, mediaType, season, episode);
  log('test Nuvio (603) -> ' + PROBE.id);
  return findStreams(PROBE.id, PROBE.type, PROBE.season, PROBE.episode).then(function (list) {
    return (list || []).map(function (st) {
      st.name += ' \uD83E\uDDEA';
      st.title = '\uD83E\uDDEA Test Nuvio (603 -> titolo noto)\n' + st.title;
      return st;
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  globalThis.getStreams = getStreams;
}

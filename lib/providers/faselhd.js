const { fetchDocument, normalizeUrl, extractQuality } = require('../utils');

const BASE_URL = 'https://www.faselhd.club';
const PROVIDER_ID = 'faselhd';

function buildMeta(id, title, poster, year, type = 'movie') {
  return {
    id: `${PROVIDER_ID}:${type}:${id}`,
    name: title,
    type,
    poster,
    background: poster,
    year: year ? parseInt(year) : undefined,
  };
}

async function search(query) {
  const results = [];
  try {
    const url = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const $ = await fetchDocument(url);

    $('.postDiv').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src');
      const yearText = $el.find('.year').text() || '';
      const year = yearText.match(/\d{4}/)?.[0];
      const isSeries = href?.includes('/series/') || href?.includes('/season/');

      if (href && title) {
        results.push(buildMeta(
          href,
          title.trim(),
          normalizeUrl(img, BASE_URL),
          year,
          isSeries ? 'series' : 'movie'
        ));
      }
    });
  } catch (err) {
    console.error(`[${PROVIDER_ID}] Search error:`, err.message);
  }
  return results;
}

async function getMovieStreams(id) {
  const streams = [];
  try {
    const $ = await fetchDocument(id);
    const scriptText = $('script').map((_, el) => $(el).html()).get().join(' ');
    
    const urlMatches = scriptText.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || [];
    
    $('video source, .player source').each((_, el) => {
      const src = $(el).attr('src');
      if (src) urlMatches.push(src);
    });

    const iframeSrc = $('iframe').attr('src');
    if (iframeSrc) {
      try {
        const iframe$ = await fetchDocument(normalizeUrl(iframeSrc, BASE_URL));
        const iframeText = iframe$('script').map((_, el) => iframe$(el).html()).get().join(' ');
        const iframeMatches = iframeText.match(/https?:\/\/[^\s'"\]+\.(mp4|m3u8|mkv)[^\s'"]*/gi) || [];
        urlMatches.push(...iframeMatches);
      } catch (e) {
        streams.push({
          name: 'FaselHD',
          title: 'External Player',
          externalUrl: normalizeUrl(iframeSrc, BASE_URL),
        });
      }
    }

    const seen = new Set();
    for (const url of urlMatches) {
      const normalized = normalizeUrl(url, BASE_URL);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const quality = extractQuality(normalized) || 'HD';
      streams.push({
        name: `FaselHD ${quality}`,
        title: `${quality}`,
        url: normalized,
        behaviorHints: {
          notWebReady: normalized.endsWith('.m3u8'),
          bingeGroup: `faselhd-${quality}`,
        },
      });
    }

    const subtitleUrl = $('track[kind="subtitles"]').attr('src');
    if (subtitleUrl && streams.length > 0) {
      streams[0].subtitles = [{
        url: normalizeUrl(subtitleUrl, BASE_URL),
        lang: 'ara',
      }];
    }
  } catch (err) {
    console.error(`[${PROVIDER_ID}] Stream error:`, err.message);
  }
  return streams;
}

async function getSeriesStreams(id, season, episode) {
  try {
    const $ = await fetchDocument(id);
    let seasonUrl = id;
    const seasonLinks = $('a[href*="season"], a[href*="موسم"]').toArray();
    for (const el of seasonLinks) {
      const href = $(el).attr('href');
      const text = $(el).text();
      const seasonNum = text.match(/\d+/)?.[0];
      if (seasonNum && parseInt(seasonNum) === season) {
        seasonUrl = normalizeUrl(href, BASE_URL);
        break;
      }
    }

    const season$ = await fetchDocument(seasonUrl);
    let episodeUrl = seasonUrl;
    const episodeLinks = season$('a[href*="episode"], a[href*="حلقة"]').toArray();
    for (const el of episodeLinks) {
      const href = $(el).attr('href');
      const text = $(el).text();
      const epNum = text.match(/\d+/)?.[0];
      if (epNum && parseInt(epNum) === episode) {
        episodeUrl = normalizeUrl(href, BASE_URL);
        break;
      }
    }

    return getMovieStreams(episodeUrl);
  } catch (err) {
    console.error(`[${PROVIDER_ID}] Series stream error:`, err.message);
  }
  return [];
}

async function getCatalog(type = 'movie', genre = null, skip = 0) {
  const results = [];
  try {
    let url;
    if (type === 'series') {
      url = genre ? `${BASE_URL}/series/category/${genre}/` : `${BASE_URL}/series/`;
    } else {
      url = genre ? `${BASE_URL}/category/${genre}/` : `${BASE_URL}/`;
    }
    if (skip > 0) url += `page/${Math.floor(skip / 20) + 1}/`;

    const $ = await fetchDocument(url);
    $('.postDiv').each((_, el) => {
      const $el = $(el);
      const link = $el.find('a').first();
      const href = link.attr('href');
      const title = link.attr('title') || $el.find('h3').text() || $el.find('.h1').text();
      const img = $el.find('img').attr('src');
      const yearText = $el.find('.year').text() || '';
      const year = yearText.match(/\d{4}/)?.[0];

      if (href && title) {
        results.push(buildMeta(href, title.trim(), normalizeUrl(img, BASE_URL), year, type));
      }
    });
  } catch (err) {
    console.error(`[${PROVIDER_ID}] Catalog error:`, err.message);
  }
  return results;
}

module.exports = {
  id: PROVIDER_ID,
  name: 'FaselHD',
  baseUrl: BASE_URL,
  search,
  getMovieStreams,
  getSeriesStreams,
  getCatalog,
};


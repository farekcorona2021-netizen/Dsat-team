const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

const httpClient = axios.create({
  timeout: 30000,
  headers: {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'ar-EG,ar;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'sec-ch-ua': '"Not:A-Brand";v="99", "Google Chrome";v="124", "Chromium";v="124"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  },
  maxRedirects: 5,
});

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await httpClient({
        url,
        method: options.method || 'GET',
        data: options.data,
        headers: { ...httpClient.defaults.headers, ...(options.headers || {}) },
        responseType: options.responseType || 'text',
      });
      return response;
    } catch (err) {
      if (i === retries - 1) throw err;
      if (err.response?.status === 429 || err.response?.status === 403) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      } else {
        throw err;
      }
    }
  }
}

async function fetchDocument(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return cheerio.load(response.data);
}

function normalizeUrl(url, base) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();
  if (url.startsWith('#') || url.toLowerCase().startsWith('javascript:')) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('//')) return 'https:' + url;
  const baseUrl = new URL(base);
  return new URL(url, baseUrl.origin + baseUrl.pathname).href;
}

function extractQuality(name) {
  if (!name) return null;
  const match = name.match(/(1080p|720p|480p|360p|240p|4K|2160p)/i);
  return match ? match[1] : null;
}

function extractEpisodeNumber(title) {
  if (!title) return null;
  const match = title.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

function extractSeasonNumber(title) {
  if (!title) return 1;
  const match = title.match(/الموسم\s*[:\-_.]*\s*0*(\d+)|S(?:eason)?\s*[:\-_.]*\s*0*(\d+)/i);
  return match ? parseInt(match[1] || match[2]) : 1;
}

module.exports = {
  httpClient,
  fetchWithRetry,
  fetchDocument,
  normalizeUrl,
  extractQuality,
  extractEpisodeNumber,
  extractSeasonNumber,
  USER_AGENT,
};

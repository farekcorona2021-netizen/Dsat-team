const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const BASE_URL = "https://web31312x.faselhdx.bid";

const HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "sec-ch-ua": "\"Not:A-Brand\";v=\"99\", \"Google Chrome\";v=\"145\", \"Chromium\";v=\"145\"",
    "sec-ch-ua-platform": "\"Android\"",
    "upgrade-insecure-requests": "1",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "ar-EG,ar;q=0.9"
};

const Decryptor = {
    key1: "V2@%YSU2B]G~",
    key2: "bv0fim4qf17",
    ie: function(c) {
        const x = c.charCodeAt(0);
        if(x>=97 && x<=122) return x-97; 
        if(x>=65 && x<=90) return x-65+26;
        if(x>=48 && x<=57) return x-48+52; 
        if(x===43) return 62; 
        if(x===47) return 63; 
        return 0;
    },
    bn: function(x) {
        if(x<=25) return String.fromCharCode(x+97); 
        if(x<=51) return String.fromCharCode(x-26+65);
        if(x<=61) return String.fromCharCode(x-52+48); 
        if(x===62) return '+'; 
        if(x===63) return '/'; 
        return ' ';
    },
    dec: function(e, k) {
        let r=''; 
        for(let i=0; i<e.length; i++) {
            const kc=k[i%(k.length-1)]; 
            const M=this.ie(e[i])-this.ie(kc); 
            r+=this.bn(M<0?M+64:M);
        } 
        return r;
    },
    parse: function(url) {
        if(!url || !url.startsWith('enc:')) return url;
        try { 
            return this.dec(this.dec(url.substring(4), this.key2), this.key1); 
        } catch(e) { return url; }
    }
};

const manifest = {
    id: "org.fares.faselhd",
    version: "1.0.0",
    name: "FaselHD - Fares Addon",
    description: "إضافة فاصل إعلاني المخصصة والمستقلة",
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series"],
    idPrefixes: ["fasel_"],
    catalogs: [
        {
            type: "movie",
            id: "fasel_movies",
            name: "فاصل إعلاني - الرئيسية"
        }
    ]
};

const builder = new addonBuilder(manifest);

// الفهرس (Catalog)
builder.defineCatalogHandler(async ({ type, id }) => {
    try {
        const { data } = await axios.get(`${BASE_URL}/main`, { headers: HEADERS });
        const $ = cheerio.load(data);
        let metas = [];

        $('.blockMovie, .postDiv, .epDivHome').each((i, el) => {
            const href = $(el).find('a').attr('href');
            const title = $(el).find('.h1, .h4, .h5').text().trim();
            let poster = $(el).find('img').attr('data-src') || $(el).find('img').attr('src');

            if (href && title) {
                metas.push({
                    id: `fasel_${href}`, 
                    type: "movie",
                    name: title,
                    poster: poster
                });
            }
        });
        return { metas };
    } catch (err) {
        console.error("Catalog Error:", err.message);
        return { metas: [] };
    }
});

// التفاصيل (Meta)
builder.defineMetaHandler(async ({ type, id }) => {
    try {
        const url = id.replace('fasel_', '');
        const { data } = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(data);

        const title = $('.singleInfo .title.h1').text().trim();
        const description = $('.singleDesc p, .story p').text().trim();
        const poster = $('meta[itemprop=image]').attr('content') || $('.posterImg img.poster').attr('src');

        let background = $('.singlePage').attr('style');
        if (background) {
            const match = background.match(/url\(['"]?(.*?)['"]?\)/);
            if (match) background = match[1];
        }

        return {
            meta: {
                id: id,
                type: type,
                name: title,
                description: description,
                poster: poster,
                background: background
            }
        };
    } catch (err) {
        console.error("Meta Error:", err.message);
        return { meta: {} };
    }
});

// الروابط (Stream)
builder.defineStreamHandler(async ({ type, id }) => {
    try {
        const url = id.replace('fasel_', '');
        const { data } = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(data);
        let streams = [];

        let iframeUrl = $('iframe[src]').first().attr('src');
        if (!iframeUrl) {
            const onClickMatch = data.match(/player_iframe\.location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (onClickMatch) iframeUrl = onClickMatch[1];
        }

        if (iframeUrl) {
            const iframeRes = await axios.get(iframeUrl, { headers: HEADERS });

            const encryptedMatch = iframeRes.data.match(/enc:[a-zA-Z0-9+/=]+/);
            let finalUrl = null;

            if (encryptedMatch) {
                finalUrl = Decryptor.parse(encryptedMatch[0]);
            } else {
                const m3u8Match = iframeRes.data.match(/https?:\/\/[^"']+\.m3u8/);
                if (m3u8Match) finalUrl = m3u8Match[0];
            }

            if (finalUrl) {
                streams.push({
                    title: "FaselHD Server",
                    url: finalUrl
                });
            }
        }
        return { streams };
    } catch (err) {
        console.error("Stream Error:", err.message);
        return { streams: [] };
    }
});

// إعداد Express للاستضافة السحابية
const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

app.use('/', getRouter(builder.getInterface()));

module.exports = app;

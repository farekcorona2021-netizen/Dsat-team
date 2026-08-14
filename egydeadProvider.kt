package com.egydead

import com.lagradost.cloudstream3.*
import com.lagradost.cloudstream3.utils.*
import com.lagradost.cloudstream3.mvvm.logError
import com.lagradost.cloudstream3.Episode as CS3Episode
import org.jsoup.nodes.Element
import org.jsoup.nodes.Document
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.ArrayDeque
import java.net.URL
import java.net.URI
import com.lagradost.cloudstream3.network.CloudflareKiller
import kotlinx.coroutines.delay

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch
class EgyDead : MainAPI() {
    override var mainUrl = "https://egydead.beer"
    override var name = "ايجي ديد"
    override val hasMainPage = true
    override var lang = "ar"
    override val supportedTypes = setOf(
        TvType.Movie,
        TvType.TvSeries
    )
    @Volatile
    private var dynamicUA: String? = null

    private fun getUA(): String {

        return dynamicUA ?: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36"
    }


        private val androidUA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36"

        private val cloudflareKiller by lazy { CloudflareKiller() }
        private val bypassMutex = Mutex()

        @Volatile
        private var cfBypassed = false

        private fun log(tag: String, msg: String) {
            println("EgyDeadDebug | [$tag] -> $msg")
        }

    private val imageHeaders: Map<String, String>
        get() {
            val headers = mutableMapOf(
                "User-Agent" to getUA(),
                "Referer" to "$mainUrl/"
            )

            cloudflareKiller.savedCookies["egydead.beer"]?.let { cookies ->
                if (cookies.isNotEmpty()) {
                    headers["Cookie"] = cookies.entries.joinToString("; ") { "${it.key}=${it.value}" }
                }
            }
            return headers
        }

    private suspend fun httpGet(url: String, referer: String? = null): Document {
        val headers = mapOf(
            "User-Agent" to getUA(),
            "Referer" to (referer ?: mainUrl),
            "Accept-Language" to "ar,en-US;q=0.9"
        )

        log("GET-REQUEST", "Fetching: $url")


        var res = app.get(url, headers = headers, interceptor = cloudflareKiller, timeout = 30)

        if (res.code == 403 && !cfBypassed) {
            log("GET-REQUEST", "403 detected. Running bypass...")
            runCloudflareBypass() // سيقوم بالحل والانتظار

            res = app.get(url, headers = headers, interceptor = cloudflareKiller, timeout = 30)
        }

        return res.document
    }

    private suspend fun httpPost(url: String, data: Map<String, String>, referer: String? = null): Document {
        val headers = mapOf(
            "User-Agent" to getUA(),
            "Referer" to (referer ?: mainUrl),
            "X-Requested-With" to "XMLHttpRequest",
            "Content-Type" to "application/x-www-form-urlencoded; charset=UTF-8"
        )

        log("POST-REQUEST", "Sending to: $url")
        var res = app.post(url, data = data, headers = headers, interceptor = cloudflareKiller, timeout = 30)

        if (res.code == 403 && !cfBypassed) {
            log("POST-REQUEST", "403 detected. Running bypass...")
            runCloudflareBypass()
            res = app.post(url, data = data, headers = headers, interceptor = cloudflareKiller, timeout = 30)
        }

        return res.document
    }

    private suspend fun runCloudflareBypass() {
        val host = "egydead.beer"

        if (cloudflareKiller.savedCookies.containsKey(host)) {
            cfBypassed = true
            return
        }

        bypassMutex.withLock {
            if (cfBypassed) return@withLock

            log("BYPASS", "Initiating WebView solver...")
            val solveJob = GlobalScope.launch(Dispatchers.IO) {
                try {
                    val response = app.get(mainUrl, interceptor = cloudflareKiller, timeout = 60)

                    if (response.code == 200) {
                        val capturedUA = response.okhttpResponse.request.header("User-Agent")
                        if (!capturedUA.isNullOrBlank()) dynamicUA = capturedUA
                    }
                } catch (e: Exception) {
                    log("WEBVIEW", "Error: ${e.message}")
                }
            }

            for (i in 1..15) {
                if (cloudflareKiller.savedCookies.containsKey(host) || solveJob.isCompleted) {
                    log("POLLING", "Ready to proceed at second $i")
                    cfBypassed = true
                    break
                }
                delay(1000)
            }
            cfBypassed = true // حتى لو فشل، نفتح المجال للطلب الرئيسي ليحاول
        }
    }

    override suspend fun getMainPage(page: Int, request: MainPageRequest): HomePageResponse {
        val logTag = "MAIN-PAGE"
        log(logTag, "Starting getMainPage | Page: $page | Request: ${request.name}")

        val document = try {
            log(logTag, "Attempting to fetch HTML from: $mainUrl")
            httpGet(mainUrl)
        } catch (e: Exception) {
            log(logTag, "CRITICAL ERROR: Failed to fetch main page -> ${e.message}")
            return HomePageResponse(emptyList())
        }

        val homePageList = ArrayList<HomePageList>()

        log(logTag, "Parsing Pinned Section (div.pin-posts-list)...")
        val pinnedSection = document.selectFirst("div.pin-posts-list")
        if (pinnedSection != null) {
            val sectionTitle = pinnedSection.selectFirst("h1.TitleMaster em")?.text()?.trim() ?: "المميز"
            log(logTag, "Pinned Section found! Title: '$sectionTitle'")

            val items = pinnedSection.select("li.movieItem").mapNotNull {
                it.toSearchResponse("PINNED")
            }

            if (items.isNotEmpty()) {
                log(logTag, "Pinned Section: Successfully added ${items.size} items.")
                homePageList.add(HomePageList(sectionTitle, items, isHorizontalImages = true))
            } else {
                log(logTag, "Pinned Section: FOUND, but contains 0 valid items.")
            }
        } else {
            log(logTag, "Pinned Section (div.pin-posts-list) NOT FOUND in HTML.")
        }

        log(logTag, "Parsing Main Sections (section.main-section)...")
        val mainSections = document.select("section.main-section")
        log(logTag, "Found ${mainSections.size} main-section containers.")

        mainSections.forEachIndexed { index, section ->
            val sectionTitle = section.selectFirst("h1.TitleMaster em")?.text()?.trim() ?: "قسم ${index + 1}"
            log(logTag, "Processing Section [$index]: '$sectionTitle'")

            val items = section.select("li.movieItem").mapNotNull {
                it.toSearchResponse("SECTION-$index")
            }

            if (items.isNotEmpty()) {
                log(logTag, "Section '$sectionTitle': Successfully added ${items.size} items.")
                homePageList.add(HomePageList(sectionTitle, items))
            } else {
                log(logTag, "Section '$sectionTitle': Contains 0 valid items.")
            }
        }

        val finalCount = homePageList.filter { it.list.isNotEmpty() }.size
        log(logTag, "getMainPage finished. Total valid sections found: $finalCount")

        if (homePageList.isEmpty()) {
            log(logTag, "WARNING: homePageList is empty. Possible selector mismatch or empty page.")
        }

        return HomePageResponse(homePageList.filter { it.list.isNotEmpty() })
    }

    private fun Element.toSearchResponse(parentTag: String): SearchResponse? {
        try {
            val linkEl = this.selectFirst("a") ?: run {
                log("PARSER-$parentTag", "Item failed: No anchor (<a>) tag found.")
                return null
            }

            val href = linkEl.attr("href")
            val fullUrl = fixUrlNull(href) ?: run {
                log("PARSER-$parentTag", "Item failed: Could not fix URL from '$href'")
                return null
            }

            val title = this.selectFirst("h1.BottomTitle")?.text()?.trim() ?: run {
                log("PARSER-$parentTag", "Item failed: No title found for URL: $fullUrl")
                return null
            }

            val posterUrl = this.selectFirst("img")?.attr("src")

            return newMovieSearchResponse(title, fullUrl) {
                this.posterUrl = posterUrl
                this.posterHeaders = imageHeaders
            }

        } catch (e: Exception) {
            log("PARSER-$parentTag", "CRITICAL Item Error: ${e.message}")
            return null
        }
    }
    override suspend fun search(query: String): List<SearchResponse> {
        val url = "$mainUrl/?s=$query"
        val document = httpGet(url)
        return document.select("ul.posts-list li.movieItem").mapNotNull {

            it.toSearchResponse("SEARCH")
        }
    }



    private val seasonNumRegex = Regex(
        """(?ix)
        (?:الموسم[\s:\-_.]*0*(\d+))
        |
        (?:S(?:eason)?[\s:\-_.]*0*(\d+))
        """.trimIndent().replace("\n", "")
    )

    private val episodeNumRegex = Regex(
        """(?ix)
        (?:حلقة[\s:\-_.]*0*(\d+))|
        (?:Episode[\s:\-_.]*0*(\d+))|
        (?:EP[\s:\-_.]*0*(\d+))|
        (?:\d+[xX]0*(\d+))|
        (?:S(?:eason)?[\s:\-_.]*\d+[\s\-_.,]*E(?:p(?:isode)?)?[\s:\-_.]*0*(\d+))
        """.trimIndent().replace("\n", "")
    )

    private fun getSeasonNum(title: String?): Int {
        if (title == null) return 9999
        val match = seasonNumRegex.find(title) ?: return 9999
        return match.groupValues.drop(1).firstOrNull { it.isNotEmpty() }?.toIntOrNull() ?: 9999
    }

    private fun getEpisodeNum(title: String?): Int {
        if (title == null) return 9999
        val match = episodeNumRegex.find(title) ?: return 9999
        return match.groupValues.drop(1).firstOrNull { it.isNotEmpty() }?.toIntOrNull() ?: 9999
    }

    private fun normalizeUrl(link: String?, base: String): String? {
        if (link.isNullOrBlank()) return null
        val t = link.trim()
        if (t.startsWith("#") || t.lowercase().startsWith("javascript:")) return null
        return try {
            val resolved = if (t.startsWith("http")) t else URL(URL(base), t).toString()
            fixUrl(resolved)
        } catch (e: Exception) {
            null
        }
    }

    private suspend fun batchFetch(
        urls: List<String>,
        concurrency: Int = 8
    ): Map<String, Document?> {
        val sem = Semaphore(concurrency)
        val out = mutableMapOf<String, Document?>()
        coroutineScope {
            val jobs = urls.map { u ->
                async {
                    sem.withPermit {
                        try {

                            val res = httpGet(u)
                            out[u] = res
                        } catch (e: Exception) {
                            e.printStackTrace()
                            out[u] = null
                        }
                    }
                }
            }
            jobs.awaitAll()
        }
        return out
    }


    private suspend fun discoverSeasonsPreserveOrder(
        startUrl: String,
        concurrency: Int = 8
    ): List<Triple<Int, String, String>> {
        val discovered = mutableListOf<Triple<Int, String, String>>()
        val seen = mutableSetOf<String>()
        val queue = ArrayDeque<String>()
        queue.add(startUrl); seen.add(startUrl)
        var nextIndex = 0

        while (queue.isNotEmpty()) {
            val batch = mutableListOf<String>()
            repeat(minOf(queue.size, concurrency)) { batch.add(queue.poll()) }
            if (batch.isEmpty()) break

            val docs = batchFetch(batch, concurrency)
            for (u in batch) {
                val doc = docs[u] ?: continue
                val title = doc.selectFirst("meta[property=og:title]")?.attr("content")?.trim()
                    ?: "موسم غير معروف"
                discovered.add(Triple(nextIndex++, title, u))

                val seasonsCont =
                    doc.selectFirst("div.seasons-list") ?: doc.selectFirst("div.seasons")
                seasonsCont?.select("li.movieItem a, a")?.forEach { a ->
                    val href = normalizeUrl(a.attr("href"), u) ?: return@forEach
                    if (href !in seen && href.contains("/season/")) {
                        seen.add(href)
                        queue.add(href)
                    }
                }
            }
        }

        return discovered.distinctBy { it.third }
    }

    private fun extractEpisodesFromSeasonDoc(seasonUrl: String, doc: Document): List<CS3Episode> {
        val episodes = mutableListOf<CS3Episode>()
        val epsContainer = doc.selectFirst("div.EpsList") ?: doc.selectFirst("div.episodes-list")
        ?: doc.selectFirst("ul")
        ?: return emptyList()

        val items = epsContainer.select("li, a")
        for (el in items) {
            val a: Element = if (el.tagName() == "a") el else el.selectFirst("a") ?: continue
            val rawTitle = (a.attr("title").takeIf { it.isNotBlank() } ?: a.text()).trim()
            val href = normalizeUrl(a.attr("href"), seasonUrl) ?: continue

            if (href.contains("/season/")) continue
            if (href.contains("/film/")) continue

            val epNum = getEpisodeNum(rawTitle)
            val ep: CS3Episode = newEpisode(href) {
                this.name = rawTitle
                this.episode = if (epNum != 9999) epNum else null
                this.data = href
            }
            episodes.add(ep)
        }

        return episodes.sortedBy { it.episode ?: 9999 }
    }

    private fun parseRecommendations(doc: Document, base: String): List<SearchResponse> {
        val out = mutableListOf<SearchResponse>()
        val nodes = doc.select(".related-posts li.movieItem, .related-posts a, .related-posts li")
        for (li in nodes) {
            val a = li.selectFirst("a") ?: continue
            val href = normalizeUrl(a.attr("href"), base) ?: continue
            val title = a.selectFirst("h1, span, .title")?.text() ?: a.attr("title")
                .takeIf { it.isNotBlank() } ?: a.text()
            val poster = a.selectFirst("img")?.attr("src")
            val sr = when {
                href.contains("/film/") -> newMovieSearchResponse(title, href) {
                    this.posterUrl = poster
                    this.posterHeaders = imageHeaders
                }

                href.contains("/season/") || href.contains("/series/") || href.contains("/show/") || href.contains(
                    "/serie/"
                ) || href.contains("/assembly/") -> newTvSeriesSearchResponse(
                    title,
                    href
                ) { this.posterUrl = poster
                    this.posterHeaders = imageHeaders
                }

                else -> null
            }
            sr?.let { out.add(it) }
        }
        return out
    }

    override suspend fun load(url: String): LoadResponse? {
        fun log(msg: String) = println("EgyDead.load | $msg")

        log("START load() for url=$url")
        val document = try {
            httpGet(url).also { log("Fetched initial URL (length=${it.html().length})") }
        } catch (e: Exception) {
            e.printStackTrace()
            log("ERROR: failed to fetch initial url -> ${e.message}")
            return null
        }

        val movieCollectionList = document.selectFirst("div.salery-list ul")
        if (movieCollectionList != null) {
            log("Detected Movie Collection page (salery-list)")
            val seriesTitle =
                document.selectFirst("meta[property=og:title]")?.attr("content")?.trim()
                    ?: "Movie Collection"
            val poster = document.selectFirst("meta[property=og:image]")?.attr("content")
            val plot = document.selectFirst("div.singleStory")?.text()?.trim()

            val moviesAsEpisodes =
                movieCollectionList.select("li.movieItem").mapIndexedNotNull { index, item ->
                    val a = item.selectFirst("a") ?: return@mapIndexedNotNull null
                    val href = normalizeUrl(a.attr("href"), url) ?: return@mapIndexedNotNull null

                    if (!href.contains("/film/")) return@mapIndexedNotNull null

                    val movieTitle =
                        item.selectFirst("h1.BottomTitle")?.text() ?: "Movie ${index + 1}"
                    val moviePoster = item.selectFirst("img")?.attr("src")

                    newEpisode(href) {
                        this.name = movieTitle
                        this.posterUrl = moviePoster
                        this.season = 1 // Treat all movies as season 1
                        this.episode = index + 1
                        this.data = href // Pass the movie URL to loadLinks
                    }
                }

            if (moviesAsEpisodes.isNotEmpty()) {
                log("Found ${moviesAsEpisodes.size} movies in the collection.")
                return newTvSeriesLoadResponse(
                    seriesTitle,
                    url,
                    TvType.TvSeries,
                    moviesAsEpisodes
                ) {
                    this.posterUrl = poster
                    this.posterHeaders = imageHeaders
                    this.plot = plot
                    this.recommendations = parseRecommendations(document, url)
                }
            }
        }

        if (url.contains("/film/")) {
            log("Detected /film/ page")
            val title =
                document.selectFirst("meta[property=og:title]")?.attr("content")?.trim() ?: run {
                    log("Movie: no og:title found")
                    return null
                }
            val poster = document.selectFirst("meta[property=og:image]")?.attr("content")
            val plot = document.selectFirst("div.singleStory")?.text()?.trim()
            val year =
                document.select("div.LeftBox li:has(span:contains(السنه)) a").text().toIntOrNull()
            val tags =
                document.select("div.LeftBox li:has(span:contains(النوع)) a").map { it.text() }
            val recommendations = parseRecommendations(document, url)
            log("Movie parsed: title='$title', year=$year, tags=${tags.size}, recs=${recommendations.size}")
            return newMovieLoadResponse(title, url, TvType.Movie, url) {
                this.posterUrl = poster
                this.posterHeaders = imageHeaders
                this.plot = plot
                this.year = year
                this.tags = tags
                this.recommendations = recommendations
            }
        }

        val isEpisode = url.contains("/episode/")
        val isSeason = url.contains("/season/")
        val isSeriesPage = url.contains("/serie/") // Helper for main series page
        val hasSeasonsList =
            document.selectFirst("div.seasons-list") != null // Helper for main series page

        log("isEpisode=$isEpisode, isSeason=$isSeason, isSeriesPage=$isSeriesPage, hasSeasonsList=$hasSeasonsList")

        var startSeasonUrl: String? = null

        if (isEpisode) {
            log("Page is an episode, try to find season link from breadcrumbs or page")
            val bc = document.selectFirst("div.breadcrumbs-single, div.breadcrumbs")
            bc?.select("a")?.forEach { a ->
                val href = a.attr("href")
                if (href.contains("/season

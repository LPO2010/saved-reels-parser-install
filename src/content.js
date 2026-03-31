const STORAGE_KEYS = {
  STATE: "savedParserState",
  RECORDS: "savedParserRecords",
  FAILURES: "savedParserFailures"
};

const DEFAULT_CONFIG = {
  maxIdleRounds: 4,
  maxScrollRounds: 120,
  scrollPauseMs: 1100,
  detailConcurrency: 3,
  retryCount: 3,
  minJitterMs: 250,
  maxJitterMs: 850
};

const parserState = {
  running: false,
  paused: false,
  stage: "idle",
  discovered: 0,
  processed: 0,
  failed: 0,
  lastError: null,
  startedAt: null,
  updatedAt: null
};

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function normalizeWhitespace(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function parseCompactNumber(value) {
  if (!value) return null;
  const normalized = value.toString().replace(/,/g, "").trim().toLowerCase();
  const match = normalized.match(/^([\d.]+)\s*([kmb])?$/);
  if (!match) return null;
  const num = Number(match[1]);
  const suffix = match[2];
  if (!Number.isFinite(num)) return null;
  if (!suffix) return Math.round(num);
  const mult = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1e9;
  return Math.round(num * mult);
}

function extractShortcode(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\/(reel|p)\/([^/?#]+)/);
    return match ? match[2] : null;
  } catch {
    return null;
  }
}

function detectItemType(url) {
  if (url.includes("/reel/")) return "reel";
  if (url.includes("/p/")) return "post";
  return "unknown";
}

function getCollectionName() {
  const titleCandidate =
    document.querySelector("h1")?.textContent ||
    document.querySelector("header h2")?.textContent ||
    document.title;
  return normalizeWhitespace(titleCandidate || "saved_default");
}

async function setStoragePatch(patch) {
  await chrome.storage.local.set(patch);
}

async function persistState() {
  parserState.updatedAt = nowIso();
  await setStoragePatch({ [STORAGE_KEYS.STATE]: { ...parserState } });
}

async function waitIfPaused() {
  while (parserState.paused) {
    await sleep(300);
  }
}

function collectGridItems() {
  const links = Array.from(document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]'));
  const collection = getCollectionName();
  const items = [];
  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const absolute = new URL(href, location.origin).toString();
    if (!absolute.includes("instagram.com")) continue;
    const shortcode = extractShortcode(absolute);
    if (!shortcode) continue;
    const owner = absolute.match(/instagram\.com\/([^/?#]+)\//);
    items.push({
      schema_version: "1.0",
      shortcode,
      item_type: detectItemType(absolute),
      post_url: absolute,
      author_handle: owner ? owner[1] : null,
      saved_collection: collection,
      caption_text: null,
      views_count: null,
      likes_count: null,
      comments_count: null,
      published_at: null,
      audio_title: null,
      audio_original_or_trending: null,
      parsed_at: nowIso(),
      data_quality: "minimal",
      data_quality_reason: "pending_enrichment",
      engagement_proxy: null,
      trend_age_days: null,
      priority_flag: "watch"
    });
  }
  return items;
}

async function phase1Discover(config) {
  parserState.stage = "phase1_discovery";
  await persistState();

  const map = new Map();
  let idleRounds = 0;

  for (let i = 0; i < config.maxScrollRounds; i += 1) {
    if (!parserState.running) break;
    await waitIfPaused();

    const before = map.size;
    const found = collectGridItems();
    for (const item of found) {
      if (!map.has(item.shortcode)) {
        map.set(item.shortcode, item);
      }
    }
    parserState.discovered = map.size;
    await persistState();

    if (map.size === before) {
      idleRounds += 1;
    } else {
      idleRounds = 0;
    }

    if (idleRounds >= config.maxIdleRounds) break;

    window.scrollTo(0, document.body.scrollHeight);
    await sleep(config.scrollPauseMs + randomInt(100, 500));
  }

  return Array.from(map.values());
}

function parseMetaOgDescription(text) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return { caption: null, likes: null, comments: null };

  const likesMatch = normalized.match(/([\d.,kmb]+)\s+likes?/i);
  const commentsMatch = normalized.match(/([\d.,kmb]+)\s+comments?/i);
  const captionMatch = normalized.match(/:\s*["“]?(.+?)["”]?$/);

  return {
    caption: captionMatch ? normalizeWhitespace(captionMatch[1]) : null,
    likes: likesMatch ? parseCompactNumber(likesMatch[1]) : null,
    comments: commentsMatch ? parseCompactNumber(commentsMatch[1]) : null
  };
}

function parseInteractionFromLdJson(doc) {
  const scripts = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const raw = JSON.parse(script.textContent || "{}");
      const interactions = Array.isArray(raw.interactionStatistic)
        ? raw.interactionStatistic
        : raw.interactionStatistic
          ? [raw.interactionStatistic]
          : [];
      let likes = null;
      let comments = null;
      for (const entry of interactions) {
        const type = entry?.interactionType?.name || entry?.interactionType;
        const count = Number(entry?.userInteractionCount);
        if (!Number.isFinite(count)) continue;
        if (String(type).toLowerCase().includes("like")) likes = count;
        if (String(type).toLowerCase().includes("comment")) comments = count;
      }
      const uploadDate = raw.uploadDate || raw.datePublished || null;
      return { likes, comments, uploadDate };
    } catch {
      // ignore broken json
    }
  }
  return { likes: null, comments: null, uploadDate: null };
}

function regexExtractNumber(html, patterns) {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function computeTrendFields(item) {
  const views = Number.isFinite(item.views_count) ? item.views_count : 0;
  const likes = Number.isFinite(item.likes_count) ? item.likes_count : 0;
  const comments = Number.isFinite(item.comments_count) ? item.comments_count : 0;
  // Views matter for reel reach; comments carry stronger intent.
  const engagement_proxy = views * 0.04 + likes + comments * 2.2;
  item.engagement_proxy = Math.round(engagement_proxy);

  if (item.published_at) {
    const publishedTs = new Date(item.published_at).getTime();
    if (Number.isFinite(publishedTs)) {
      const ageDays = Math.max(0, Math.floor((Date.now() - publishedTs) / 86400000));
      item.trend_age_days = ageDays;
    }
  }

  if (!Number.isFinite(item.trend_age_days)) {
    item.priority_flag = "watch";
    return item;
  }

  if (item.trend_age_days <= 21 && item.engagement_proxy >= 1000) {
    item.priority_flag = "shoot_now";
  } else if (item.trend_age_days > 60 && item.engagement_proxy < 800) {
    item.priority_flag = "stale";
  } else {
    item.priority_flag = "watch";
  }
  return item;
}

async function enrichSingle(item, config) {
  let lastError = null;
  for (let attempt = 1; attempt <= config.retryCount; attempt += 1) {
    try {
      await waitIfPaused();
      await sleep(randomInt(config.minJitterMs, config.maxJitterMs));
      const response = await fetch(item.post_url, {
        credentials: "include",
        method: "GET",
        redirect: "follow"
      });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const ogDescription = doc.querySelector('meta[property="og:description"]')?.getAttribute("content");
      const metaPublished = doc
        .querySelector('meta[property="article:published_time"]')
        ?.getAttribute("content");
      const metaTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute("content");

      const fromOg = parseMetaOgDescription(ogDescription);
      const fromLd = parseInteractionFromLdJson(doc);

      const likesFromHtml = regexExtractNumber(html, [
        /"edge_media_preview_like"\s*:\s*\{"count"\s*:\s*(\d+)/,
        /"like_count"\s*:\s*(\d+)/
      ]);
      const commentsFromHtml = regexExtractNumber(html, [
        /"edge_media_preview_comment"\s*:\s*\{"count"\s*:\s*(\d+)/,
        /"comment_count"\s*:\s*(\d+)/
      ]);
      const viewsFromHtml = regexExtractNumber(html, [
        /"video_view_count"\s*:\s*(\d+)/,
        /"video_play_count"\s*:\s*(\d+)/,
        /"play_count"\s*:\s*(\d+)/,
        /"view_count"\s*:\s*(\d+)/
      ]);
      const publishedFromHtml = html.match(/"taken_at_timestamp"\s*:\s*(\d{9,})/)?.[1] || null;
      const audioTitleFromHtml = html.match(/"audio_title"\s*:\s*"([^"]+)"/)?.[1] || null;

      item.caption_text = fromOg.caption || item.caption_text;
      item.views_count = viewsFromHtml ?? item.views_count;
      item.likes_count = fromOg.likes ?? fromLd.likes ?? likesFromHtml ?? item.likes_count;
      item.comments_count = fromOg.comments ?? fromLd.comments ?? commentsFromHtml ?? item.comments_count;
      item.published_at =
        metaPublished ||
        fromLd.uploadDate ||
        (publishedFromHtml ? new Date(Number(publishedFromHtml) * 1000).toISOString() : null) ||
        item.published_at;
      item.audio_title = audioTitleFromHtml || metaTitle || item.audio_title;
      if (item.audio_title) {
        item.audio_original_or_trending = /original audio/i.test(item.audio_title) ? "original" : "trending_or_other";
      }
      item.parsed_at = nowIso();

      const missingCore = [item.caption_text, item.likes_count, item.comments_count, item.published_at].filter(
        (v) => v === null || v === undefined || v === ""
      ).length;
      if (missingCore === 0) {
        item.data_quality = "full";
        item.data_quality_reason = null;
      } else if (missingCore <= 2) {
        item.data_quality = "partial";
        item.data_quality_reason = "some_fields_missing";
      } else {
        item.data_quality = "minimal";
        item.data_quality_reason = "detail_sparse";
      }

      computeTrendFields(item);
      return item;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("enrichment_failed");
}

async function runConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length && parserState.running) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function phase2Enrichment(items, config) {
  parserState.stage = "phase2_enrichment";
  await persistState();

  const failures = [];
  await runConcurrent(items, config.detailConcurrency, async (item) => {
    if (!parserState.running) return;
    await waitIfPaused();

    try {
      await enrichSingle(item, config);
    } catch (error) {
      failures.push({
        shortcode: item.shortcode,
        post_url: item.post_url,
        reason: error?.message || "unknown"
      });
      item.data_quality = "minimal";
      item.data_quality_reason = "detail_failed";
      item.priority_flag = "archive";
    } finally {
      parserState.processed += 1;
      parserState.failed = failures.length;
      await persistState();
    }
  });

  return { items, failures };
}

async function executeParsing(config) {
  parserState.running = true;
  parserState.paused = false;
  parserState.stage = "boot";
  parserState.discovered = 0;
  parserState.processed = 0;
  parserState.failed = 0;
  parserState.lastError = null;
  parserState.startedAt = nowIso();
  await persistState();

  try {
    const phase1Items = await phase1Discover(config);
    parserState.discovered = phase1Items.length;
    await persistState();
    const { items, failures } = await phase2Enrichment(phase1Items, config);

    parserState.stage = "done";
    parserState.running = false;
    parserState.paused = false;
    await setStoragePatch({
      [STORAGE_KEYS.RECORDS]: items,
      [STORAGE_KEYS.FAILURES]: failures
    });
    await persistState();
  } catch (error) {
    parserState.stage = "error";
    parserState.running = false;
    parserState.paused = false;
    parserState.lastError = error?.message || String(error);
    await persistState();
  }
}

function buildHealthCheck() {
  const selectors = {
    reelOrPostLinks: document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]').length,
    mainTag: document.querySelectorAll("main").length,
    articleTag: document.querySelectorAll("article").length
  };
  const urlHints = {
    isInstagram: location.hostname.includes("instagram.com"),
    isSavedUrl: location.pathname.includes("/saved")
  };
  return {
    selectors,
    urlHints,
    checkedAt: nowIso()
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  if (message.type === "parser:start") {
    if (parserState.running) {
      sendResponse({ ok: false, reason: "already_running", state: parserState });
      return;
    }
    const config = { ...DEFAULT_CONFIG, ...(message.payload || {}) };
    executeParsing(config);
    sendResponse({ ok: true, state: parserState });
    return;
  }

  if (message.type === "parser:pause") {
    parserState.paused = true;
    parserState.stage = "paused";
    persistState();
    sendResponse({ ok: true, state: parserState });
    return;
  }

  if (message.type === "parser:resume") {
    parserState.paused = false;
    if (parserState.running) {
      parserState.stage = parserState.processed < parserState.discovered ? "phase2_enrichment" : "phase1_discovery";
    }
    persistState();
    sendResponse({ ok: true, state: parserState });
    return;
  }

  if (message.type === "parser:stop") {
    parserState.running = false;
    parserState.paused = false;
    parserState.stage = "stopped";
    persistState();
    sendResponse({ ok: true, state: parserState });
    return;
  }

  if (message.type === "parser:getStatus") {
    sendResponse({ ok: true, state: parserState });
    return;
  }

  if (message.type === "parser:healthCheck") {
    sendResponse({ ok: true, health: buildHealthCheck() });
  }
});

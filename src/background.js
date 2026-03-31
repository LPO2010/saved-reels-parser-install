const STORAGE_KEYS = {
  RECORDS: "savedParserRecords",
  FAILURES: "savedParserFailures"
};

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (raw.includes('"') || raw.includes(",") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(rows, columns) {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((key) => csvEscape(row[key])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

function toCsvDataUrl(csv) {
  // BOM improves opening UTF-8 CSV in Excel.
  const withBom = `\uFEFF${csv}`;
  return `data:text/csv;charset=utf-8,${encodeURIComponent(withBom)}`;
}

function withShortlist(records, topN = 30) {
  const sorted = [...records].sort((a, b) => (b.engagement_proxy || 0) - (a.engagement_proxy || 0));
  const topShortcodes = new Set(sorted.slice(0, topN).map((item) => item.shortcode));
  return records.map((item) => ({
    ...item,
    shortlist_flag: topShortcodes.has(item.shortcode) ? "yes" : "no"
  }));
}

async function exportCsv() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.RECORDS, STORAGE_KEYS.FAILURES]);
  const records = Array.isArray(stored[STORAGE_KEYS.RECORDS]) ? stored[STORAGE_KEYS.RECORDS] : [];
  const failures = Array.isArray(stored[STORAGE_KEYS.FAILURES]) ? stored[STORAGE_KEYS.FAILURES] : [];

  if (!records.length) {
    return { ok: false, reason: "no_records" };
  }

  const enriched = withShortlist(records, 30);
  const columns = [
    "schema_version",
    "shortcode",
    "item_type",
    "post_url",
    "author_handle",
    "saved_collection",
    "caption_text",
    "views_count",
    "likes_count",
    "comments_count",
    "published_at",
    "audio_title",
    "audio_original_or_trending",
    "data_quality",
    "data_quality_reason",
    "engagement_proxy",
    "trend_age_days",
    "priority_flag",
    "shortlist_flag",
    "parsed_at"
  ];

  const csv = toCsv(enriched, columns);
  const url = toCsvDataUrl(csv);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  await chrome.downloads.download({
    url,
    filename: `saved-parser/saved_export_${ts}.csv`,
    saveAs: true
  });

  if (failures.length) {
    const failCsv = toCsv(failures, ["shortcode", "post_url", "reason"]);
    const failUrl = toCsvDataUrl(failCsv);
    await chrome.downloads.download({
      url: failUrl,
      filename: `saved-parser/saved_export_failures_${ts}.csv`,
      saveAs: false
    });
  }
  return { ok: true, count: records.length, failures: failures.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "export:csv") {
    exportCsv()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: error?.message || "export_failed" }));
    return true;
  }
});

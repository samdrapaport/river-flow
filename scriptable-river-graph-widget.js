const API_URL = "https://river-flow-qc9l.onrender.com/flow";
const FALLBACK_BG = new Color("#111111");
const API_TIMEOUT_SECONDS = 12;
const IMAGE_TIMEOUT_SECONDS = 12;
const CACHE_TTL_SECONDS = 60 * 30; // 30 minutes

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function allRows(payload) {
  const rows = [];
  for (const section of payload.sections || []) {
    for (const row of section.table?.rows || []) {
      rows.push({
        section: row[0],
        river: row[1],
        flow: row[2],
        graphUrl: row[3] || "",
      });
    }
  }
  return rows;
}

function findRiver(rows, query) {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const exact = rows.find((row) => normalizeText(row.river) === normalizedQuery);
  if (exact) return exact;

  return rows.find((row) => normalizeText(row.river).includes(normalizedQuery));
}

function toGraphImageUrl(graphUrl) {
  if (!graphUrl) return "";
  if (graphUrl.endsWith(".png")) return graphUrl;
  return graphUrl.replace(/\.php(\?.*)?$/i, ".png");
}

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), "river-flow-rows-cache.json");
}

function readCachedRows() {
  const fm = FileManager.local();
  const path = cachePath();
  if (!fm.fileExists(path)) return null;

  try {
    const parsed = JSON.parse(fm.readString(path));
    if (!parsed || !Array.isArray(parsed.rows) || !parsed.savedAt) return null;
    return parsed;
  } catch (_error) {
    return null;
  }
}

function writeCachedRows(rows) {
  const fm = FileManager.local();
  const payload = {
    savedAt: Date.now(),
    rows,
  };
  fm.writeString(cachePath(), JSON.stringify(payload));
}

function isCacheFresh(cache) {
  if (!cache) return false;
  const ageSeconds = (Date.now() - Number(cache.savedAt || 0)) / 1000;
  return ageSeconds <= CACHE_TTL_SECONDS;
}

async function loadRowsWithCache() {
  const cache = readCachedRows();
  if (isCacheFresh(cache)) return cache.rows;

  try {
    const apiReq = new Request(API_URL);
    apiReq.timeoutInterval = API_TIMEOUT_SECONDS;
    const payload = await apiReq.loadJSON();
    const rows = allRows(payload);
    if (rows.length) writeCachedRows(rows);
    return rows;
  } catch (error) {
    if (cache && Array.isArray(cache.rows) && cache.rows.length) {
      return cache.rows;
    }
    throw error;
  }
}

function buildInfoWidget(title, body, tapUrl) {
  const widget = new ListWidget();
  widget.backgroundColor = FALLBACK_BG;
  widget.setPadding(14, 14, 14, 14);

  const t = widget.addText(title);
  t.textColor = Color.white();
  t.font = Font.boldSystemFont(15);
  t.lineLimit = 2;

  widget.addSpacer(8);

  const b = widget.addText(body);
  b.textColor = new Color("#d4d4d4");
  b.font = Font.systemFont(12);
  b.lineLimit = 5;

  if (tapUrl) widget.url = tapUrl;
  return widget;
}

async function buildGraphWidget(row) {
  const imageUrl = toGraphImageUrl(row.graphUrl);
  if (!imageUrl) {
    return buildInfoWidget(
      row.river,
      "Graph URL missing for this river.",
      row.graphUrl || API_URL
    );
  }

  const request = new Request(imageUrl);
  request.timeoutInterval = IMAGE_TIMEOUT_SECONDS;
  const image = await request.loadImage();

  const widget = new ListWidget();
  widget.backgroundColor = FALLBACK_BG;
  widget.setPadding(8, 8, 8, 8);
  widget.backgroundImage = image;
  widget.url = row.graphUrl || imageUrl;

  // Overlay title for readability on all backgrounds.
  const overlay = widget.addStack();
  overlay.layoutVertically();
  overlay.backgroundColor = new Color("#000000", 0.45);
  overlay.cornerRadius = 8;
  overlay.setPadding(6, 8, 6, 8);

  const river = overlay.addText(row.river);
  river.textColor = Color.white();
  river.font = Font.boldSystemFont(11);
  river.lineLimit = 2;

  const flow = overlay.addText(row.flow || "n/a");
  flow.textColor = new Color("#a7f3d0");
  flow.font = Font.mediumSystemFont(11);
  flow.lineLimit = 1;

  return widget;
}

async function main() {
  const query = String(args.widgetParameter || "").trim();
  if (!query) {
    const widget = buildInfoWidget(
      "River graph widget",
      "Set widget parameter to a river name, e.g. Trinity - At Hoopa.",
      API_URL
    );
    if (config.runsInWidget) Script.setWidget(widget);
    else await widget.presentMedium();
    Script.complete();
    return;
  }

  const rows = await loadRowsWithCache();
  const match = findRiver(rows, query);

  let widget;
  if (!match) {
    widget = buildInfoWidget(
      "River not found",
      `No match for "${query}". Try a broader name.`,
      API_URL
    );
  } else {
    widget = await buildGraphWidget(match);
  }

  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
}

main().catch(async (error) => {
  const widget = buildInfoWidget(
    "Failed to load graph",
    String(error.message || error),
    API_URL
  );
  if (config.runsInWidget) Script.setWidget(widget);
  else await widget.presentMedium();
  Script.complete();
});

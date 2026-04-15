const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

const FLOWS_URL =
  "https://www.dreamflows.com/flows.php?zone=west&page=curr&form=comp&mark=All";
const TABLE_COLUMNS = ["Section", "River", "Flow", "GraphUrl"];
/** Section anchors that are not river lists (Index lives under body; nextUntil would swallow the whole page). */
const SKIP_SECTION_ANCHORS = new Set(["Index", "Symbols"]);

const fetchHeaders = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.dreamflows.com/",
};

/** Cheerio sibling iterators skip raw text nodes (e.g. " - " between links). */
function serializeUntil($, firstEl, stopBeforeNode) {
  const chunks = [$.html(firstEl)];
  let cur = firstEl.nextSibling;
  while (cur && cur !== stopBeforeNode) {
    if (cur.type === "text") chunks.push(cur.data || "");
    else if (cur.type === "tag") chunks.push($.html(cur));
    cur = cur.nextSibling;
  }
  return chunks.join("");
}

function serializeFromBrUntilNextRiver($, brEl) {
  const chunks = [$.html(brEl)];
  let cur = brEl.nextSibling;
  while (cur) {
    if (
      cur.type === "tag" &&
      cur.name === "a" &&
      $(cur).is("a.River")
    ) {
      break;
    }
    if (cur.type === "text") chunks.push(cur.data || "");
    else if (cur.type === "tag") chunks.push($.html(cur));
    cur = cur.nextSibling;
  }
  return chunks.join("");
}

function stripTagsToText(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRiverFromAnchor($, riverEl) {
  const $r = $(riverEl);
  const br = $r.nextAll("br").first();
  if (!br.length) return null;

  const brNode = br.get(0);
  const headHtml = serializeUntil($, riverEl, brNode);
  const river = stripTagsToText(headHtml);

  const tailHtml = serializeFromBrUntilNextRiver($, brNode);
  const flowSpan = tailHtml.match(
    /<span[^>]*class\s*=\s*['"]Flow[^'"]*['"][^>]*>([^<]*)<\/span>/i
  );
  const flow = flowSpan ? flowSpan[1].replace(/\s+/g, " ").trim() : "";
  const graphHref = $r.nextAll("a.Place").first().attr("href") || "";
  const graphUrl = graphHref.startsWith("http")
    ? graphHref
    : graphHref
      ? `https://www.dreamflows.com${graphHref}`
      : "";

  return { river, flow, graphUrl };
}

/** Document-order index: SecHeaders are not always siblings (Index is under body; others nest deeper), so nextUntil is unsafe. */
function buildPreorderIndex(root) {
  const map = new Map();
  let seq = 0;
  (function walk(node) {
    if (!node) return;
    map.set(node, seq++);
    const ch = node.children;
    if (ch) for (const c of ch) walk(c);
  })(root);
  return map;
}

function lastPreorderIndexInSubtree(node, preorder) {
  let max = preorder.get(node);
  const ch = node.children;
  if (ch && ch.length) {
    const m = lastPreorderIndexInSubtree(ch[ch.length - 1], preorder);
    if (m > max) max = m;
  }
  return max;
}

function collectAllSections($) {
  const root = $.root().get(0);
  const preorder = buildPreorderIndex(root);
  const headers = $("div.SecHeader").toArray();
  const rivers = $("a.River").toArray();

  const sections = [];
  for (let i = 0; i < headers.length; i++) {
    const hdr = headers[i];
    const $nameA = $(hdr).find("a[name]").first();
    const anchor = $nameA.attr("name");
    if (!anchor || SKIP_SECTION_ANCHORS.has(anchor)) continue;

    const sectionName = $(hdr).text().replace(/\s+/g, " ").trim();
    const endHdr = headers[i + 1];
    const afterHdr = lastPreorderIndexInSubtree(hdr, preorder);
    const endPos = endHdr ? preorder.get(endHdr) : Infinity;

    const rows = [];
    for (const el of rivers) {
      const pos = preorder.get(el);
      if (pos > afterHdr && pos < endPos) {
        const row = parseRiverFromAnchor($, el);
        if (row) rows.push(row);
      }
    }

    if (rows.length === 0) continue;

    sections.push({
      section: anchor,
      sectionName,
      count: rows.length,
      table: {
        columns: TABLE_COLUMNS,
        rows: rows.map((r) => [sectionName, r.river, r.flow, r.graphUrl]),
      },
    });
  }
  return sections;
}

function normalizeSectionParam(raw) {
  const s = String(raw).trim().replace(/\s+/g, "_");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) return null;
  return s;
}

app.get("/", (_req, res) => {
  res.json({
    name: "river-flow",
    status: "ok",
    endpoints: {
      health: "/health",
      flow: "/flow",
      filteredFlow: "/flow?section=California_North_Coast",
    },
  });
});

app.get("/health", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

app.get("/flow", async (req, res) => {
  try {
    const { data } = await axios.get(FLOWS_URL, { headers: fetchHeaders });
    const $ = cheerio.load(data);
    let sections = collectAllSections($);

    const rawFilter = req.query.section;
    if (rawFilter != null && String(rawFilter).trim() !== "") {
      const sectionAnchor = normalizeSectionParam(rawFilter);
      if (!sectionAnchor) {
        return res.status(400).json({
          error: "Invalid section",
          hint: "Use the URL hash id, e.g. California_North_Coast",
        });
      }
      sections = sections.filter((s) => s.section === sectionAnchor);
      if (sections.length === 0) {
        return res.status(404).json({
          error: `Section not found: ${sectionAnchor}`,
          hint: "Use ?section=California_North_Coast (anchor name from the URL hash)",
        });
      }
    }

    const totalRows = sections.reduce((sum, s) => sum + s.count, 0);

    res.json({
      source: FLOWS_URL,
      sectionCount: sections.length,
      totalRows,
      sections,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

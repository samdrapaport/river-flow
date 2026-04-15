const API_URL = "https://river-flow-qc9l.onrender.com/flow";

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

function buildWidget(match, query) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#111111");
  widget.setPadding(16, 16, 16, 16);

  const title = widget.addText(query || "River flow");
  title.textColor = Color.white();
  title.font = Font.boldSystemFont(16);
  title.lineLimit = 2;

  widget.addSpacer(8);

  if (!match) {
    const missing = widget.addText("River not found");
    missing.textColor = new Color("#ffb347");
    missing.font = Font.mediumSystemFont(14);

    widget.addSpacer(6);

    const hint = widget.addText("Set the widget parameter to a river name from /flow.");
    hint.textColor = new Color("#cccccc");
    hint.font = Font.systemFont(12);
    hint.lineLimit = 3;
    return widget;
  }

  const flow = widget.addText(match.flow || "n/a");
  flow.textColor = new Color("#6ee7b7");
  flow.font = Font.boldSystemFont(28);
  flow.lineLimit = 1;
  flow.minimumScaleFactor = 0.6;

  widget.addSpacer(6);

  const river = widget.addText(match.river);
  river.textColor = Color.white();
  river.font = Font.mediumSystemFont(13);
  river.lineLimit = 3;

  widget.addSpacer(4);

  const section = widget.addText(match.section);
  section.textColor = new Color("#a3a3a3");
  section.font = Font.systemFont(11);
  section.lineLimit = 2;

  widget.url = match.graphUrl || API_URL;
  return widget;
}

async function main() {
  const query = (args.widgetParameter || "").trim();

  if (!query) {
    const widget = buildWidget(null, "Set widget parameter");
    if (config.runsInWidget) {
      Script.setWidget(widget);
    } else {
      await widget.presentSmall();
    }
    Script.complete();
    return;
  }

  const request = new Request(API_URL);
  request.timeoutInterval = 30;

  const payload = await request.loadJSON();
  const rows = allRows(payload);
  const match = findRiver(rows, query);
  const widget = buildWidget(match, query);

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentSmall();
  }

  Script.complete();
}

main().catch(async (error) => {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#111111");
  widget.setPadding(16, 16, 16, 16);

  const title = widget.addText("River flow");
  title.textColor = Color.white();
  title.font = Font.boldSystemFont(16);

  widget.addSpacer(8);

  const message = widget.addText("Failed to load data");
  message.textColor = new Color("#ff6b6b");
  message.font = Font.mediumSystemFont(14);

  widget.addSpacer(6);

  const detail = widget.addText(String(error.message || error));
  detail.textColor = new Color("#cccccc");
  detail.font = Font.systemFont(11);
  detail.lineLimit = 4;

  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    await widget.presentSmall();
  }

  Script.complete();
});

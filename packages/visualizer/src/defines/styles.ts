/** CSS for the visualizer page; inlined into the document by `renderVisualGraph`, no external loads. */
export const styles = `
:root {
  color-scheme: light dark;
  --bg: #f4f5f7;
  --stage: #eceef1;
  --panel: #ffffff;
  --panel-2: #f8f9fb;
  --line: #d8dce3;
  --line-soft: #e7eaef;
  --text: #1c2430;
  --muted: #6b7688;
  --accent: #2f6feb;
  --accent-soft: #e6efff;
  --wire: #9aa6b8;
  --wire-hot: #2f6feb;
  --get: #2f855a;
  --post: #2b6cb0;
  --put: #975a16;
  --patch: #975a16;
  --delete: #c53030;
  --sockets: #6b46c1;
  --shared-1: #f0f4ff;
  --shared-2: #ffedd5;
  --shared-3: #fee2e2;
  --radius: 8px;
  --font: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14181e;
    --stage: #0f1216;
    --panel: #1b2027;
    --panel-2: #212832;
    --line: #2c343f;
    --line-soft: #242b34;
    --text: #dfe5ee;
    --muted: #8a94a6;
    --accent: #6ea3ff;
    --accent-soft: #1d2942;
    --wire: #4a5566;
    --wire-hot: #6ea3ff;
    --get: #63b58a;
    --post: #6ea3ff;
    --put: #d6a95f;
    --patch: #d6a95f;
    --delete: #e07070;
    --sockets: #a98bea;
    --shared-1: #1d2942;
    --shared-2: #3a2c17;
    --shared-3: #3b1f1f;
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 13px;
  overflow: hidden;
}

button, select, input { font: inherit; color: inherit; }

/* ---------------------------------------------------------------- header */

.top {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  position: relative;
  z-index: 20;
  flex-wrap: wrap;
}

.top h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .2px;
  white-space: nowrap;
}

.top .sub { color: var(--muted); font-size: 11px; white-space: nowrap; }

.top .spacer { flex: 1; }

.control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 3px 8px;
}

.control label { color: var(--muted); font-size: 11px; }

.control select, .control input {
  background: transparent;
  border: 0;
  outline: none;
  min-width: 120px;
}

.control input { min-width: 200px; }

.btn {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 4px 9px;
  cursor: pointer;
  white-space: nowrap;
}

.btn:hover { border-color: var(--accent); color: var(--accent); }
.btn.on { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }

/* ------------------------------------------------------------- layout */

.body { display: flex; height: calc(100% - 45px); }

.side {
  width: 268px;
  flex: none;
  border-right: 1px solid var(--line);
  background: var(--panel);
  overflow: auto;
  padding: 10px;
}

.side h2 {
  margin: 14px 0 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: var(--muted);
}

.side h2:first-child { margin-top: 0; }

.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

.stat {
  background: var(--panel-2);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius);
  padding: 6px 8px;
}

.stat b { display: block; font-size: 16px; font-weight: 600; }
.stat span { color: var(--muted); font-size: 10px; }

.rank { display: flex; flex-direction: column; gap: 3px; }

.rank-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: var(--font);
  font-size: 11px;
}

.rank-item:hover { border-color: var(--line); }
.rank-item.is-hit { border-color: var(--accent); background: var(--accent-soft); }
.rank-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.count {
  font-family: var(--font);
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 20px;
  background: var(--line-soft);
  color: var(--muted);
}

.count.s1 { background: var(--shared-1); color: var(--accent); }
.count.s2 { background: var(--shared-2); color: var(--put); }
.count.s3 { background: var(--shared-3); color: var(--delete); }

.legend { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 11px; }
.legend div { display: flex; align-items: center; gap: 6px; }
.swatch { width: 10px; height: 10px; border-radius: 3px; border: 1px solid var(--line); }

.warn {
  background: var(--shared-3);
  border: 1px solid var(--delete);
  border-radius: var(--radius);
  padding: 6px 8px;
  font-size: 11px;
  margin-bottom: 6px;
}

/* --------------------------------------------------------------- canvas */

.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at 1px 1px, var(--line) 1px, transparent 0) 0 0 / 22px 22px,
    var(--stage);
  cursor: grab;
}

.viewport.dragging { cursor: grabbing; }

.stage {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  padding: 20px;
  will-change: transform;
}

.wires {
  position: absolute;
  top: 0;
  left: 0;
  overflow: visible;
  pointer-events: none;
}

.wires path {
  fill: none;
  stroke: var(--wire);
  stroke-width: 1.2;
  opacity: .45;
}

.wires path.hot { stroke: var(--wire-hot); stroke-width: 1.8; opacity: 1; }
.wires path.bridge { stroke-dasharray: none; opacity: .55; }
.wires path.use { stroke-dasharray: 4 3; }

/* Nesting levels: a column is the depth from the root; within a column, sibling
   controllers are stacked top to bottom, and methods sit directly under their controller. */
.levels { display: flex; align-items: flex-start; gap: 70px; position: relative; }

.level { display: flex; flex-direction: column; gap: 22px; width: 400px; flex: none; }

.group { display: flex; flex-direction: column; gap: 6px; }

.methods {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-left: 16px;
  padding-left: 13px;
  border-left: 1px dashed var(--line);
}

.lane-title {
  position: sticky;
  top: 0;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .6px;
  color: var(--muted);
  padding-bottom: 2px;
}

/* --------------------------------------------------------------- cards */

.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
}

.card.is-dim { opacity: .22; }
.card.is-hidden { display: none; }
.card.is-hit { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }

.card > .head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  background: var(--panel-2);
  border-bottom: 1px solid transparent;
}

.card.open > .head { border-bottom-color: var(--line-soft); }

/* chevron is a separate collapse button, so it gets its own hit area */
.card > .head .chev {
  color: var(--muted);
  font-size: 9px;
  width: 18px;
  height: 18px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: transform .12s, background .12s, color .12s;
}

.card > .head .chev:hover { background: var(--line-soft); color: var(--accent); }

.card.open > .head .chev { transform: rotate(90deg); }
.card.open > .head .chev:hover { background: var(--line-soft); }

.card > .head .id {
  font-family: var(--font);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card > .head .grow { flex: 1; min-width: 0; }

.card > .body { display: none; padding: 7px 8px; }
.card.open > .body { display: block; }

.sub-title {
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .5px;
  margin: 7px 0 3px;
}

.sub-title:first-child { margin-top: 0; }

.note { color: var(--muted); font-size: 11px; line-height: 1.4; }

/* ------------------------------------------------------------- controllers */

.prefix {
  font-family: var(--font);
  font-size: 10px;
  color: var(--muted);
  background: var(--line-soft);
  border-radius: 4px;
  padding: 1px 5px;
}

/* ------------------------------------------------- data structures */

.schemas { display: flex; flex-direction: column; gap: 4px; }

.card.schema-block { background: var(--panel-2); border-style: dashed; }
.card.schema-block > .head { background: transparent; padding: 4px 6px; }
.card.schema-block > .head .id { font-weight: 500; }
.card.schema-block > .body { padding: 5px 7px; }

/* "highlight" is the block's only action besides collapsing */
.hl {
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 20px;
  color: var(--muted);
  font-size: 10px;
  padding: 1px 7px;
  cursor: pointer;
  flex: none;
}

.hl:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.card.schema-block.is-hit > .head .hl { border-color: var(--accent); color: var(--accent); }

.chip.schema-ref { border-style: dashed; }

/* ---------------------------------------------------------------- chips */

.chips { display: flex; flex-wrap: wrap; gap: 4px; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font);
  font-size: 10.5px;
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 1px 7px;
  cursor: pointer;
  background: var(--panel-2);
  max-width: 100%;
}

.chip span.t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip:hover { border-color: var(--accent); }
.chip.is-hit { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
.chip.shared-1 { background: var(--shared-1); }
.chip.shared-2 { background: var(--shared-2); }
.chip.shared-3 { background: var(--shared-3); }
.chip.kind-hook { border-style: dashed; }
.chip.kind-marker { border-style: dotted; }

.method {
  font-family: var(--font);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  border-radius: 4px;
  padding: 1px 5px;
  color: #fff;
  flex: none;
}

.method.get { background: var(--get); }
.method.post { background: var(--post); }
.method.put { background: var(--put); }
.method.patch { background: var(--patch); }
.method.delete { background: var(--delete); }
.method.options, .method.all { background: var(--muted); }
.method.sockets { background: var(--sockets); }

/* --------------------------------------------------------------- chain */

.chain { display: flex; flex-direction: column; gap: 2px; }

.step {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font);
  font-size: 11px;
  padding: 2px 5px;
  border-radius: 5px;
  cursor: pointer;
  border: 1px solid transparent;
}

.step:hover { border-color: var(--line); }
.step.is-hit { border-color: var(--accent); background: var(--accent-soft); }
.step .n { color: var(--muted); font-size: 10px; width: 16px; flex: none; text-align: right; }
.step .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.step .dot { width: 6px; height: 6px; border-radius: 50%; flex: none; background: var(--wire); }
.step.kind-endpoint .dot, .step.kind-websocket .dot { background: var(--accent); }
.step.kind-nextpoint .dot { background: var(--put); }
.step.kind-marker .dot { background: var(--sockets); }
.step.kind-hook .dot { background: var(--get); }
.step.kind-endpoint .t, .step.kind-websocket .t { font-weight: 600; }

/* --------------------------------------------------------------- tables */

table.grid { width: 100%; border-collapse: collapse; font-family: var(--font); font-size: 11px; }
table.grid td { padding: 2px 4px; border-top: 1px solid var(--line-soft); vertical-align: top; }
table.grid tr:first-child td { border-top: 0; }
table.grid td.k { color: var(--muted); white-space: nowrap; }
table.grid td.v { word-break: break-word; }

.row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-family: var(--font);
  font-size: 11px;
  padding: 2px 4px;
  border-top: 1px solid var(--line-soft);
}

.row:first-child { border-top: 0; }
.row .pname { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .ptype { color: var(--muted); }
.row .req { color: var(--delete); font-weight: 700; }
.row.link { cursor: pointer; }
.row.link:hover { background: var(--accent-soft); }
.row.link .ptype { color: var(--accent); }
.row.is-hit { background: var(--accent-soft); }

.status { font-weight: 700; }
.status.s2 { color: var(--get); }
.status.s4 { color: var(--put); }
.status.s5 { color: var(--delete); }

pre.markers {
  margin: 0;
  font-family: var(--font);
  font-size: 10.5px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--muted);
  max-height: 220px;
  overflow: auto;
}

.empty { color: var(--muted); font-size: 11px; font-style: italic; }
`;

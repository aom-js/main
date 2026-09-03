import { script } from "./script";
import { styles } from "./styles";
import type { RenderOptions, VisualGraph } from "./types";

/**
 * JSON внутри `<script>`: закрывающий тег в данных завершил бы блок, поэтому
 * угловые скобки и разделители строк уходят в экранированном виде.
 */
function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Готовая страница по собранному графу; внешних загрузок нет, файл самодостаточен.
 *
 * В документ уходит весь граф целиком. Смена корня — операция клиента: он читает
 * имя из hash (`#root=ИмяКонтроллера`) и пересобирает вид из уже загруженных данных.
 * Ни query-параметров, ни повторных обращений к серверу здесь нет.
 */
export function renderVisualGraph(graph: VisualGraph, options: RenderOptions = {}): string {
  const settings = { sharedThreshold: options.sharedThreshold ?? 1 };

  const warnings = graph.warnings.length
    ? `<div class="warn">${escapeHtml(graph.warnings.join("; "))}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(graph.title)} — карта API</title>
<style>${styles}</style>
</head>
<body>
<div class="top">
  <h1>${escapeHtml(graph.title)}</h1>
  <span class="sub" id="subtitle"></span>
  <span class="control"><label for="root">корень</label><select id="root"></select></span>
  <span class="control"><label for="search">поиск</label><input id="search" type="search" placeholder="путь, класс, метод, свойство" /></span>
  <button class="btn" id="expand">развернуть всё</button>
  <button class="btn" id="collapse">свернуть всё</button>
  <button class="btn" id="wires-toggle">все связи</button>
  <button class="btn" id="clear" title="Esc">сбросить</button>
  <span class="spacer"></span>
  <button class="btn" id="zoom-out">−</button>
  <span class="sub" id="zoom-label">100%</span>
  <button class="btn" id="zoom-in">+</button>
  <button class="btn" id="zoom-fit">вписать</button>
  <button class="btn" id="zoom-reset">сброс</button>
</div>
<div class="body">
  <aside class="side">
    ${warnings}
    <h2>Сводка</h2>
    <div class="stat-grid" id="stats"></div>
    <h2>Выбор</h2>
    <div class="note" id="selection">ничего не выбрано</div>
    <h2>Общие звенья</h2>
    <div class="rank" id="shared"></div>
    <h2>Легенда</h2>
    <div class="legend">
      <div><i class="swatch" style="background:var(--shared-1)"></i> звено в 2–5 маршрутах</div>
      <div><i class="swatch" style="background:var(--shared-2)"></i> звено в 6–12 маршрутах</div>
      <div><i class="swatch" style="background:var(--shared-3)"></i> звено более чем в 12 маршрутах</div>
      <div><i class="swatch" style="background:var(--accent)"></i> endpoint маршрута</div>
      <div>сплошная линия — связь схем (ER)</div>
      <div>пунктир — использование схемы маршрутом</div>
      <div>▶ — свернуть/развернуть, клик по названию — выделение</div>
      <div>перетаскивание — панорама, ⌘/Ctrl + колесо — зум, Esc — сброс</div>
      <div>корень вида — в адресе после #, вид собирается на клиенте</div>
    </div>
  </aside>
  <div class="viewport" id="viewport">
    <div class="stage" id="stage">
      <svg class="wires" id="wires" xmlns="http://www.w3.org/2000/svg"></svg>
      <div class="lanes" id="lanes"></div>
    </div>
  </div>
</div>
<script type="application/json" id="aom-graph">${embedJson(graph)}</script>
<script type="application/json" id="aom-opts">${embedJson(settings)}</script>
<script>${script}</script>
</body>
</html>`;
}

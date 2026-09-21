/**
 * Client-side script for the visualizer page, inlined into the rendered HTML by `renderVisualGraph`.
 *
 * Written without nested template literals: the whole file is itself a template string, and
 * escaping `` ` `` / `${` inside it would read worse than plain string concatenation.
 */
export const script = String.raw`
(function () {
  "use strict";

  // The document holds the whole graph; graph is the current view, a slice from the chosen root.
  // The root lives in the hash and is parsed right here: the server knows nothing about it.
  var full = JSON.parse(document.getElementById("aom-graph").textContent);
  var opts = JSON.parse(document.getElementById("aom-opts").textContent);

  var graph = full;
  var selection = null;
  var routeIndex = new Map();
  var controllerIndex = new Map();
  var schemaIndex = new Map();
  var middlewareIndex = new Map();

  function reindex() {
    routeIndex = new Map();
    controllerIndex = new Map();
    schemaIndex = new Map();
    middlewareIndex = new Map();
    graph.routes.forEach(function (route) { routeIndex.set(route.id, route); });
    graph.controllers.forEach(function (item) { controllerIndex.set(item.id, item); });
    graph.schemas.forEach(function (item) { schemaIndex.set(item.id, item); });
    graph.middlewares.forEach(function (item) { middlewareIndex.set(item.id, item); });
  }

  /** Controllers reachable from a node via bridges — the boundary of the slice */
  function reachable(rootId) {
    var index = new Map();
    full.controllers.forEach(function (item) { index.set(item.id, item); });
    var out = new Set();
    (function walk(id) {
      if (!id || out.has(id)) return;
      var item = index.get(id);
      if (!item) return;
      out.add(id);
      item.bridges.forEach(function (bridge) { walk(bridge.target); });
    })(rootId);
    return out;
  }

  /**
   * A slice of the graph from an arbitrary node. Paths stay absolute — they are real
   * module addresses, not a tree rebuilt from scratch; only the membership is narrowed.
   */
  function subgraph(rootId) {
    if (!rootId || rootId === full.root || !full.roots.includes(rootId)) {
      return full;
    }
    var reach = reachable(rootId);
    var routes = full.routes.filter(function (route) { return reach.has(route.controller); });
    var routeIds = new Set(routes.map(function (route) { return route.id; }));

    var middlewares = full.middlewares
      .map(function (item) {
        return Object.assign({}, item, {
          usedBy: item.usedBy.filter(function (id) { return routeIds.has(id); })
        });
      })
      .filter(function (item) { return item.usedBy.length; })
      .sort(function (a, b) { return b.usedBy.length - a.usedBy.length; });

    var byId = new Map();
    full.schemas.forEach(function (item) { byId.set(item.id, item); });
    var names = new Set();
    (function collect(list) {
      list.forEach(function (name) {
        if (names.has(name)) return;
        names.add(name);
        var schema = byId.get(name);
        if (schema) collect(schema.refs.map(function (edge) { return edge.target; }));
      });
    })(routes.reduce(function (acc, route) { return acc.concat(route.schemas); }, []));

    var schemas = full.schemas
      .filter(function (item) { return names.has(item.id); })
      .map(function (item) {
        return Object.assign({}, item, {
          usedBy: item.usedBy.filter(function (id) { return routeIds.has(id); }),
          referencedBy: item.referencedBy.filter(function (id) { return names.has(id); })
        });
      });

    var controllers = full.controllers
      .filter(function (item) { return reach.has(item.id); })
      .map(function (item) {
        return Object.assign({}, item, {
          routes: item.routes.filter(function (id) { return routeIds.has(id); })
        });
      });

    return Object.assign({}, full, {
      root: rootId,
      controllers: controllers,
      routes: routes,
      middlewares: middlewares,
      schemas: schemas,
      stats: {
        controllers: controllers.length,
        routes: routes.filter(function (route) { return !route.isWebsocket; }).length,
        websockets: routes.filter(function (route) { return route.isWebsocket; }).length,
        middlewares: middlewares.length,
        schemas: schemas.length,
        shared: middlewares.filter(function (item) { return item.usedBy.length > 1; }).length
      }
    });
  }

  function rootFromHash() {
    var match = /(?:^|&)root=([^&]+)/.exec(String(window.location.hash).replace(/^#/, ""));
    return match ? decodeURIComponent(match[1]) : full.root;
  }

  // ------------------------------------------------------------- markup

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === undefined || value === null || value === false) return;
        if (key === "text") node.textContent = String(value);
        else if (key === "class") node.className = value;
        else node.setAttribute(key, String(value));
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === undefined || child === null || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (one) { one && node.appendChild(one); });
      else if (typeof child === "string") node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function sharedClass(count) {
    if (count > 12) return "shared-3";
    if (count > 5) return "shared-2";
    if (count > opts.sharedThreshold) return "shared-1";
    return "";
  }

  /** Chain-link chip: the color reflects how many routes the link is reused in */
  function middlewareChip(id) {
    var node = middlewareIndex.get(id);
    var count = node ? node.usedBy.length : 0;
    var chip = el("div", {
      "class": "chip kind-" + (node ? node.kind : "middleware") + " " + sharedClass(count),
      "data-key": "mw:" + id,
      title: (node && node.title ? node.title + " — " : "") + id + " (маршрутов: " + count + ")"
    }, el("span", { "class": "t", text: id }));
    if (count > 1) chip.appendChild(el("span", { "class": "count " + sharedClass(count), text: count }));
    chip.addEventListener("click", function (event) { event.stopPropagation(); select("mw", id); });
    return chip;
  }

  function schemaChip(name) {
    var chip = el("div", { "class": "chip schema-ref" },
      el("span", { "class": "t", text: name }));
    chip.addEventListener("click", function (event) { event.stopPropagation(); select("schema", name); });
    return chip;
  }

  // Two distinct operations on the card header, split across elements:
  // the chevron collapses/expands, everything else selects. The chevron's click
  // does not bubble, so a block can be collapsed without disturbing the current selection.
  function card(key, head, body, openByDefault) {
    var chevron = el("i", {
      "class": "chev",
      title: "свернуть / развернуть",
      "aria-label": "свернуть / развернуть",
      text: "\u25B6"
    });
    var headNode = el("div", { "class": "head" }, chevron, head);
    var node = el("div", { "class": "card" + (openByDefault ? " open" : ""), "data-key": key },
      headNode, el("div", { "class": "body" }, body));
    chevron.addEventListener("click", function (event) {
      event.stopPropagation();
      node.classList.toggle("open");
      schedule();
    });
    return node;
  }

  function section(title, content) {
    if (!content || (Array.isArray(content) && !content.length)) return null;
    return el("div", null, el("div", { "class": "sub-title", text: title }), content);
  }

  // -------------------------------------------------------- controllers

  function controllerCard(item, prefix) {
    var head = el("div", { "class": "grow" },
      el("span", { "class": "id", text: item.id }),
      " ",
      el("span", { "class": "prefix", text: prefix || "/" }));
    var counts = el("span", { "class": "count", text: item.routes.length + " м." });

    var body = el("div", null,
      item.title || item.description
        ? el("div", { "class": "note", text: [item.title, item.description].filter(Boolean).join(" — ") })
        : null,
      item.parent ? section("наследует", el("div", { "class": "note", text: item.parent })) : null,
      section("middleware до", item.pre.length ? el("div", { "class": "chips" }, item.pre.map(middlewareChip)) : null),
      section("middleware после", item.post.length ? el("div", { "class": "chips" }, item.post.map(middlewareChip)) : null),
      section("хуки инстанса", item.hooks.length ? el("div", { "class": "chips" }, item.hooks.map(middlewareChip)) : null),
      section("маркеры", item.markers.length ? el("div", { "class": "chips" }, item.markers.map(middlewareChip)) : null),
      section("прочие звенья класса", otherMembers(item).length
        ? el("div", { "class": "chips" }, otherMembers(item).map(function (member) {
            return middlewareChip(member.id);
          }))
        : null),
      section("бриджи", item.bridges.length
        ? el("div", { "class": "chips" }, item.bridges.map(function (bridge) {
            var chip = el("div", { "class": "chip", "data-key": "bridge:" + item.id + ">" + bridge.target },
              el("span", { "class": "prefix", text: bridge.prefix }),
              el("span", { "class": "t", text: bridge.target }));
            chip.addEventListener("click", function (event) { event.stopPropagation(); select("controller", bridge.target); });
            return chip;
          }))
        : null));

    var node = card("controller:" + item.id, [head, counts], body, true);
    node.setAttribute("data-search", (item.id + " " + prefix + " " + (item.title || "")).toLowerCase());
    node.addEventListener("click", function (event) {
      if (event.target.closest(".chip, .step, .row.link")) return;
      select("controller", item.id);
    });
    return node;
  }

  /**
   * Decorated class members not shown in the other sections: middleware
   * declared but not attached anywhere is visible only here.
   */
  function otherMembers(item) {
    var shown = new Set(item.pre.concat(item.post, item.hooks, item.markers));
    item.routes.forEach(function (id) {
      var route = routeIndex.get(id);
      if (route) shown.add(route.endpoint);
    });
    return item.members.filter(function (member) { return !shown.has(member.id); });
  }

  /**
   * Layout by nesting level: a column is the depth from the root; within a
   * column, sibling controllers are stacked top to bottom. The traversal is depth-first, so
   * one parent's children end up next to each other in the same column.
   */
  function layoutLevels() {
    var levels = [];
    var placed = new Set();

    (function walk(id, depth) {
      if (!id || placed.has(id)) return;
      var item = controllerIndex.get(id);
      if (!item) return;
      placed.add(id);
      if (!levels[depth]) levels[depth] = [];
      levels[depth].push(id);
      item.bridges.forEach(function (bridge) { walk(bridge.target, depth + 1); });
    })(graph.root, 0);

    // controllers that no bridge from the root leads to (e.g. ones that declared an
    // endpoint through inheritance) — their own column at the end, not mixed in
    var orphans = graph.controllers
      .filter(function (item) { return !placed.has(item.id); })
      .map(function (item) { return item.id; });
    if (orphans.length) levels.push(orphans);

    return levels;
  }

  /** A controller together with its methods — they live directly below it */
  function controllerGroup(item) {
    var group = el("div", { "class": "group" }, controllerCard(item, item.prefixes[0] || "/"));
    var methods = el("div", { "class": "methods" });
    item.routes.forEach(function (id) {
      var route = routeIndex.get(id);
      if (route) methods.appendChild(methodCard(route));
    });
    if (!item.routes.length) {
      methods.appendChild(el("div", { "class": "empty", text: "методов нет" }));
    }
    group.appendChild(methods);
    return group;
  }

  // ------------------------------------------------------------ routes

  function statusClass(status) {
    var head = String(status).charAt(0);
    return head === "2" ? "s2" : head === "4" ? "s4" : head === "5" ? "s5" : "";
  }

  function schemaValue(schema) {
    if (schema.ref) {
      var row = el("span", { "class": "ptype", text: schema.label });
      row.style.cursor = "pointer";
      row.addEventListener("click", function (event) { event.stopPropagation(); select("schema", schema.ref); });
      return row;
    }
    return el("span", { "class": "ptype", text: schema.label });
  }

  function methodCard(route) {
    var head = el("div", { "class": "grow" },
      el("span", { "class": "method " + route.method, text: route.method }),
      " ",
      el("span", { "class": "id", text: route.path }));

    var chain = el("div", { "class": "chain" }, route.chain.map(function (step) {
      var node = middlewareIndex.get(step.id);
      var count = node ? node.usedBy.length : 0;
      var row = el("div", {
        "class": "step kind-" + step.kind + " " + sharedClass(count),
        "data-key": (step.kind === "endpoint" || step.kind === "websocket") ? "endpoint:" + step.id : "mw:" + step.id,
        title: step.title || step.id
      },
        el("span", { "class": "n", text: step.index }),
        el("span", { "class": "dot" }),
        el("span", { "class": "t", text: step.id }),
        count > 1 ? el("span", { "class": "count " + sharedClass(count), text: count }) : null);
      row.addEventListener("click", function (event) {
        event.stopPropagation();
        if (step.kind === "endpoint" || step.kind === "websocket") select("route", route.id);
        else select("mw", step.id);
      });
      return row;
    }));

    var parameters = route.parameters.length
      ? el("div", null, route.parameters.map(function (parameter) {
          return el("div", { "class": "row" },
            el("span", { "class": "prefix", text: parameter.in }),
            el("span", { "class": "pname", text: parameter.name }),
            parameter.required ? el("span", { "class": "req", text: "*" }) : null,
            schemaValue(parameter.schema));
        }))
      : null;

    var responses = route.responses.length
      ? el("div", null, route.responses.map(function (response) {
          var row = el("div", { "class": "row" + (response.schema.ref ? " link" : ""), "data-key": response.schema.ref ? "route-ref:" + route.id + ">" + response.schema.ref : null },
            el("span", { "class": "status " + statusClass(response.status), text: response.status }),
            el("span", { "class": "pname", text: response.description || "" }),
            schemaValue(response.schema));
          if (response.schema.ref) {
            row.addEventListener("click", function (event) { event.stopPropagation(); select("schema", response.schema.ref); });
          }
          return row;
        }))
      : null;

    var body = el("div", null,
      el("div", { "class": "note", text: [route.title, route.description].filter(Boolean).join(" — ") || route.operationId }),
      route.tags.length ? el("div", { "class": "note", text: "теги: " + route.tags.join(", ") }) : null,
      section("цепочка исполнения", chain),
      section("параметры", parameters),
      route.requestBody
        ? section("тело запроса", el("div", { "class": "row" },
            el("span", { "class": "prefix", text: route.requestBody.contentType }),
            el("span", { "class": "pname", text: route.requestBody.description || "" }),
            schemaValue(route.requestBody.schema)))
        : null,
      section("ответы", responses),
      section("защита", route.security.length ? el("div", { "class": "chips" }, route.security.map(function (name) {
        return el("div", { "class": "chip" }, el("span", { "class": "t", text: name }));
      })) : null),
      section("структуры данных", route.schemas.length
        ? el("div", { "class": "schemas" }, route.schemas.map(function (name) {
            return schemaBlock(route, name);
          }))
        : null),
      section("маркеры", Object.keys(route.markers).length
        ? el("pre", { "class": "markers", text: JSON.stringify(route.markers, null, 2) })
        : null));

    var node = card("route:" + route.id, head, body, false);
    node.classList.add("method-card");
    node.setAttribute("data-search",
      (route.method + " " + route.path + " " + route.operationId + " " + (route.title || "") + " " +
        route.chain.map(function (step) { return step.id; }).join(" ") + " " +
        route.schemas.join(" ")).toLowerCase());
    node.addEventListener("click", function (event) {
      if (event.target.closest(".chip, .step, .row.link, .schema-block")) return;
      select("route", route.id);
    });
    return node;
  }

  // ------------------------------------------------- data structures

  /**
   * A data structure inside a method: there is no single schema list on the page, each
   * occurrence is shown where it's used. The chevron reveals its contents, the "подсветить"
   * (highlight) button finds this same structure in all the other methods.
   *
   * data-key is the same across every occurrence of one schema — that's what the highlight
   * relies on; data-occ is unique and is needed to connect occurrences with wires.
   */
  function schemaBlock(route, name) {
    var schema = schemaIndex.get(name);
    if (!schema) {
      return el("div", { "class": "empty", text: name + " — вне текущего среза" });
    }

    var occurrences = schema.usedBy.length;

    var highlight = el("button", {
      "class": "hl",
      type: "button",
      title: "показать эту структуру в остальных методах"
    }, "подсветить");
    highlight.addEventListener("click", function (event) {
      event.stopPropagation();
      select("schema", name);
    });

    var head = el("div", { "class": "grow" },
      el("span", { "class": "id", text: name }),
      occurrences > 1 ? el("span", { "class": "count " + sharedClass(occurrences), text: occurrences }) : null);

    var rows = schema.properties.length
      ? el("div", null, schema.properties.map(function (property) {
          var row = el("div", {
            "class": "row" + (property.ref ? " link" : ""),
            title: property.description || ""
          },
            el("span", { "class": "pname", text: property.name }),
            property.required ? el("span", { "class": "req", text: "*" }) : null,
            el("span", { "class": "ptype", text: property.type + (property.nullable ? " | null" : "") }));
          // a nested structure is selected the same way the "подсветить" (highlight) button does it
          if (property.ref) {
            row.addEventListener("click", function (event) {
              event.stopPropagation();
              select("schema", property.ref);
            });
          }
          return row;
        }))
      : el("div", { "class": "empty", text: "свойств нет" });

    var body = el("div", null,
      schema.description ? el("div", { "class": "note", text: schema.description }) : null,
      rows,
      schema.referencedBy.length
        ? section("ссылаются", el("div", { "class": "chips" }, schema.referencedBy.map(schemaChip)))
        : null);

    var node = card("schema:" + name, [head, highlight], body, false);
    node.classList.add("schema-block");
    node.setAttribute("data-occ", route.id + "|" + name);
    return node;
  }

  // ------------------------------------------------------------- mounting

  var lanes = document.getElementById("lanes");
  var sharedList = document.getElementById("shared");

  var STATS = [
    ["controllers", "контроллеров"],
    ["routes", "маршрутов"],
    ["middlewares", "звеньев"],
    ["schemas", "схем"],
    ["websockets", "сокетов"],
    ["shared", "общих звеньев"]
  ];

  /** Rebuild everything that depends on the current slice */
  function renderView() {
    selection = null;

    lanes.textContent = "";

    var levels = layoutLevels();
    if (!levels.length) {
      lanes.appendChild(el("div", { "class": "empty", text: "контроллеров нет" }));
    }
    levels.forEach(function (ids, depth) {
      var column = el("div", { "class": "level" },
        el("div", { "class": "lane-title", text: depth === 0 ? "корень" : "уровень " + depth }));
      ids.forEach(function (id) {
        var item = controllerIndex.get(id);
        if (item) column.appendChild(controllerGroup(item));
      });
      lanes.appendChild(column);
    });

    var stats = document.getElementById("stats");
    stats.textContent = "";
    STATS.forEach(function (pair) {
      stats.appendChild(el("div", { "class": "stat" },
        el("b", { text: graph.stats[pair[0]] }),
        el("span", { text: pair[1] })));
    });

    sharedList.textContent = "";
    graph.middlewares
      .filter(function (item) { return item.usedBy.length > 1; })
      .slice(0, 60)
      .forEach(function (item) {
        var row = el("div", { "class": "rank-item", "data-key": "rank:" + item.id, title: item.id },
          el("span", { "class": "name", text: item.id }),
          el("span", { "class": "count " + sharedClass(item.usedBy.length), text: item.usedBy.length }));
        row.addEventListener("click", function () { select("mw", item.id); });
        sharedList.appendChild(row);
      });
    if (!sharedList.children.length) {
      sharedList.appendChild(el("div", { "class": "empty", text: "переиспользуемых звеньев нет" }));
    }

    document.getElementById("subtitle").textContent =
      "корень " + graph.root + (graph.root === full.root ? "" : " (срез)") + " · " + full.builtAt;

    var input = document.getElementById("search");
    if (input.value) input.dispatchEvent(new Event("input", { bubbles: true }));

    applySelection();
  }

  function setRoot(rootId) {
    graph = subgraph(rootId);
    reindex();
    renderView();
    var select = document.getElementById("root");
    if (select.value !== graph.root) select.value = graph.root;
  }

  // -------------------------------------------------------------- selection

  function schemaClosure(name, out) {
    if (out.has(name)) return out;
    out.add(name);
    var schema = schemaIndex.get(name);
    if (!schema) return out;
    schema.refs.forEach(function (edge) { schemaClosure(edge.target, out); });
    schema.referencedBy.forEach(function (id) {
      if (!out.has(id)) { out.add(id); }
    });
    return out;
  }

  function hitsFor(type, id) {
    var hits = new Set();
    if (type === "route") {
      var route = routeIndex.get(id);
      if (!route) return hits;
      hits.add("route:" + id);
      hits.add("controller:" + route.controller);
      route.chain.forEach(function (step) { hits.add("mw:" + step.id); hits.add("endpoint:" + step.id); });
      var schemas = new Set();
      route.schemas.forEach(function (name) { schemaClosure(name, schemas); });
      schemas.forEach(function (name) { hits.add("schema:" + name); });
    } else if (type === "mw") {
      hits.add("mw:" + id);
      hits.add("rank:" + id);
      var node = middlewareIndex.get(id);
      if (node) {
        node.usedBy.forEach(function (routeId) {
          hits.add("route:" + routeId);
          var target = routeIndex.get(routeId);
          if (target) hits.add("controller:" + target.controller);
        });
        node.origins.forEach(function (origin) { hits.add("controller:" + origin.split(".")[0]); });
      }
    } else if (type === "schema") {
      var closure = schemaClosure(id, new Set());
      closure.forEach(function (name) {
        hits.add("schema:" + name);
        var schema = schemaIndex.get(name);
        if (schema) schema.usedBy.forEach(function (routeId) { hits.add("route:" + routeId); });
      });
    } else if (type === "controller") {
      hits.add("controller:" + id);
      var item = controllerIndex.get(id);
      if (item) {
        item.bridges.forEach(function (bridge) { hits.add("controller:" + bridge.target); });
        item.parents.forEach(function (parent) { hits.add("controller:" + parent); });
        item.routes.forEach(function (routeId) { hits.add("route:" + routeId); });
        item.pre.concat(item.post, item.hooks, item.markers).forEach(function (mw) { hits.add("mw:" + mw); });
      }
    }
    return hits;
  }

  function select(type, id) {
    if (selection && selection.type === type && selection.id === id) selection = null;
    else selection = { type: type, id: id };
    applySelection();
  }

  function applySelection() {
    var hits = selection ? hitsFor(selection.type, selection.id) : null;
    var label = document.getElementById("selection");
    label.textContent = selection ? selection.type + " · " + selection.id : "ничего не выбрано";

    document.querySelectorAll("[data-key]").forEach(function (node) {
      var key = node.getAttribute("data-key");
      var hit = !!hits && hits.has(key);
      node.classList.toggle("is-hit", hit);
      if (node.classList.contains("card")) {
        node.classList.toggle("is-dim", !!hits && !hit);
        // expand the highlighted surroundings, but don't fight the user's own click
        if (hit && !node.classList.contains("open")) {
          node.classList.add("open");
        }
      }
    });

    if (selection) {
      var target = document.querySelector(
        '[data-key="' + cssEscape(selection.type + ":" + selection.id) + '"].card'
      );
      // pan to the selection only if it's not visible: otherwise the canvas would slide
      // out from under the cursor right on click, and the next click would miss the card
      if (target && !inView(target)) focusOn(target);
    }
    schedule();
  }

  function cssEscape(value) { return value.replace(/["\\]/g, "\\$&"); }

  // -------------------------------------------------------------- search

  var searchInput = document.getElementById("search");
  searchInput.addEventListener("input", function () {
    var needle = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".card[data-search]").forEach(function (node) {
      node.classList.toggle("is-hidden", !!needle && node.getAttribute("data-search").indexOf(needle) < 0);
    });
    schedule();
  });

  document.getElementById("expand").addEventListener("click", function () {
    document.querySelectorAll(".card").forEach(function (node) { node.classList.add("open"); });
    schedule();
  });

  document.getElementById("collapse").addEventListener("click", function () {
    document.querySelectorAll(".card").forEach(function (node) { node.classList.remove("open"); });
    schedule();
  });

  document.getElementById("clear").addEventListener("click", function () {
    selection = null;
    searchInput.value = "";
    document.querySelectorAll(".card.is-hidden").forEach(function (node) { node.classList.remove("is-hidden"); });
    applySelection();
  });

  // Esc does the same reset as the button: selection and search
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // Esc from inside the search field must first blur it
    if (document.activeElement === searchInput) searchInput.blur();
    event.preventDefault();
    document.getElementById("clear").click();
  });

  var allWires = false;
  var wiresButton = document.getElementById("wires-toggle");
  wiresButton.addEventListener("click", function () {
    allWires = !allWires;
    wiresButton.classList.toggle("on", allWires);
    schedule();
  });

  // The view root is a client-side value: we change the hash, the page is never re-requested
  var rootSelect = document.getElementById("root");
  full.roots.forEach(function (name) {
    rootSelect.appendChild(el("option", {
      value: name,
      text: name + (name === full.root ? " (весь модуль)" : ""),
    }));
  });

  rootSelect.addEventListener("change", function () {
    var next = rootSelect.value;
    var hash = next === full.root ? "" : "#root=" + encodeURIComponent(next);
    if (String(window.location.hash) === hash || (!hash && !window.location.hash)) {
      setRoot(next);
    } else {
      // the hashchange handler finishes the rest — there's still only one source of state
      window.location.hash = hash;
    }
  });

  window.addEventListener("hashchange", function () { setRoot(rootFromHash()); });

  // ------------------------------------------------------- pan and zoom

  var viewport = document.getElementById("viewport");
  var stage = document.getElementById("stage");
  var wires = document.getElementById("wires");

  var view = { x: 20, y: 20, scale: 1 };

  /** Keep the canvas in view: after collapsing blocks it would otherwise drift off into empty space */
  function clampView() {
    var height = stage.offsetHeight * view.scale;
    var width = stage.offsetWidth * view.scale;
    var box = viewport.getBoundingClientRect();
    view.y = Math.max(Math.min(view.y, box.height - 80), Math.min(20, box.height - height));
    view.x = Math.max(Math.min(view.x, box.width - 120), Math.min(20, box.width - width));
  }

  function applyView() {
    stage.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.scale + ")";
    document.getElementById("zoom-label").textContent = Math.round(view.scale * 100) + "%";
  }

  viewport.addEventListener("wheel", function (event) {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      var rect = viewport.getBoundingClientRect();
      var px = event.clientX - rect.left;
      var py = event.clientY - rect.top;
      var next = Math.min(2.5, Math.max(0.05, view.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
      view.x = px - (px - view.x) * (next / view.scale);
      view.y = py - (py - view.y) * (next / view.scale);
      view.scale = next;
    } else {
      view.x -= event.deltaX;
      view.y -= event.deltaY;
    }
    applyView();
  }, { passive: false });

  // Panning deliberately skips setPointerCapture: capturing the pointer would redirect the
  // subsequent click to the capturing element, and clicks on cards would never reach their
  // own handlers at all. Move and release are listened for on window instead — that gives
  // the same effect (the cursor can leave the canvas) without breaking clicks.
  var drag = null;
  viewport.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
  });

  window.addEventListener("pointermove", function (event) {
    if (!drag) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    // threshold: an ordinary click almost always jitters by one or two pixels
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      viewport.classList.add("dragging");
    }
    if (!drag.moved) return;
    view.x = drag.ox + dx;
    view.y = drag.oy + dy;
    applyView();
  });

  // Suppressing the click after a drag uses a flag, not a one-shot listener: a one-shot
  // listener stayed armed when the post-drag click never actually arrived, and then ate
  // the next real click on a card.
  var suppressClick = false;
  viewport.addEventListener("click", function (event) {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);

  function endDrag() {
    if (!drag) return;
    suppressClick = drag.moved;
    drag = null;
    viewport.classList.remove("dragging");
  }

  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);

  document.getElementById("zoom-in").addEventListener("click", function () {
    view.scale = Math.min(2.5, view.scale * 1.2); applyView();
  });
  document.getElementById("zoom-out").addEventListener("click", function () {
    view.scale = Math.max(0.05, view.scale / 1.2); applyView();
  });
  document.getElementById("zoom-reset").addEventListener("click", function () {
    view.x = 20; view.y = 20; view.scale = 1; applyView();
  });

  /** Fit the whole canvas into the window: on a module with a hundred routes, you'd otherwise never see the big picture */
  document.getElementById("zoom-fit").addEventListener("click", function () {
    var box = viewport.getBoundingClientRect();
    var fit = Math.min(
      (box.width - 40) / stage.offsetWidth,
      (box.height - 40) / stage.offsetHeight
    );
    view.scale = Math.min(2.5, Math.max(0.05, fit));
    view.x = (box.width - stage.offsetWidth * view.scale) / 2;
    view.y = 20;
    applyView();
    schedule();
  });

  /** Whether a card is at least partially visible in the canvas viewport */
  function inView(node) {
    var box = viewport.getBoundingClientRect();
    var rect = node.getBoundingClientRect();
    return (
      rect.right > box.left + 8 &&
      rect.left < box.right - 8 &&
      rect.bottom > box.top + 8 &&
      rect.top < box.bottom - 8
    );
  }

  function focusOn(node) {
    var stageRect = stage.getBoundingClientRect();
    var rect = node.getBoundingClientRect();
    var viewRect = viewport.getBoundingClientRect();
    var x = (rect.left - stageRect.left) / view.scale;
    var y = (rect.top - stageRect.top) / view.scale;
    view.x = viewRect.width / 2 - (x + rect.width / (2 * view.scale)) * view.scale;
    view.y = viewRect.height / 3 - y * view.scale;
    clampView();
    applyView();
  }

  // --------------------------------------------------------------- wires

  var pending = null;
  var fallback = null;

  function flush() {
    if (pending) { cancelAnimationFrame(pending); pending = null; }
    if (fallback) { clearTimeout(fallback); fallback = null; }
    clampView();
    applyView();
    drawWires();
  }

  /**
   * Redraw on the next frame, but with a fallback timer: in a hidden tab
   * requestAnimationFrame never fires at all, and the wires layer would stay
   * stale until focus returns. Whichever fires first clears the other.
   */
  function schedule() {
    if (pending) cancelAnimationFrame(pending);
    if (fallback) clearTimeout(fallback);
    pending = requestAnimationFrame(flush);
    fallback = setTimeout(flush, 250);
  }

  function visible(node) {
    return !!node && !!node.offsetParent && !node.closest(".is-hidden");
  }

  /** A node's anchor point in canvas coordinates */
  function anchorNode(node) {
    if (!visible(node)) return null;
    var stageRect = stage.getBoundingClientRect();
    var rect = node.getBoundingClientRect();
    return {
      left: (rect.left - stageRect.left) / view.scale,
      right: (rect.right - stageRect.left) / view.scale,
      top: (rect.top - stageRect.top) / view.scale,
      middle: (rect.top + rect.height / 2 - stageRect.top) / view.scale
    };
  }

  function controllerAnchor(id) {
    return anchorNode(document.querySelector('.card[data-key="controller:' + cssEscape(id) + '"]'));
  }

  /**
   * Occurrences of a data structure on the canvas. A collapsed method doesn't show its own
   * block — in that case, anchor to the method's card instead, so the wire still leads somewhere.
   */
  function occurrences(name) {
    var out = [];
    document.querySelectorAll('.schema-block[data-occ$="|' + cssEscape(name) + '"]').forEach(function (node) {
      if (visible(node)) out.push(node);
      else {
        var method = node.closest(".method-card");
        if (visible(method) && out.indexOf(method) < 0) out.push(method);
      }
    });
    return out;
  }

  function path(from, to) {
    var x1 = from.right, y1 = from.middle, x2 = to.left, y2 = to.middle;
    var span = Math.max(46, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 4);
    if (x2 < x1 + 20) {
      // target is left of the source — route around the right, so the line doesn't cut through a card
      var out = Math.max(from.right, to.right) + 34;
      return "M" + x1 + "," + y1 + " C" + out + "," + y1 + " " + out + "," + y2 + " " + x2 + "," + y2;
    }
    return "M" + x1 + "," + y1 + " C" + (x1 + span) + "," + y1 + " " + (x2 - span) + "," + y2 + " " + x2 + "," + y2;
  }

  function drawWires() {
    while (wires.firstChild) wires.removeChild(wires.firstChild);
    wires.setAttribute("width", stage.offsetWidth);
    wires.setAttribute("height", stage.offsetHeight);

    var hits = selection ? hitsFor(selection.type, selection.id) : null;
    var fragment = document.createDocumentFragment();

    function line(from, to, kind, hot) {
      if (!from || !to) return;
      var node = document.createElementNS("http://www.w3.org/2000/svg", "path");
      node.setAttribute("d", path(from, to));
      node.setAttribute("class", kind + (hot ? " hot" : ""));
      fragment.appendChild(node);
    }

    // bridges: the picture's permanent skeleton — it's exactly what drives the level layout
    graph.controllers.forEach(function (item) {
      var from = controllerAnchor(item.id);
      if (!from) return;
      item.bridges.forEach(function (bridge) {
        var hot = !!hits && hits.has("controller:" + item.id) && hits.has("controller:" + bridge.target);
        line(from, controllerAnchor(bridge.target), "bridge", hot);
      });
    });

    // repeated data structure occurrences: for the selected schema, or for all of them at once
    var names = [];
    if (selection && selection.type === "schema") {
      names = [selection.id];
    } else if (allWires) {
      names = graph.schemas
        .filter(function (item) { return item.usedBy.length > 1; })
        .map(function (item) { return item.id; });
    }

    names.forEach(function (name) {
      var nodes = occurrences(name);
      for (var i = 1; i < nodes.length; i++) {
        line(anchorNode(nodes[i - 1]), anchorNode(nodes[i]), "use", true);
      }
    });

    wires.appendChild(fragment);
  }

  window.addEventListener("resize", schedule);
  applyView();
  setRoot(rootFromHash());
})();
`;

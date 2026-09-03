/**
 * Клиентский сценарий страницы визуализатора.
 *
 * Пишется без шаблонных литералов: файл сам является шаблонной строкой, и
 * экранирование `\`` / `\${` в нём читается хуже, чем конкатенация.
 */
export const script = String.raw`
(function () {
  "use strict";

  // В документе лежит весь граф; graph — текущий вид, срез от выбранного корня.
  // Корень живёт в hash и разбирается здесь: сервер о нём ничего не знает.
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

  /** Контроллеры, достижимые от узла по бриджам — граница среза */
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
   * Срез графа от произвольного узла. Пути остаются абсолютными — это реальные
   * адреса модуля, а не пересборка дерева с нуля; сужается только состав.
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

  // ------------------------------------------------------------- вёрстка

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

  /** Чип звена цепочки: цвет отражает, во скольких маршрутах звено переиспользовано */
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
    var chip = el("div", { "class": "chip", "data-key": "schema:" + name },
      el("span", { "class": "t", text: name }));
    chip.addEventListener("click", function (event) { event.stopPropagation(); select("schema", name); });
    return chip;
  }

  // Две разные операции на шапке карточки, разведённые по элементам:
  // шеврон сворачивает и разворачивает, всё остальное — выделяет. Клик по шеврону
  // не всплывает, поэтому свернуть блок можно, не сбив текущее выделение.
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

  // -------------------------------------------------------- контроллеры

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
      section("маршруты", item.routes.length
        ? el("div", { "class": "chips" }, item.routes.map(function (id) {
            var route = routeIndex.get(id);
            var chip = el("div", { "class": "chip", "data-key": "route-link:" + id },
              el("span", { "class": "method " + route.method, text: route.method }),
              el("span", { "class": "t", text: route.path }));
            chip.addEventListener("click", function (event) { event.stopPropagation(); select("route", id); });
            return chip;
          }))
        : el("div", { "class": "empty", text: "собственных маршрутов нет" })),
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

    var node = card("controller:" + item.id, [head, counts], body, item.depth < 2);
    node.setAttribute("data-search", (item.id + " " + prefix + " " + (item.title || "")).toLowerCase());
    node.addEventListener("click", function (event) {
      if (event.target.closest(".chip, .step, .row.link")) return;
      select("controller", item.id);
    });
    return node;
  }

  /**
   * Декорированные члены класса, не показанные в остальных секциях: middleware,
   * объявленные, но никуда не прицепленные, видно только здесь.
   */
  function otherMembers(item) {
    var shown = new Set(item.pre.concat(item.post, item.hooks, item.markers));
    item.routes.forEach(function (id) {
      var route = routeIndex.get(id);
      if (route) shown.add(route.endpoint);
    });
    return item.members.filter(function (member) { return !shown.has(member.id); });
  }

  function controllerTree(id, prefix, stack) {
    var item = controllerIndex.get(id);
    if (!item) return null;
    if (stack.indexOf(id) >= 0) {
      var repeat = el("div", { "class": "repeat", text: "\u21BA " + id + " (уже раскрыт выше)" });
      repeat.addEventListener("click", function () { select("controller", id); });
      return repeat;
    }
    var nextStack = stack.concat([id]);
    var wrap = el("div", { "class": "tree" }, controllerCard(item, prefix));
    if (item.bridges.length) {
      var kids = el("div", { "class": "kids" });
      item.bridges.forEach(function (bridge) {
        var child = controllerTree(bridge.target, joinPrefix(prefix, bridge.prefix), nextStack);
        if (child) kids.appendChild(child);
      });
      wrap.appendChild(kids);
    }
    return wrap;
  }

  function joinPrefix(prefix, next) {
    var parts = (prefix + "/" + next).split("/").filter(Boolean);
    return "/" + parts.join("/");
  }

  // ------------------------------------------------------------ маршруты

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

  function routeCard(route) {
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
      section("схемы", route.schemas.length ? el("div", { "class": "chips" }, route.schemas.map(schemaChip)) : null),
      section("маркеры", Object.keys(route.markers).length
        ? el("pre", { "class": "markers", text: JSON.stringify(route.markers, null, 2) })
        : null));

    var node = card("route:" + route.id, head, body, false);
    node.setAttribute("data-search",
      (route.method + " " + route.path + " " + route.operationId + " " + (route.title || "") + " " +
        route.chain.map(function (step) { return step.id; }).join(" ")).toLowerCase());
    node.addEventListener("click", function (event) {
      if (event.target.closest(".chip, .step, .row.link")) return;
      select("route", route.id);
    });
    return node;
  }

  // -------------------------------------------------------------- схемы

  function schemaCard(schema) {
    var head = el("div", { "class": "grow" }, el("span", { "class": "id", text: schema.id }));
    var counts = el("span", { "class": "count", text: schema.properties.length + " п." });

    var rows = schema.properties.length
      ? el("div", null, schema.properties.map(function (property) {
          var row = el("div", {
            "class": "row" + (property.ref ? " link" : ""),
            "data-key": property.ref ? "prop:" + schema.id + ">" + property.name : null,
            title: property.description || ""
          },
            el("span", { "class": "pname", text: property.name }),
            property.required ? el("span", { "class": "req", text: "*" }) : null,
            el("span", { "class": "ptype", text: property.type + (property.nullable ? " | null" : "") }));
          if (property.ref) {
            row.addEventListener("click", function (event) { event.stopPropagation(); select("schema", property.ref); });
          }
          return row;
        }))
      : el("div", { "class": "empty", text: "свойств нет" });

    var body = el("div", null,
      schema.description ? el("div", { "class": "note", text: schema.description }) : null,
      rows,
      section("используется маршрутами", schema.usedBy.length
        ? el("div", { "class": "chips" }, schema.usedBy.map(function (id) {
            var route = routeIndex.get(id);
            var chip = el("div", { "class": "chip" },
              el("span", { "class": "method " + route.method, text: route.method }),
              el("span", { "class": "t", text: route.path }));
            chip.addEventListener("click", function (event) { event.stopPropagation(); select("route", id); });
            return chip;
          }))
        : el("div", { "class": "empty", text: "напрямую не используется" })),
      section("ссылаются", schema.referencedBy.length
        ? el("div", { "class": "chips" }, schema.referencedBy.map(schemaChip))
        : null));

    var node = card("schema:" + schema.id, [head, counts], body, true);
    node.setAttribute("data-search",
      (schema.id + " " + schema.properties.map(function (one) { return one.name; }).join(" ")).toLowerCase());
    node.addEventListener("click", function (event) {
      if (event.target.closest(".chip, .step, .row.link")) return;
      select("schema", schema.id);
    });
    return node;
  }

  // ------------------------------------------------------------- монтаж

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

  /** Пересобрать всё, что зависит от текущего среза */
  function renderView() {
    selection = null;

    lanes.textContent = "";

    var controllersLane = el("div", { "class": "lane" }, el("div", { "class": "lane-title", text: "Контроллеры" }));
    var tree = controllerTree(graph.root, rootPrefix(), []);
    controllersLane.appendChild(tree || el("div", { "class": "empty", text: "контроллеров нет" }));

    var routesLane = el("div", { "class": "lane wide" }, el("div", { "class": "lane-title", text: "Маршруты" }));
    graph.routes.forEach(function (route) { routesLane.appendChild(routeCard(route)); });
    if (!graph.routes.length) routesLane.appendChild(el("div", { "class": "empty", text: "маршрутов нет" }));

    var schemasLane = el("div", { "class": "lane" }, el("div", { "class": "lane-title", text: "Схемы данных" }));
    graph.schemas.forEach(function (schema) { schemasLane.appendChild(schemaCard(schema)); });
    if (!graph.schemas.length) schemasLane.appendChild(el("div", { "class": "empty", text: "схем нет" }));

    lanes.appendChild(controllersLane);
    lanes.appendChild(routesLane);
    lanes.appendChild(schemasLane);

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

  /** Префикс, с которого начинается дерево среза: у неполного вида он не «/» */
  function rootPrefix() {
    var item = controllerIndex.get(graph.root);
    return item && item.prefixes.length ? item.prefixes[0] : "/";
  }

  function setRoot(rootId) {
    graph = subgraph(rootId);
    reindex();
    renderView();
    var select = document.getElementById("root");
    if (select.value !== graph.root) select.value = graph.root;
  }

  // -------------------------------------------------------------- выбор

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
        // раскрываем подсвеченное окружение, но не спорим с собственным кликом пользователя
        if (hit && !node.classList.contains("open")) {
          node.classList.add("open");
        }
      }
    });

    if (selection) {
      var target = document.querySelector(
        '[data-key="' + cssEscape(selection.type + ":" + selection.id) + '"].card'
      );
      // подводим к выбранному, только если его не видно: иначе полотно уезжало
      // из-под курсора прямо по клику, и следующий клик попадал уже мимо карточки
      if (target && !inView(target)) focusOn(target);
    }
    schedule();
  }

  function cssEscape(value) { return value.replace(/["\\]/g, "\\$&"); }

  // -------------------------------------------------------------- поиск

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

  // Esc — тот же сброс, что и кнопкой: выделение и поиск
  window.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    // из поля поиска Esc сначала должен снять с него фокус
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

  // Корень вида — клиентская величина: меняем hash, страница не перезапрашивается
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
      // остальное доделает обработчик hashchange — состояние остаётся одно
      window.location.hash = hash;
    }
  });

  window.addEventListener("hashchange", function () { setRoot(rootFromHash()); });

  // ------------------------------------------------------- панорама и зум

  var viewport = document.getElementById("viewport");
  var stage = document.getElementById("stage");
  var wires = document.getElementById("wires");

  var view = { x: 20, y: 20, scale: 1 };

  /** Держим полотно в поле зрения: после сворачивания блоков оно иначе уезжает в пустоту */
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

  // Панорама намеренно без setPointerCapture: захват указателя перенацеливает
  // последующий click на элемент-захватчик, и клики по карточкам не доходили бы
  // до их обработчиков вовсе. Движение и отпускание слушаем на window — это даёт
  // тот же эффект (курсор может уйти за пределы полотна), не ломая клики.
  var drag = null;
  viewport.addEventListener("pointerdown", function (event) {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false };
  });

  window.addEventListener("pointermove", function (event) {
    if (!drag) return;
    var dx = event.clientX - drag.x;
    var dy = event.clientY - drag.y;
    // порог: обычный клик почти всегда даёт дрожание в один-два пикселя
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      drag.moved = true;
      viewport.classList.add("dragging");
    }
    if (!drag.moved) return;
    view.x = drag.ox + dx;
    view.y = drag.oy + dy;
    applyView();
  });

  // Подавление клика после перетаскивания — флагом, а не одноразовым слушателем:
  // одноразовый оставался взведённым, если клик после drag так и не приходил,
  // и съедал следующий настоящий клик по карточке.
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

  /** Вписать всё полотно в окно: на модуле в сотню маршрутов иначе не видно общей картины */
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

  /** Видна ли карточка в окне полотна хотя бы частично */
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

  // --------------------------------------------------------------- связи

  var pending = null;
  function schedule() {
    if (pending) cancelAnimationFrame(pending);
    pending = requestAnimationFrame(function () {
      pending = null;
      clampView();
      applyView();
      drawWires();
    });
  }

  function visible(node) {
    return !!node && !!node.offsetParent && !node.closest(".is-hidden");
  }

  /** Точка привязки в координатах полотна; свёрнутая строка отдаёт свою карточку */
  function anchor(key, fallbackKey) {
    var node = document.querySelector('[data-key="' + cssEscape(key) + '"]');
    if (!visible(node) && fallbackKey) node = document.querySelector('[data-key="' + cssEscape(fallbackKey) + '"]');
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

  function path(from, to) {
    var x1 = from.right, y1 = from.middle, x2 = to.left, y2 = to.middle;
    var span = Math.max(46, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 4);
    if (x2 < x1 + 20) {
      // цель левее источника — обойдём справа, чтобы линия не шла сквозь карточку
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
    var edges = [];

    // связи схема → схема: постоянная часть картины, это и есть ER-слой
    graph.schemas.forEach(function (schema) {
      schema.refs.forEach(function (edge) {
        edges.push({
          from: "prop:" + schema.id + ">" + edge.property,
          fromCard: "schema:" + schema.id,
          to: "schema:" + edge.target,
          kind: "er",
          hot: !!hits && hits.has("schema:" + schema.id) && hits.has("schema:" + edge.target)
        });
      });
    });

    // связи маршрут → схема и контроллер → маршрут: только по выбору либо по флагу
    graph.routes.forEach(function (route) {
      var routeHot = !!hits && hits.has("route:" + route.id);
      if (!allWires && !routeHot) return;
      edges.push({
        from: "controller:" + route.controller,
        to: "route:" + route.id,
        kind: "use",
        hot: routeHot
      });
      route.schemas.forEach(function (name) {
        edges.push({
          from: "route:" + route.id,
          to: "schema:" + name,
          kind: "use",
          hot: routeHot && !!hits && hits.has("schema:" + name)
        });
      });
    });

    var fragment = document.createDocumentFragment();
    edges.forEach(function (edge) {
      var from = anchor(edge.from, edge.fromCard);
      var to = anchor(edge.to);
      if (!from || !to) return;
      if (hits && !edge.hot && edge.kind === "er") return;
      var node = document.createElementNS("http://www.w3.org/2000/svg", "path");
      node.setAttribute("d", path(from, to));
      node.setAttribute("class", edge.kind + (edge.hot ? " hot" : ""));
      fragment.appendChild(node);
    });
    wires.appendChild(fragment);
  }

  window.addEventListener("resize", schedule);
  applyView();
  setRoot(rootFromHash());
})();
`;

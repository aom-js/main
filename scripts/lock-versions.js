// `bun publish` подставляет вместо `workspace:*` версию соседа из bun.lock, а не из его package.json:
// если после подъёма версии не выполнить `bun install`, пакеты уйдут в npm с зависимостями на прошлую версию.

/** Пакеты-workspaces, у которых версия в bun.lock не равна `version`: `[{ name, locked }]`. */
function staleWorkspaces(lockText, version) {
  // bun.lock — JSON с висячими запятыми
  const lock = JSON.parse(lockText.replace(/,(\s*[}\]])/g, "$1"));
  return Object.values(lock.workspaces)
    .filter((ws) => ws.name?.startsWith("@aom-js/") && ws.version !== undefined)
    .filter((ws) => ws.version !== version)
    .map((ws) => ({ name: ws.name, locked: ws.version }));
}

module.exports = { staleWorkspaces };

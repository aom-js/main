/**
 * A path parameter in a route template: `:name` or `:name(validator)`. The only definition of
 * the grammar: the server of `@aom-js/api` compiles routes with it (`compilePath`), the probe
 * runner of `@aom-js/router/testing` fills addresses with it.
 */
export const PATH_PARAM = /:([^/()]+)(?:\(([^)]+)\))?/;

// a parameter, or a regexp metacharacter sitting in the literal part of the path
const PATH_TOKEN = new RegExp(`${PATH_PARAM.source}|${/[.*+?^${}()|[\]\\]/.source}`, "g");

/**
 * Compiles a path template into one anchored regexp plus the parameter names, in the order their
 * capture groups appear: `/orgs/:orgId(\d+)/users/:userId` becomes
 * `/^\/orgs\/(\d+)\/users\/([^\/]+)$/` and `["orgId", "userId"]`.
 *
 * A parameter's own validator pattern is inlined into the route pattern, so a value that does not
 * satisfy it makes the whole path miss this route - there is deliberately no second per-parameter
 * check after the match (the old one was unreachable, `KI-API-01`).
 *
 * Everything that is not a parameter is literal path text and gets escaped, so a route template
 * stays a path rather than a regexp of its own: `/file.json` matches only `/file.json`, not
 * `/fileXjson` (`KI-API-19`). A parameter's validator is the one place where regexp syntax is
 * meant literally, and the alternation lets that branch win before the escaping one.
 */
export function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const pattern = path.replace(PATH_TOKEN, (whole, name?: string, validator?: string) => {
    // second branch: a regexp metacharacter sitting in the literal part of the path
    if (name === undefined) return `\\${whole}`;

    paramNames.push(name);
    return `(${validator ?? "[^/]+"})`;
  });

  return { pattern: new RegExp(`^${pattern}$`), paramNames };
}

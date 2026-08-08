/**
 * Refuses to build a deployable marketing image without the public values it bakes in.
 *
 * `NEXT_PUBLIC_*` is not read at runtime. Next inlines each one into the compiled
 * bundle as a literal, so whatever is set at `next build` is frozen into the page
 * forever. Miss them and `getMcpUrl()` / `getSiteUrl()` fall back to their localhost
 * development defaults, which is the worst possible failure: the container starts
 * clean, the page renders, and the live site quietly tells every visitor to install
 * `http://localhost:8787/mcp` while the access form POSTs into the void. Nothing
 * logs an error, because nothing is wrong as far as the code is concerned.
 *
 * So the check runs in `apps/web/Dockerfile`, not in `package.json`: an image is the
 * only artefact that ships, and a plain `pnpm build` on a laptop has every right to
 * use the localhost defaults.
 *
 * Deliberately no fallback values here. docs/DEPLOY.md keeps production hostnames out
 * of the tree, so this file says which variables are mandatory and never what they are.
 */

import { pathToFileURL } from "node:url";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/** Absolute https URL that is not a development host. */
function urlProblem(name, raw) {
  const value = raw?.trim();
  if (!value) return `${name} is not set`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return `${name} is not an absolute URL (got "${value}")`;
  }
  // Host before protocol: a forgotten build arg lands on http://localhost, and naming the
  // localhost fallback points at the actual mistake where "must be https" would not.
  if (LOCAL_HOSTS.has(url.hostname)) {
    return `${name} points at a development host (got "${value}")`;
  }
  if (url.protocol !== "https:") {
    return `${name} must be https (got "${value}")`;
  }
  return null;
}

/**
 * Blocking problems, in the order a reader should fix them. Pure, so the tests can
 * exercise it without touching process.env.
 */
export function publicEnvProblems(env) {
  return [
    urlProblem("NEXT_PUBLIC_MCP_URL", env.NEXT_PUBLIC_MCP_URL),
    urlProblem("NEXT_PUBLIC_SITE_URL", env.NEXT_PUBLIC_SITE_URL),
  ].filter(Boolean);
}

/**
 * Non-blocking. A build with analytics off is a legitimate thing to want, and
 * `initPostHog` already no-ops on an empty key, so this only has to be visible.
 */
export function publicEnvWarnings(env) {
  return env.NEXT_PUBLIC_POSTHOG_KEY?.trim()
    ? []
    : ["NEXT_PUBLIC_POSTHOG_KEY is not set: the built site will report no analytics"];
}

function main(env) {
  for (const warning of publicEnvWarnings(env)) {
    console.warn(`warning: ${warning}`);
  }

  const problems = publicEnvProblems(env);
  if (problems.length === 0) {
    console.log("public env OK: the built page will point at the configured hosts");
    return 0;
  }

  console.error(
    [
      "",
      "Refusing to build the web image: the values Next bakes into the page are missing.",
      "",
      ...problems.map((problem) => `  - ${problem}`),
      "",
      "These are Docker build args, not runtime env, so they must be passed at build time:",
      "",
      "  gcloud builds submit --config=cloudbuild.web.yaml \\",
      "    --substitutions=_MCP_URL=<site>/mcp,_SITE_URL=<site>,_POSTHOG_KEY=<key> .",
      "",
      "Lost the values? They are already public, inlined in the deployed bundle:",
      "",
      "  curl -s <site>/ | grep -o '/_next/static/chunks/[^\"]*' | sort -u",
      "  # then curl those chunks and grep for the URL and the phc_ key",
      "",
    ].join("\n"),
  );
  return 1;
}

/*
 * pathToFileURL, not a `file://` template. Hand-building the URL mismatches as soon as the
 * checkout path contains a space or any character that needs escaping, and a mismatch here
 * fails open: the guard becomes an import with no side effect, exits 0, and the Dockerfile
 * happily builds the broken image it was added to prevent. The subprocess test in
 * tests/scripts covers this wiring, because the pure functions passing proves nothing about
 * whether the entrypoint ever runs.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.env));
}

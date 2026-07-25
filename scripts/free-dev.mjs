#!/usr/bin/env node
/**
 * Sweeps dev-server wrappers this repo abandoned, then hands off to `tsx watch`.
 *
 * Why this exists: killing the dev server by its leaf process (`pkill -f "tsx watch"`,
 * or a terminal window closing) reaps the process doing the work and leaves the three
 * `pnpm` wrappers above it alive, reparented to init. They burn no CPU so nothing ever
 * complains, and each restart leaves three more behind. A day of that is dozens of
 * idle node processes holding hundreds of MB, which is enough to push the machine into
 * swap. Sweeping on start means the mess can never outlive one dev session.
 *
 * Two conditions before anything is killed, and the second is what makes it safe:
 *   1. parent is init, so the shell that started it is gone and nobody is watching it
 *   2. nothing in its process tree holds a listening socket, so it is not serving
 * A dev server you are still using always fails test 2 and is never touched.
 */
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const WRAPPER = /pnpm (?:dev\b|--filter \S+ dev\b)|tsx watch/

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5_000 })
  } catch {
    // lsof and pgrep both exit non-zero to mean "no matches", which is not an error.
    return ""
  }
}

const children = (pid) =>
  sh("pgrep", ["-P", String(pid)]).split("\n").filter(Boolean).map(Number)

function tree(pid) {
  return [pid, ...children(pid).flatMap(tree)]
}

function isServing(pids) {
  return sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-p", pids.join(",")]).trim() !== ""
}

function cwdOf(pid) {
  const line = sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"])
    .split("\n")
    .find((l) => l.startsWith("n"))
  return line ? line.slice(1) : ""
}

const orphans = sh("ps", ["-Ao", "pid,ppid,args"])
  .split("\n")
  .slice(1)
  .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
  .filter(Boolean)
  .filter(([, , ppid]) => ppid === "1")
  .filter(([, , , args]) => WRAPPER.test(args))
  .map(([, pid, , args]) => ({ pid: Number(pid), args }))

const doomed = []
for (const { pid, args } of orphans) {
  if (!cwdOf(pid).startsWith(REPO_ROOT)) continue
  const pids = tree(pid)
  if (isServing(pids)) {
    console.log(`[super-mcp] keeping ${pid} (still serving): ${args.slice(0, 60)}`)
    continue
  }
  doomed.push(...pids)
}

if (doomed.length > 0) {
  console.log(`[super-mcp] sweeping ${doomed.length} orphaned dev process(es) from a previous run`)
  for (const pid of new Set(doomed)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // Already gone: a parent's death can take its children with it mid-sweep.
    }
  }
}

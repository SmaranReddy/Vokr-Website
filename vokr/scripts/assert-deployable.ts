/**
 * Phase 19 — refuses to let a deployment be built from anything but a
 * clean, committed, pushed revision.
 *
 * `deploy.yml` performs the same three checks on the runner, where they
 * can only ever pass. This script exists for the case they are actually
 * meant to catch: someone running `docker build` and `gcloud run deploy`
 * by hand from a working tree with uncommitted changes in it, producing a
 * production image whose contents correspond to no commit in the
 * repository. That is how the currently running service came to be, and
 * why nothing about it could be reproduced from Git alone.
 *
 *   npm run deploy:check
 *
 * Exits 0 and prints the SHA when it is safe to build; exits 1 otherwise.
 */

import { execFileSync } from "node:child_process";

function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

interface Problem {
  what: string;
  detail: string;
}

function main(): void {
  const problems: Problem[] = [];

  const head = git("rev-parse", "HEAD");

  const dirty = git("status", "--porcelain");
  if (dirty.length > 0) {
    problems.push({
      what: "The working tree is not clean.",
      detail:
        "A build from here would ship code that exists in no commit:\n" +
        dirty
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n"),
    });
  }

  // `--contains` lists remote branches whose history includes HEAD. Empty
  // means the commit exists only on this machine, so the deployed image
  // could never be rebuilt by anyone else — including CI.
  const remoteBranches = git("branch", "-r", "--contains", head)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.includes("->"));
  if (remoteBranches.length === 0) {
    problems.push({
      what: `Commit ${head.slice(0, 12)} has not been pushed to any remote.`,
      detail:
        "Push the branch first — an image built from an unpushed commit " +
        "cannot be rebuilt, audited or rolled forward by anyone else.",
    });
  }

  if (problems.length > 0) {
    console.error("Refusing to deploy.\n");
    for (const problem of problems) {
      console.error(`  - ${problem.what}`);
      console.error(`    ${problem.detail}\n`);
    }
    process.exit(1);
  }

  console.log(`OK: clean tree at ${head}`);
  console.log(`    present on: ${remoteBranches.join(", ")}`);
  console.log(
    "\nTag the image with this SHA, and deploy Cloud Run by digest, not by tag.",
  );
}

main();

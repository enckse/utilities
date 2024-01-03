import { join } from "std/path/mod.ts";
import { existsSync } from "std/fs/mod.ts";
import { getEnv, messageAndExitNonZero } from "./common.ts";

const LOCALS = "localhost";
const SEPARATOR = "/";
const GIT_ALIAS = ":";
const LIST_CMD = "--list";

function list(cache: string, repoDir: string) {
  const proc = new Deno.Command("git", {
    args: ["config", "--list"],
    stdout: "piped",
  });
  const stdout = new TextDecoder().decode(proc.outputSync().stdout);
  const options: Array<string> = [];
  for (const line of stdout.trim().split("\n")) {
    if (line.indexOf("insteadof") < 0) {
      continue;
    }
    if (line.indexOf(LOCALS) >= 0) {
      continue;
    }
    options.push(line.split("=")[1]);
  }
  if (existsSync(repoDir)) {
    for (const dir of Deno.readDirSync(repoDir)) {
      options.push(dir.name + SEPARATOR);
    }
  }
  if (existsSync(cache)) {
    for (
      const line of new TextDecoder().decode(Deno.readFileSync(cache)).trim()
        .split("\n")
    ) {
      options.push(line.replace(`${LOCALS}:`, ""));
    }
  }
  options.sort().forEach((o) => {
    console.log(o.replace(GIT_ALIAS, SEPARATOR));
  });
}

export function oclone(args: Array<string>) {
  if (args.length === 0) {
    messageAndExitNonZero("argument required");
  }
  const home = getEnv("HOME");
  const cacheDir = join(home, ".local", "state");
  const cacheFile = join(cacheDir, "oclone.hst");
  const repos = getEnv("GIT_SOURCES");
  if (!existsSync(cacheDir)) {
    Deno.mkdirSync(cacheDir);
  }
  let first = args[0];
  const options: Array<string> = ["clone", ...args.slice(1)];
  switch (first) {
    case LIST_CMD:
      if (args.length !== 1) {
        messageAndExitNonZero("invalid list request");
      }
      list(cacheFile, repos);
      return;
    case "--bash":
      console.log(`#!/usr/bin/env bash
_git_oclone() {
  local cur opts
  if [ "$COMP_CWORD" -eq 2 ]; then
    cur=\${COMP_WORDS[COMP_CWORD]}
    opts=$(git oclone ${LIST_CMD})
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  fi
}`);
      return;
  }
  let isLocal = false;
  for (const suffix of ["", ".git"]) {
    if (existsSync(join(repos, `${first}${suffix}`))) {
      isLocal = true;
      break;
    }
  }
  if (isLocal) {
    first = `${LOCALS}${GIT_ALIAS}${first}`;
  }
  options.push(first);
  const proc = new Deno.Command("git", {
    args: options,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (proc.outputSync().code !== 0) {
    Deno.exit(1);
  }
  Deno.writeTextFile(cacheFile, first, { append: true });
  new Deno.Command("sort", { args: ["-u", "-o", cacheFile, cacheFile] })
    .spawn();
}

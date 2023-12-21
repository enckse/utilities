import { join } from "std/path/mod.ts";
import { existsSync } from "std/fs/mod.ts";

const LOCALS = "localhost";
const SEPARATOR = "/";
const GIT_ALIAS = ":";
const LIST_CMD = "--list";

function list(cache: string, repo_dir: string) {
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
  if (existsSync(repo_dir)) {
    for (const dir of Deno.readDirSync(repo_dir)) {
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
    console.log("argument required");
    Deno.exit(1);
  }
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    console.log("HOME is not set");
    return;
  }
  const cacheDir = join(home, ".local", "state");
  const cacheFile = join(cacheDir, "oclone.hst");
  const repos = Deno.env.get("GIT_SOURCES");
  if (repos === undefined) {
    console.log("GIT_SOURCES is not set");
    return;
  }
  if (!existsSync(cacheDir)) {
    Deno.mkdirSync(cacheDir);
  }
  let is_first = true;
  let first = "";
  const options: Array<string> = ["clone"];
  for (const opt of args) {
    if (is_first) {
      first = opt;
      is_first = false;
    } else {
      options.push(opt);
    }
  }
  switch (first) {
    case LIST_CMD:
      if (args.length !== 1) {
        console.log("invalid list request");
        Deno.exit(1);
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
  let is_local = false;
  for (const suffix of ["", ".git"]) {
    if (existsSync(join(repos, `${first}${suffix}`))) {
      is_local = true;
      break;
    }
  }
  if (is_local) {
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

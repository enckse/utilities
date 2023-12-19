import { main } from "./generated.ts";
import { join } from "https://deno.land/std/path/mod.ts";
import { existsSync } from "https://deno.land/std/fs/mod.ts";

const locals = "localhost";
const separator = "/";
const git_alias = ":";

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
    if (line.indexOf(locals) >= 0) {
      continue;
    }
    options.push(line.split("=")[1]);
  }
  if (existsSync(repo_dir)) {
    for (const dir of Deno.readDirSync(repo_dir)) {
      options.push(dir.name + separator);
    }
  }
  if (existsSync(cache)) {
    for (
      const line of new TextDecoder().decode(Deno.readFileSync(cache)).trim()
        .split("\n")
    ) {
      options.push(line.replace(`${locals}:`, ""));
    }
  }
  options.sort().forEach((o) => {
    console.log(o.replace(git_alias, separator));
  });
}

function oclone() {
  if (Deno.args.length === 0) {
    console.log("argument required");
    Deno.exit(1);
  }
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    console.log("HOME is not set");
    return;
  }
  const cache_dir = join(home, ".local", "state");
  const cache_file = join(cache_dir, "oclone.hst");
  const repos = join(home, "Active", "git");
  if (!existsSync(cache_dir)) {
    Deno.mkdirSync(cache_dir);
  }
  let is_first = true;
  let first = "";
  const options: Array<string> = ["clone"];
  for (const opt of Deno.args) {
    if (is_first) {
      first = opt;
      is_first = false;
    } else {
      options.push(opt);
    }
  }
  if (first === "--list") {
    if (Deno.args.length !== 1) {
      console.log("invalid list request");
      Deno.exit(1);
    }
    list(cache_file, repos);
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
    first = `${locals}${git_alias}${first}`;
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
  Deno.writeTextFile(cache_file, first, { append: true });
  new Deno.Command("sort", { args: ["-u", "-o", cache_file, cache_file] })
    .spawn();
}

if (import.meta.main) {
  main(oclone);
}

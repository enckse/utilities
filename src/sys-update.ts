import { basename, join } from "https://deno.land/std/path/mod.ts";
import { main } from "./generated.ts";
import { existsSync, moveSync } from "https://deno.land/std/fs/mod.ts";

function sync() {
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    console.log("HOME is not set");
    Deno.exit(1);
  }
  const tasks = Deno.env.get("TASK_CACHE");
  if (tasks === undefined) {
    console.log("TASK_CACHE not set");
    Deno.exit(1);
  }
  console.log("brew operations");
  for (const sub of ["update", "upgrade"]) {
    if (!command("brew", [sub], undefined)) {
      console.log(`brew ${sub} failed`);
      Deno.exit(1);
    }
  }
  const brew_config = join(tasks, "brew");
  if (!existsSync(brew_config)) {
    Deno.mkdir(brew_config);
  }
  const brew_config_file = join(brew_config, "Brewfile");
  if (existsSync(brew_config_file)) {
    Deno.removeSync(brew_config_file);
  }
  if (!command("brew", ["bundle", "dump"], brew_config)) {
    console.log("failed to dump brew information");
    Deno.exit(1);
  }
  const config = join(home, ".config");
  const config_file = join(config, "voidedtech", "repos.json");
  const packs = join(config, "nvim", "pack", "plugins", "start");
  const data = new TextDecoder().decode(Deno.readFileSync(config_file));
  const cfg = JSON.parse(data);
  for (const plugin of cfg["neovim"]) {
    const base = basename(plugin);
    const dest = join(packs, base);
    let args: Array<string> = [
      "clone",
      `https://github.com/${plugin}`,
      dest,
      "--single-branch",
    ];
    if (existsSync(dest)) {
      const parse = new Deno.Command("git", {
        args: ["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"],
        stdout: "piped",
      });
      const { code, stdout } = parse.outputSync();
      if (code !== 0) {
        console.log("failed to parse rev");
        continue;
      }
      const rev = new TextDecoder().decode(stdout).trim();
      args = ["-C", dest, "pull", "origin", rev];
    }
    console.log(`=> ${base}`);
    if (!command("git", args, undefined)) {
      console.log("plugin sync failed");
    }
    console.log();
  }
  const repo_state = join(home, ".local", "state", "repos.current");
  const new_state = `${repo_state}.new`;
  const items: Array<string> = [];
  for (const app of cfg["apps"]) {
    console.log(`=> getting state: ${app}`);
    const proc = new Deno.Command("git", {
      args: ["ls-remote", "--tags", `https://github.com/${app}`],
      stdout: "piped",
    });
    const { code, stdout } = proc.outputSync();
    if (code !== 0) {
      console.log("unable to get state");
      continue;
    }
    for (const line of new TextDecoder().decode(stdout).trim().split("\n")) {
      if (line.indexOf("refs/tags/") < 0) {
        continue;
      }
      items.push(`${app}: ${line}`);
    }
  }
  Deno.writeTextFileSync(new_state, items.join("\n"));
  if (!existsSync(repo_state)) {
    Deno.writeTextFileSync(repo_state, "");
  }
  if (!command("diff", [repo_state, new_state], undefined)) {
    console.log("===\napplication update detected\n===");
  }

  moveSync(new_state, repo_state, {
    overwrite: true,
  });
}

function command(
  exe: string,
  args: Array<string>,
  cwd: string | undefined,
): boolean {
  const proc = new Deno.Command(exe, {
    args: args,
    stdout: "inherit",
    stderr: "inherit",
    cwd: cwd,
  });
  return proc.outputSync().code === 0;
}

if (import.meta.main) {
  main(sync);
}

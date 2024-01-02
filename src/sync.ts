import { basename, join } from "std/path/mod.ts";
import { existsSync, moveSync } from "std/fs/mod.ts";
import { parse as parseConfig } from "std/yaml/mod.ts";

interface Config {
  apps: string;
  neovim: string;
}

export function sync() {
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
  for (const sub of ["update", "upgrade"]) {
    console.log(`=> brew operation: ${sub}`);
    if (!command("brew", [sub], undefined)) {
      console.log(`brew ${sub} failed`);
      Deno.exit(1);
    }
  }
  const brewConfig = join(tasks, "brew");
  if (!existsSync(brewConfig)) {
    Deno.mkdir(brewConfig);
  }
  const brewConfigFile = join(brewConfig, "Brewfile");
  if (existsSync(brewConfigFile)) {
    Deno.removeSync(brewConfigFile);
  }
  if (!command("brew", ["bundle", "dump"], brewConfig)) {
    console.log("failed to dump brew information");
    Deno.exit(1);
  }
  const config = join(home, ".config");
  const configFile = join(config, "voidedtech", "upstreams.yaml");
  const packs = join(config, "nvim", "pack", "plugins", "start");
  const data = new TextDecoder().decode(Deno.readFileSync(configFile));
  const cfg = parseConfig(data) as Config;
  for (const plugin of cfg.neovim) {
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
  const repoState = join(home, ".local", "state", "repos.current");
  const newState = `${repoState}.new`;
  const items: Array<string> = [];
  for (const app of cfg.apps) {
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
  Deno.writeTextFileSync(newState, items.join("\n"));
  if (!existsSync(repoState)) {
    Deno.writeTextFileSync(repoState, "");
  }
  if (!command("diff", [repoState, newState], undefined)) {
    console.log("===\napplication update detected\n===");
    if (!confirm("update completed?")) {
      return;
    }
  }

  moveSync(newState, repoState, {
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

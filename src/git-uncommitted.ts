import { join } from "https://deno.land/std/path/mod.ts";
import { existsSync } from "https://deno.land/std/fs/mod.ts";
import { red, yellow } from "https://deno.land/std/fmt/colors.ts";
import { main } from "./generated.ts";

class Result {
  private matched: boolean;
  private sub: string;
  private dir: string;
  constructor(has: boolean, sub: string, dir: string) {
    this.matched = has;
    this.sub = sub;
    this.dir = dir;
  }
  get has(): boolean {
    return this.matched;
  }
  quick(early: boolean) {
    if (!early) {
      return;
    }
    if (this.has) {
      color("dirty", red);
      Deno.exit(1);
    }
  }
  display(): string {
    return `${this.dir} (${this.sub})`;
  }
}

class Git {
  private sub: string;
  private args: Array<string>;
  private filter: string | undefined;
  private negate: boolean;
  constructor(subCommand: string, args: Array<string>) {
    this.sub = subCommand;
    this.args = [subCommand].concat(args);
    this.filter = undefined;
    this.negate = false;
  }
  setFilter(filter: string, negate: boolean): Git {
    this.filter = filter;
    this.negate = negate;
    return this;
  }
  toCommand(dir: string): Array<string> {
    return ["-C", dir].concat(this.args);
  }
  check(dir: string, output: string): Result {
    let res = output !== "";
    if (this.filter !== undefined) {
      const matched = new RegExp(this.filter).test(output);
      if (this.negate) {
        if (matched) {
          res = false;
        } else {
          res = true;
        }
      } else {
        res = matched;
      }
    }
    return new Result(res, this.sub, dir);
  }
  command(dir: string): Result {
    const cmd = this.toCommand(dir);
    const proc = new Deno.Command("git", { args: cmd, stdout: "piped" });
    const stdout = proc.outputSync().stdout;
    return this.check(dir, new TextDecoder().decode(stdout).trim());
  }
}

function color(text: string, callback: (t: string) => string) {
  console.log(callback(`(${text})`));
}

function stat(dir: string, early: boolean): Array<string> {
  new Git("update-index", ["-q", "--refresh"]).command(dir);
  const diffIndex = new Git("diff-index", ["--name-only", "HEAD", "--"])
    .command(
      dir,
    );
  diffIndex.quick(early);
  const status = new Git("status", ["-sb"]).setFilter("\\[ahead", false)
    .command(
      dir,
    );
  status.quick(early);
  const lsFiles = new Git("ls-files", ["--other", "--exclude-standard"])
    .command(dir);
  lsFiles.quick(early);
  const branch = new Git("branch", ["--show-current"]).setFilter(
    "^(main|master)$",
    true,
  ).command(dir);
  branch.quick(early);
  if (early) {
    color("clean", yellow);
    Deno.exit(0);
  }
  const lines: Array<string> = [];
  [diffIndex, status, lsFiles, branch].forEach((e) => {
    if (e.has) {
      const disp = e.display();
      if (!lines.includes(disp)) {
        lines.push(disp);
      }
    }
  });
  return lines;
}

function uncommit() {
  const dirs = Deno.env.get("GIT_UNCOMMIT");
  if (dirs === undefined || dirs === "") {
    console.log("GIT_UNCOMMIT not set");
    Deno.exit(1);
  }
  let quiet = false;
  if (Deno.args.length > 0) {
    switch (Deno.args[0]) {
      case "--pwd": {
        const cwd = Deno.cwd();
        const working = new Git("rev-parse", ["--is-inside-work-tree"])
          .setFilter(
            "true",
            false,
          ).command(cwd);
        if (working.has) {
          stat(cwd, true);
        }
        return;
      }
      case "--quiet":
        quiet = true;
        break;
      default:
        console.log("unknown subcommand");
        Deno.exit(1);
    }
  }
  let items: Array<string> = [];
  dirs.trim().split(" ").forEach((d) => {
    for (const entry of Deno.readDirSync(d)) {
      if (entry.isDirectory) {
        const pathing = join(d, entry.name);
        if (existsSync(join(pathing, ".git"))) {
          const stats = stat(pathing, false);
          if (stats.length > 0) {
            if (quiet) {
              Deno.exit(1);
            }
            items = items.concat(stats);
          }
        }
      }
    }
  });
  items.sort().forEach((e) => {
    console.log(e);
  });
  if (items.length > 0) {
    Deno.exit(1);
  }
}
if (import.meta.main) {
  main(uncommit);
}

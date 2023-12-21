import { version } from "./generated.ts";
import { join } from "https://deno.land/std/path/mod.ts";
import { transcode } from "./transcode-media.ts";
import { uncommit } from "./git-uncommitted.ts";
import { oclone } from "./git-oclone.ts";
import { sync } from "./sys-update.ts";
import { lockbox } from "./lb.ts";

type commandable = (args: Array<string>) => void;

const commands: Map<string, commandable> = new Map<string, commandable>();
commands.set(
  "transcode-media",
  (_: Array<string>) => {
    transcode();
  },
);
commands.set(
  "git-oclone",
  oclone,
);
commands.set("git-uncommitted", uncommit);
commands.set("lb", lockbox);
commands.set("sys-update", (_: Array<string>) => {
  sync();
});
const executable = "utility-wrapper";

function main() {
  if (Deno.args.length === 0) {
    console.log("invalid args, command required");
    Deno.exit(1);
  }
  const args: Array<string> = [];
  let first = true;
  let command = "";
  for (const arg of Deno.args) {
    if (first) {
      command = arg;
      first = false;
    } else {
      args.push(arg);
    }
  }
  if (command === "--version") {
    version();
  }
  const cmd = commands.get(command);
  if (cmd !== undefined) {
    cmd(args);
    return;
  }
  switch (command) {
    case "generate": {
      if (args.length !== 1) {
        console.log("target required");
        Deno.exit(1);
      }
      const target = args[0];
      for (const command of commands.keys()) {
        Deno.writeTextFileSync(
          join(target, command),
          `#!/usr/bin/env bash\nexec ${executable} ${command} $@`,
          {
            mode: 0o755,
          },
        );
      }
      break;
    }
    default:
      console.log("unknown subcommand");
      Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}

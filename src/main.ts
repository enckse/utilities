import { join } from "std/path/mod.ts";
import { transcode } from "./transcode.ts";
import { uncommit } from "./uncommitted.ts";
import { oclone } from "./oclone.ts";
import { sync } from "./sync.ts";
import { lockbox } from "./lb.ts";

const COMMANDS = {
  "transcode-media": (_: Array<string>) => {
    transcode();
  },
  "git-oclone": oclone,
  "git-uncommitted": uncommit,
  "lb": lockbox,
  "sys-update": (_: Array<string>) => {
    sync();
  },
};
const EXECUTABLE = "utility-wrapper";

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
  for (const [k, v] of Object.entries(COMMANDS)) {
    if (k === command) {
      v(args);
      return;
    }
  }
  switch (command) {
    case "generate": {
      if (args.length !== 1) {
        console.log("target required");
        Deno.exit(1);
      }
      const vers = Deno.env.get("VERSION");
      if (vers === undefined) {
        console.log("VERSION not set");
        Deno.exit(1);
      }
      const target = args[0];
      for (const command of Object.getOwnPropertyNames(COMMANDS)) {
        Deno.writeTextFileSync(
          join(target, command),
          `#!/usr/bin/env bash
if [[ -n "$1" ]]; then
  if [[ "$1" == "--version" ]]; then
    echo "version: ${vers}"
    exit 0
  fi
fi
exec ${EXECUTABLE} ${command} $@`,
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

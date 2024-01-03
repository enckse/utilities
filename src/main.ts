import { join } from "std/path/mod.ts";
import { transcode } from "./transcode.ts";
import { uncommit } from "./uncommitted.ts";
import { oclone } from "./oclone.ts";
import { sync } from "./sync.ts";
import { lockbox } from "./lb.ts";
import { BASH_ARG, getEnv, messageAndExitNonZero } from "./common.ts";
import { existsSync } from "std/fs/exists.ts";

const LB_COMMAND = "lb";
const OCLONE_COMMAND = "git-oclone";
const COMMANDS: Map<string, (args: Array<string>) => void> = new Map();
COMMANDS.set("transcode-media", (args: Array<string>) => {
  transcode();
});
COMMANDS.set(OCLONE_COMMAND, oclone);
COMMANDS.set("git-uncommitted", uncommit);
COMMANDS.set(LB_COMMAND, lockbox);
COMMANDS.set("sys-update", (_: Array<string>) => {
  sync();
});
const COMPLETIONS = [LB_COMMAND, OCLONE_COMMAND];
const EXECUTABLE = "utility-wrapper";

function main() {
  if (Deno.args.length === 0) {
    messageAndExitNonZero("invalid args, command required");
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
  const cb = COMMANDS.get(command);
  if (cb !== undefined) {
    cb(args);
    return;
  }
  switch (command) {
    case "bash": {
      if (args.length !== 1) {
        messageAndExitNonZero("directory required");
      }
      const target = args[0];
      for (const key of COMPLETIONS) {
        const completion = join(target, key);
        if (existsSync(completion)) {
          continue;
        }
        const cb = COMMANDS.get(key);
        if (cb === undefined) {
          messageAndExitNonZero(
            `unable to resolve completion callback: ${key}`,
          );
          return;
        }
        cb([BASH_ARG, completion]);
      }
      break;
    }
    case "generate": {
      if (args.length !== 1) {
        messageAndExitNonZero("target required");
      }
      const vers = getEnv("VERSION");
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
      messageAndExitNonZero("unknown subcommand");
  }
}

if (import.meta.main) {
  main();
}

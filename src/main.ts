import { version } from "./generated.ts";
import { join } from "https://deno.land/std/path/mod.ts";
import { transcode } from "./transcode-media.ts";
import { uncommit } from "./git-uncommitted.ts";
import { oclone } from "./git-oclone.ts";
import { sync } from "./sys-update.ts";

const transcode_media_command = "transcode-media";
const git_oclone_command = "git-oclone";
const git_uncommitted_command = "git-uncommitted";
const sys_update_command = "sys-update";
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
  switch (command) {
    case sys_update_command:
      sync();
      break;
    case transcode_media_command:
      transcode();
      break;
    case git_uncommitted_command:
      uncommit(args);
      break;
    case git_oclone_command:
      oclone(args);
      break;
    case "generate": {
      if (args.length !== 1) {
        console.log("target required");
        Deno.exit(1);
      }
      const target = args[0];
      for (
        const command of [
          transcode_media_command,
          git_oclone_command,
          git_uncommitted_command,
          sys_update_command,
        ]
      ) {
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

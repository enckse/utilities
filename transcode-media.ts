import { extname } from "https://deno.land/std/path/mod.ts";
import { format } from "https://deno.land/std/datetime/mod.ts";
import { main } from "./generated.ts";
import { existsSync } from "https://deno.land/std/fs/mod.ts";
import { encodeHex } from "https://deno.land/std/encoding/hex.ts";

const mov_file = ".mov";
const heic_file = ".heic";
const name_arg = "{NAME}";
const in_arg = "{INPUT}";

async function transcode() {
  let fail = 0;
  for (const file of Deno.readDirSync(".")) {
    const ext = extname(file.name).toLowerCase();

    let target = "";
    let command = "";
    let args: Array<string> = [];
    switch (ext) {
      case heic_file:
        target = "jpeg";
        command = "sips";
        args = ["--setProperty", "format", "jpeg", "--out", name_arg, in_arg];
        break;
      case mov_file:
        target = "mp4";
        command = "avconvert";
        args = ["-s", in_arg, "-o", name_arg, "-p", "PresetHEVCHighestQuality"];
        break;
      default:
        continue;
    }

    const now = new Date();
    const time = format(now, "HHmmss");
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(file.name),
    );

    const hash = encodeHex(buffer).substring(0, 7);
    const name = `${now.getFullYear()}.T_${time}.${hash}.${target}`;
    console.log(`${file.name} -> ${name}`);
    if (existsSync(name)) {
      console.log("   ...already exists...");
      fail = 1;
      continue;
    }

    const subbed: Array<string> = [];
    args.forEach((a) => {
      switch (a) {
        case name_arg:
          subbed.push(name);
          break;
        case in_arg:
          subbed.push(file.name);
          break;
        default:
          subbed.push(a);
      }
    });

    const cmd = new Deno.Command(command, {
      args: subbed,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (cmd.outputSync().code !== 0) {
      if (existsSync(name)) {
        Deno.removeSync(name);
      }
      console.log("   failed");
      fail = 1;
      continue;
    }
    Deno.removeSync(file.name);
  }
  Deno.exit(fail);
}

if (import.meta.main) {
  main(transcode);
}

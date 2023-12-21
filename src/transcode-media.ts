import { extname } from "std/path/mod.ts";
import { format } from "std/datetime/mod.ts";
import { existsSync } from "std/fs/mod.ts";
import { encodeHex } from "std/encoding/hex.ts";

const MOV_FILE = ".mov";
const HEIC_FILE = ".heic";
const NAME_ARG = "{NAME}";
const IN_ARG = "{INPUT}";

export async function transcode() {
  let fail = 0;
  for (const file of Deno.readDirSync(".")) {
    const ext = extname(file.name).toLowerCase();

    let target = "";
    let command = "";
    let args: Array<string> = [];
    switch (ext) {
      case HEIC_FILE:
        target = "jpeg";
        command = "sips";
        args = ["--setProperty", "format", "jpeg", "--out", NAME_ARG, IN_ARG];
        break;
      case MOV_FILE:
        target = "mp4";
        command = "avconvert";
        args = ["-s", IN_ARG, "-o", NAME_ARG, "-p", "PresetHEVCHighestQuality"];
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
    let prefix = "";
    const day = now.getDate();
    if (day < 10) {
      prefix = "0";
    }
    const hash = encodeHex(buffer).substring(0, 7);
    const name = `${prefix}${day}.T_${time}.${hash}.${target}`;
    console.log(`${file.name} -> ${name}`);
    if (existsSync(name)) {
      console.log("   ...already exists...");
      fail = 1;
      continue;
    }

    const subbed: Array<string> = [];
    args.forEach((a) => {
      switch (a) {
        case NAME_ARG:
          subbed.push(name);
          break;
        case IN_ARG:
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

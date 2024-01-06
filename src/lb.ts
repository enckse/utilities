import { join } from "std/path/mod.ts";
import { format } from "std/datetime/mod.ts";
import { existsSync } from "std/fs/mod.ts";
import { encodeHex } from "std/encoding/hex.ts";
import { parse } from "std/csv/mod.ts";
import { red } from "std/fmt/colors.ts";
import { parse as parseConfig } from "std/yaml/mod.ts";
import { BASH_ARG, getEnv, messageAndExitNonZero } from "./common.ts";

const LIST_COMMAND = "ls";
const SHOW_COMMAND = "show";
const CLIP_COMMAND = "clip";
const TOTP_COMMAND = "totp";
const CLEAR_COMMAND = "clipboard";
const TOTP_TOKEN = "/totp";
const GROUP_SEPARATOR = "/";
const EXECUTABLE = "lb";
const BASH_COMPLETION = `# ${EXECUTABLE} completion

_${EXECUTABLE}() {
  local cur opts
  cur=\${COMP_WORDS[COMP_CWORD]}
  if [ "$COMP_CWORD" -eq 1 ]; then
    opts="\${opts}${LIST_COMMAND} "
    opts="\${opts}${SHOW_COMMAND} "
    opts="\${opts}${CLIP_COMMAND} "
    opts="\${opts}${TOTP_COMMAND} "
    # shellcheck disable=SC2207
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  else
    if [ "$COMP_CWORD" -eq 2 ]; then
      case \${COMP_WORDS[1]} in
        "${TOTP_COMMAND}")
          opts="${LIST_COMMAND} "
          opts="$opts ${SHOW_COMMAND}"
          opts="$opts ${CLIP_COMMAND}"
          ;;
        "${SHOW_COMMAND}" | "${CLIP_COMMAND}" )
          opts=$(${EXECUTABLE} ${LIST_COMMAND})
          ;;
      esac
    else
      if [ "$COMP_CWORD" -eq 3 ]; then
        case "\${COMP_WORDS[1]}" in
          "${TOTP_COMMAND}")
            case "\${COMP_WORDS[2]}" in
              "${SHOW_COMMAND}" | "${CLIP_COMMAND}")
                opts=$(${EXECUTABLE} ${TOTP_COMMAND} ${LIST_COMMAND})
                ;;
            esac
            ;;
        esac
      fi
    fi
    if [ -n "$opts" ]; then
      # shellcheck disable=SC2207
      COMPREPLY=($(compgen -W "$opts" -- "$cur"))
    fi
  fi
}

complete -F _${EXECUTABLE} -o bashdefault ${EXECUTABLE}`;

async function inOutCommand(
  stdin: Uint8Array,
  cmd: string,
  args: Array<string>,
): Promise<string> {
  const command = new Deno.Command(cmd, {
    args: args,
    stdin: "piped",
    stdout: "piped",
  });
  const process = command.spawn();
  const writer = process.stdin.getWriter();
  writer.write(stdin);
  writer.releaseLock();
  await process.stdin.close();
  const result = await process.output();
  return new TextDecoder().decode(result.stdout).trim();
}

interface StoreConfig {
  root: string;
  key: Array<string>;
  keyfile: string;
  database: string;
}

interface OptionsConfig {
  app: string;
  clipboard: number;
}

interface Config {
  store: StoreConfig;
  options: OptionsConfig;
}

class App {
  private readonly database: string;
  private readonly keyfile: string;
  private readonly command: string;
  private readonly command_args: Array<string>;
  private key?: Uint8Array;
  private readonly inCommand: Array<string>;
  constructor(
    root: string,
    database: string,
    key: Array<string>,
    keyfile: string,
    private readonly app: string,
    private readonly clip: number,
  ) {
    this.database = join(root, database);
    this.keyfile = join(root, keyfile);
    this.command = key[0];
    this.command_args = key.slice(1);
    this.inCommand = key;
  }
  env() {
    const exports = {
      "KEY": this.inCommand.join(" "),
      "KEYFILE": this.keyfile,
      "DATABASE": this.database,
    };
    for (const [key, val] of Object.entries(exports)) {
      console.log(`export LB_${key}="${val}"`);
    }
  }
  async clearClipboard(hash: string, count: number) {
    if (count === this.clip) {
      await inOutCommand(new Uint8Array(0), "pbcopy", []);
      return;
    }
    setTimeout(async () => {
      const cmd = new Deno.Command("pbpaste", { stdout: "piped" });
      const stdout = cmd.outputSync().stdout;
      const hashed = await hashValue(
        new TextEncoder().encode(new TextDecoder().decode(stdout).trim()),
      );
      if (hashed == hash) {
        this.clearClipboard(hash, count + 1);
      }
    }, 1000);
  }
  private async query(
    arg: string,
    args: Array<string>,
  ): Promise<Array<string>> {
    return await this.keepassxc(this.database, arg, args);
  }
  private async keepassxc(
    store: string | undefined,
    arg: string,
    args: Array<string>,
  ): Promise<Array<string>> {
    if (this.key === undefined) {
      const proc = new Deno.Command(this.command, {
        args: this.command_args,
        stdout: "piped",
      });
      const stdout = proc.outputSync().stdout;
      this.key = new TextEncoder().encode(
        new TextDecoder().decode(stdout).trim(),
      );
    }
    let useStore = store;
    if (useStore === undefined) {
      useStore = this.database;
    }
    const appArgs: Array<string> = [
      arg,
      "--quiet",
      "--key-file",
      this.keyfile,
      useStore,
      ...args,
    ];
    const data = await inOutCommand(this.key, this.app, appArgs);
    return data.split("\n");
  }

  async list(totp: boolean) {
    const entries = await this.query("ls", ["-R", "-f"]);
    for (const entry of entries.sort()) {
      if (entry.endsWith(GROUP_SEPARATOR)) {
        continue;
      }
      const totpEntry = entry.endsWith(TOTP_TOKEN);
      if (totp) {
        if (!totpEntry) {
          continue;
        }
      } else {
        if (totpEntry) {
          continue;
        }
      }
      console.log(entry);
    }
  }
  private async entry(
    clip: boolean,
    totp: boolean,
    entry: string,
  ): Promise<Array<string>> {
    if (entry.endsWith(GROUP_SEPARATOR)) {
      messageAndExitNonZero(
        "invalid entry, group detected",
      );
    }
    const args: Array<string> = ["--show-protected"];
    if (totp) {
      args.push("--totp");
    }
    const allowed: Array<string> = ["Password"];
    if (!clip) {
      allowed.push("Notes");
    }
    for (const allow of allowed) {
      const tryArgs = args.concat(["--attributes", allow, entry]);
      const val = await this.query("show", tryArgs);
      let viable = false;
      val.forEach((x) => {
        if (x.trim() !== "") {
          viable = true;
        }
      });
      if (viable) {
        return val;
      }
    }
    return messageAndExitNonZero<Array<string>>(
      "unable to find entry",
    );
  }
  private async output(val: string, clip: boolean) {
    if (!clip) {
      console.log(val);
      return;
    }
    console.log(`clipboard will clear in ${this.clip} (seconds)`);
    const encoded = new TextEncoder().encode(val);
    await inOutCommand(encoded, "pbcopy", []);
    const hash = await hashValue(encoded);
    const command = new Deno.Command(EXECUTABLE, {
      args: [CLEAR_COMMAND, hash],
      stdout: "inherit",
      stderr: "inherit",
    });
    const child = command.spawn();
    child.unref();
    Deno.exit(0);
  }
  async showClip(clip: boolean, entry: string) {
    if (entry.endsWith(TOTP_TOKEN)) {
      messageAndExitNonZero("invalid entry, is totp token");
    }
    const val = await this.entry(clip, false, entry);
    this.output(val.join("\n").trim(), clip);
  }
  async totp(clip: boolean, entry: string) {
    if (!entry.endsWith(TOTP_TOKEN)) {
      messageAndExitNonZero("invalid entry, is not totp");
    }
    const val = await this.entry(clip, true, entry);
    val.forEach((v) => {
      const trimmed = v.trim();
      let valid = false;
      if (trimmed.length === 6) {
        valid = true;
        for (const chr of trimmed) {
          if (chr >= "0" && chr <= "9") {
            continue;
          }
          valid = false;
          break;
        }
      }
      if (valid) {
        const now = new Date();
        const time = format(now, "HH:mm:ss");
        const seconds = 59 - now.getSeconds();
        let display = seconds.toString();
        if (seconds < 10) {
          display = `0${display}`;
        }
        display = `(${display} seconds)`;
        if (
          (seconds >= 30 && seconds <= 35) || (seconds >= 0 && seconds <= 5)
        ) {
          display = red(display);
        }
        console.log(`expires at: ${time} ${display}`);
        if (!clip) {
          console.log();
        }
        this.output(trimmed, clip);
        if (!clip) {
          console.log();
        }
        return;
      }
    });
  }
  async convert(store: string) {
    const data = await this.keepassxc(store, "export", ["--format", "csv"]);
    const parsed = parse(data.join("\n"), {
      skipFirstRow: true,
      strip: true,
    });
    const keys = new Map<string, Map<string, string>>();
    for (const record of parsed) {
      let entry = "";
      for (const item of ["Group", "Title", "Username"]) {
        const value = (record[item] as string).trim();
        if (value === "") {
          continue;
        }
        if (entry.length > 0) {
          entry = `${entry}/`;
        }
        entry = `${entry}${value}`;
      }
      const hashing: Array<string> = [];
      for (const item of ["Password", "TOTP", "Notes"]) {
        hashing.push((record[item] as string).trim());
      }
      const hashed = await hashValue(
        new TextEncoder().encode(hashing.join("")),
      );
      const obj = new Map<string, string>();
      obj.set("modtime", record["Last Modified"] as string);
      obj.set("hash", hashed);
      keys.set(entry, obj);
    }
    new Map([...keys].sort()).forEach((value, key) => {
      console.log(`${key}: {`);
      new Map([...value].sort()).forEach((v, k) => {
        console.log(`  ${k}: ${v}`);
      });
      console.log("}");
    });
  }
}

async function hashValue(value: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    value,
  );
  return encodeHex(buffer).substring(0, 7);
}

export async function lockbox(args: Array<string>) {
  if (args.length === 0) {
    messageAndExitNonZero("arguments required");
  }
  const command = args[0];
  const home = getEnv("HOME");
  const config = join(home, ".config", "voidedtech", "lb.yaml");
  if (!existsSync(config)) {
    messageAndExitNonZero("missing configuration file");
  }
  const data = new TextDecoder().decode(Deno.readFileSync(config));
  const yaml = parseConfig(data.replaceAll("~", home)) as Config;
  const app = new App(
    yaml.store.root,
    yaml.store.database,
    yaml.store.key,
    yaml.store.keyfile,
    yaml.options.app,
    yaml.options.clipboard,
  );
  switch (command) {
    case TOTP_COMMAND: {
      if (args.length < 2) {
        messageAndExitNonZero("invalid totp arguments");
      }
      const sub = args[1];
      switch (sub) {
        case LIST_COMMAND:
          requireArgs(args, 2);
          await app.list(true);
          break;
        case SHOW_COMMAND:
        case CLIP_COMMAND:
          requireArgs(args, 3);
          await app.totp(sub === CLIP_COMMAND, args[2]);
          break;
        default:
          messageAndExitNonZero("unknown totp command");
      }
      break;
    }
    case "env":
      app.env();
      break;
    case BASH_ARG:
      requireArgs(args, 2);
      Deno.writeTextFileSync(args[1], BASH_COMPLETION);
      break;
    case "conv":
      requireArgs(args, 2);
      await app.convert(args[1]);
      break;
    case CLEAR_COMMAND:
      requireArgs(args, 2);
      await app.clearClipboard(args[1], 0);
      break;
    case LIST_COMMAND:
      requireArgs(args, 1);
      await app.list(false);
      break;
    case CLIP_COMMAND:
    case SHOW_COMMAND: {
      requireArgs(args, 2);
      await app.showClip(command === CLIP_COMMAND, args[1]);
      break;
    }
    default:
      messageAndExitNonZero("unknown command");
  }
}

function requireArgs(args: Array<string>, count: number) {
  if (args.length !== count) {
    messageAndExitNonZero("invalid arguments passed");
  }
}

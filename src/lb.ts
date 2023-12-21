import { join } from "std/path/mod.ts";
import { format } from "std/datetime/mod.ts";
import { existsSync } from "std/fs/mod.ts";
import { encodeHex } from "std/encoding/hex.ts";
import { parse } from "std/csv/mod.ts";
import { red } from "std/fmt/colors.ts";

const list_command = "ls";
const show_command = "show";
const clip_command = "clip";
const totp_command = "totp";
const pb_command = "clipboard";
const totp_tokens = "/totp";
const is_group = "/";
const executable = "lb";
const bash_completion = `# ${executable} completion

_${executable}() {
  local cur opts
  cur=\${COMP_WORDS[COMP_CWORD]}
  if [ "$COMP_CWORD" -eq 1 ]; then
    opts="\${opts}${list_command} "
    opts="\${opts}${show_command} "
    opts="\${opts}${clip_command} "
    opts="\${opts}${totp_command} "
    # shellcheck disable=SC2207
    COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
  else
    if [ "$COMP_CWORD" -eq 2 ]; then
      case \${COMP_WORDS[1]} in
        "${totp_command}")
          opts="${list_command} "
          opts="$opts ${show_command}"
          opts="$opts ${clip_command}"
          ;;
        "${show_command}" | "${clip_command}" )
          opts=$(${executable} ${list_command})
          ;;
      esac
    else
      if [ "$COMP_CWORD" -eq 3 ]; then
        case "\${COMP_WORDS[1]}" in
          "${totp_command}${totp_command}${totp_command}${totp_command}")
            case "\${COMP_WORDS[2]}" in
              "${show_command}" | "${clip_command}")
                opts=$(${executable} ${totp_command} ${list_command})
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

complete -F _${executable} -o bashdefault ${executable}`;

async function stdin_stdout_command(
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

class Config {
  private database: string;
  private keyfile: string;
  private command: string;
  private command_args: Array<string>;
  private app: string;
  private clip: number;
  private sync: string;
  private root: string;
  private key: Uint8Array | undefined;
  constructor(
    root: string,
    database: string,
    key: Array<string>,
    keyfile: string,
    app: string,
    clipboard: number,
    sync: string,
  ) {
    this.database = join(root, database);
    this.keyfile = join(root, keyfile);
    this.root = root;
    this.command = key[0];
    this.command_args = key.slice(1);
    this.app = app;
    this.clip = clipboard;
    this.sync = sync;
    this.key = undefined;
  }
  initialize() {
    if (this.sync === undefined || this.sync === "") {
      return;
    }
    const hook = join(this.root, ".git", "hooks", "post-commit");
    if (existsSync(hook)) {
      Deno.removeSync(hook);
    }
    Deno.writeTextFileSync(
      hook,
      `#!/bin/sh\nrsync ${this.database} ${this.sync}`,
      {
        mode: 0o755,
      },
    );
  }
  async clear_clipboard(hash: string, count: number) {
    if (count === this.clip) {
      await stdin_stdout_command(new Uint8Array(0), "pbcopy", []);
      return;
    }
    setTimeout(async () => {
      const cmd = new Deno.Command("pbpaste", { stdout: "piped" });
      const stdout = cmd.outputSync().stdout;
      const hashed = await hash_value(
        new TextEncoder().encode(new TextDecoder().decode(stdout).trim()),
      );
      if (hashed == hash) {
        this.clear_clipboard(hash, count + 1);
      }
    }, 1000);
  }
  async query(arg: string, args: Array<string>): Promise<Array<string>> {
    return await this.keepassxc(this.database, arg, args);
  }
  async keepassxc(
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
    let use_store = store;
    if (use_store === undefined) {
      use_store = this.database;
    }
    let app_args: Array<string> = [
      arg,
      "--quiet",
      "--key-file",
      this.keyfile,
      use_store,
    ];
    app_args = app_args.concat(args);
    const data = await stdin_stdout_command(this.key, this.app, app_args);
    return data.split("\n");
  }

  async ls(is_totp: boolean) {
    const entries = await this.query("ls", ["-R", "-f"]);
    for (const entry of entries.sort()) {
      if (entry.endsWith(is_group)) {
        continue;
      }
      const is_totp_entry = entry.endsWith(totp_tokens);
      if (is_totp) {
        if (!is_totp_entry) {
          continue;
        }
      } else {
        if (is_totp_entry) {
          continue;
        }
      }
      console.log(entry);
    }
  }
  async get_entry(
    is_clip: boolean,
    is_totp: boolean,
    entry: string,
  ): Promise<Array<string>> {
    if (entry.endsWith(is_group)) {
      console.log("invalid entry, group detected");
      Deno.exit(1);
    }
    const args: Array<string> = ["--show-protected"];
    if (is_totp) {
      args.push("--totp");
    }
    const allowed: Array<string> = ["Password"];
    if (!is_clip) {
      allowed.push("Notes");
    }
    for (const allow of allowed) {
      const try_args = args.concat(["--attributes", allow, entry]);
      const val = await this.query("show", try_args);
      if (val.length > 0) {
        return val;
      }
    }
    console.log("unable to find entry");
    Deno.exit(1);
  }
  async output(val: string, is_clip: boolean) {
    if (!is_clip) {
      console.log(val);
      return;
    }
    console.log(`clipboard will clear in ${this.clip} (seconds)`);
    const encoded = new TextEncoder().encode(val);
    await stdin_stdout_command(encoded, "pbcopy", []);
    const hash = await hash_value(encoded);
    const command = new Deno.Command(executable, {
      args: [pb_command, hash],
      stdout: "inherit",
      stderr: "inherit",
    });
    const child = command.spawn();
    child.unref();
    Deno.exit(0);
  }
  async show_clip(is_clip: boolean, entry: string) {
    if (entry.endsWith(totp_tokens)) {
      console.log("invalid entry, is totp token");
      Deno.exit(1);
    }
    const val = await this.get_entry(is_clip, false, entry);
    this.output(val[0].trim(), is_clip);
  }
  async totp(is_clip: boolean, entry: string) {
    if (!entry.endsWith(totp_tokens)) {
      console.log("invalid entry, is not totp");
      Deno.exit(1);
    }
    const val = await this.get_entry(is_clip, true, entry);
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
        if (!is_clip) {
          console.log();
        }
        this.output(trimmed, is_clip);
        if (!is_clip) {
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
      const hashed = await hash_value(
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

async function hash_value(value: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    value,
  );
  return encodeHex(buffer).substring(0, 7);
}

export async function lockbox(args: Array<string>) {
  if (args.length === 0) {
    console.log("arguments required");
    Deno.exit(1);
  }
  const command = args[0];
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    console.log("HOME is not set");
    Deno.exit(1);
  }
  const config = join(home, ".config", "voidedtech", "lb.json");
  if (!existsSync(config)) {
    console.log("missing configuration file");
    Deno.exit(1);
  }
  const data = new TextDecoder().decode(Deno.readFileSync(config));
  const json = JSON.parse(data.replaceAll("~", home));
  const store = json["store"];
  const opts = json["options"];
  const cfg = new Config(
    store["root"],
    store["database"],
    store["key"],
    store["keyfile"],
    opts["app"],
    opts["clipboard"],
    opts["sync"],
  );
  switch (command) {
    case totp_command: {
      if (args.length < 2) {
        console.log("invalid totp arguments");
        Deno.exit(1);
      }
      const sub = args[1];
      switch (sub) {
        case list_command:
          require_args(args, 2);
          await cfg.ls(true);
          break;
        case show_command:
        case clip_command:
          require_args(args, 3);
          await cfg.totp(sub === clip_command, args[2]);
          break;
        default:
          console.log("unknown totp command");
          Deno.exit(1);
      }
      break;
    }
    case "init":
      require_args(args, 1);
      cfg.initialize();
      break;
    case "--bash":
      require_args(args, 1);
      console.log(bash_completion);
      break;
    case "conv":
      require_args(args, 2);
      await cfg.convert(args[1]);
      break;
    case pb_command:
      require_args(args, 2);
      await cfg.clear_clipboard(args[1], 0);
      break;
    case list_command:
      require_args(args, 1);
      await cfg.ls(false);
      break;
    case clip_command:
    case show_command: {
      require_args(args, 2);
      await cfg.show_clip(command === clip_command, args[1]);
      break;
    }
    default:
      console.log("unknown command");
      Deno.exit(1);
  }
}

function require_args(args: Array<string>, count: number) {
  if (args.length !== count) {
    console.log("invalid arguments passed");
    Deno.exit(1);
  }
}

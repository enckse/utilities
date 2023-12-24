import { join } from "std/path/mod.ts";
import { SEP } from "std/path/separator.ts";
import { existsSync, moveSync, walkSync } from "std/fs/mod.ts";
import { format, MINUTE } from "std/datetime/mod.ts";
import { encodeHex } from "std/encoding/hex.ts";

const WORK_DIR = "build";
const FILE_META = "files";
const SDS_DIR = ".sds";
const DATA_DIR = "data";
const ADDED_DIFF = "+";
const MINUS_DIFF = "-";
const BOTH_DIFF = "+/-";

function commitDir(target: string): string | undefined {
  const now = new Date();
  const time = format(now, "yyyy.MM.dd.HH.mm.ss");
  let idx = 0;
  while (true) {
    if (idx > 9) {
      console.log("maximum index reached");
      return undefined;
    }
    const dest = join(target, `${time}.${idx}`);
    if (!existsSync(dest)) {
      Deno.mkdirSync(dest);
      return dest;
    }
    idx++;
  }
}

async function run(args: Array<string>): Promise<boolean> {
  if (args.length === 0) {
    console.log("arguments required");
    return false;
  }
  const home = Deno.env.get("HOME");
  if (home === undefined) {
    console.log("HOME not set");
    return false;
  }
  const config = join(home, ".config", "voidedtech", "sds.json");
  if (!existsSync(config)) {
    console.log("config file does not exist");
    return false;
  }
  const data = Deno.readTextFileSync(config).replaceAll("~", home);
  const cfg = JSON.parse(data);
  const bundles = cfg["bundles"];
  const store = cfg["store"];
  const cache = cfg["cache"];
  if (!existsSync(store)) {
    console.log("store does not eixst");
    return false;
  }
  if (!existsSync(bundles)) {
    console.log("bundle location does not exist");
    return false;
  }
  if (!existsSync(cache)) {
    Deno.mkdirSync(cache);
  }
  const command = args[0];
  switch (command) {
    case "ls": {
      for (const dir of Deno.readDirSync(store)) {
        console.log(dir.name);
      }
      break;
    }
    case "exec":
      return execute(cache, requireArg(args));
    case "init": {
      for (const dir of [SDS_DIR, DATA_DIR]) {
        if (!existsSync(dir)) {
          Deno.mkdirSync(dir);
        }
      }
      break;
    }
    case "diff":
      return since(cfg["since"], store, requireArg(args));
    case "commit":
    case "checkout": {
      return await sync(
        store,
        requireArg(args),
        bundles,
        cache,
        command === "checkout",
      );
    }
    default:
      console.log("unknown command");
      return false;
  }

  return true;
}

function since(days: number, store: string, name: string): boolean {
  const path = join(store, name, SDS_DIR);
  if (!existsSync(path)) {
    console.log("not an sds store");
    return false;
  }
  const cutoff = new Date().getTime() - (days * 86400000);
  const results: Map<string, Array<string>> = new Map<string, Array<string>>();
  for (const dir of Deno.readDirSync(path)) {
    if (dir.isDirectory) {
      const dir_name = join(path, dir.name);
      const stats = Deno.statSync(dir_name);
      if (stats.mtime !== null && stats.mtime.getTime() > cutoff) {
        const files = join(dir_name, FILE_META);
        if (existsSync(files)) {
          for (const line of Deno.readTextFileSync(files).split("\n")) {
            const trim = line.trim();
            if (trim.length === 0) {
              continue;
            }
            const prefix = trim[0];
            const fileName = trim.slice(1);
            let prefixes = results.get(fileName);
            if (prefixes === undefined) {
              prefixes = [prefix];
            } else {
              if (prefixes.indexOf(prefix) < 0) {
                prefixes.push(prefix);
              }
            }
            results.set(fileName, prefixes);
          }
        }
      }
    }
  }
  [...results.keys()].sort().map((key) => {
    const prefixes = results.get(key);
    if (prefixes !== undefined) {
      let report = BOTH_DIFF;
      if (prefixes.length === 1) {
        report = ` ${prefixes[0]} `;
      }
      return `${report} ${key}`;
    }
  }).sort().forEach((e) => {
    console.log(e);
  });
  return true;
}

function execute(cache: string, script: string) {
  const path = join(cache, WORK_DIR);
  if (!existsSync(path)) {
    console.log("no working directory, no checkout?");
    return false;
  }
  if (!existsSync(script)) {
    console.log("no script found");
    return false;
  }
  const cmd = new Deno.Command(script, {
    stdout: "inherit",
    stderr: "inherit",
    cwd: path,
  });
  if (cmd.outputSync().code !== 0) {
    console.log("command failed");
    return false;
  }
  return true;
}

async function sync(
  store: string,
  name: string,
  bundles: string,
  cache: string,
  isCheckout: boolean,
): Promise<boolean> {
  const storeTo = join(store, name);
  const metaDir = join(storeTo, SDS_DIR);
  const dataDir = join(storeTo, DATA_DIR);
  for (const dir of [storeTo, metaDir, dataDir]) {
    if (!existsSync(dir)) {
      console.log(`${dir} is required but missing`);
      return false;
    }
  }
  const working = join(cache, WORK_DIR);
  const hasWorking = existsSync(working);
  let from = working;
  let to = dataDir;
  let changed = false;
  if (isCheckout) {
    from = dataDir;
    to = working;
    if (hasWorking) {
      Deno.removeSync(working, { recursive: true });
    }
    Deno.mkdirSync(working);
  } else {
    if (!hasWorking) {
      console.log("no working directory to commit");
      return false;
    }
    const commit = commitDir(metaDir);
    if (commit === undefined) {
      return false;
    }
    const sourceFiles = [...loadFiles(dataDir)].sort();
    const workFiles = [...loadFiles(working)].sort();
    const fileDiff = [
      ...diffList(MINUS_DIFF, sourceFiles, workFiles),
      ...diffList(ADDED_DIFF, workFiles, sourceFiles),
    ];
    if (fileDiff.length > 0) {
      Deno.writeTextFileSync(join(commit, FILE_META), fileDiff.join("\n"));
      changed = true;
    }
    if (
      await diffContents(
        true,
        MINUS_DIFF,
        commit,
        dataDir,
        working,
        sourceFiles,
        workFiles,
      )
    ) {
      changed = true;
    }
    if (
      await diffContents(
        false,
        ADDED_DIFF,
        commit,
        working,
        dataDir,
        workFiles,
        sourceFiles,
      )
    ) {
      changed = true;
    }
    if ([...Deno.readDirSync(commit)].length === 0) {
      Deno.remove(commit);
    }
  }
  const rsync = new Deno.Command("rsync", {
    args: [
      ...debugFlags(["-ac", "--delete-after"], "RSYNC"),
      `${from}${SEP}`,
      to,
    ],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (rsync.outputSync().code !== 0) {
    console.log("rsync failed");
    return false;
  }
  const bundle = join(bundles, `${name}.tar.gz`);
  if (!isCheckout && !changed) {
    if (!existsSync(bundle)) {
      changed = true;
    }
  }
  if (!changed) {
    return true;
  }
  console.log("bundling");
  const newBundle = `${bundle}.tmp`;
  const tar = new Deno.Command("tar", {
    args: [...debugFlags(["czf"], "TAR"), newBundle, "-C", dataDir, "."],
    stdout: "inherit",
    stderr: "inherit",
  });
  if (tar.outputSync().code !== 0) {
    console.log("failed to bundle via tar");
    if (existsSync(newBundle)) {
      Deno.removeSync(newBundle);
    }
    return false;
  }
  if (existsSync(bundle)) {
    Deno.removeSync(bundle);
  }
  moveSync(newBundle, bundle);

  return true;
}

function debugFlags(defaults: Array<string>, key: string): Array<string> {
  let val = Deno.env.get(`SDS_${key}`);
  if (val !== undefined) {
    val = val.trim();
    if (val !== "") {
      return val.split(" ");
    }
  }
  return defaults;
}

function alphaNumeric(name: string): string {
  let result = "";
  for (const chr of name) {
    if (
      (chr === "-") || (chr >= "a" && chr <= "z") || (chr >= "0" && chr <= "9")
    ) {
      result = `${result}${chr}`;
    }
  }
  return result;
}

async function diffContents(
  first: boolean,
  prefix: string,
  commit: string,
  source: string,
  other: string,
  sourceFiles: Array<string>,
  otherFiles: Array<string>,
): Promise<boolean> {
  let differences = false;
  for (const file of sourceFiles) {
    let name = file.replaceAll("/", "-").replaceAll(" ", "-").toLowerCase();
    name = alphaNumeric(name);
    if (name.startsWith("-")) {
      name = name.slice(1);
    }
    name = name.slice(0, 50);
    const buffer = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(file),
    );
    const hash = encodeHex(buffer).substring(0, 7);
    name = `${name}.${hash}`;
    name = join(commit, name);
    const sourceFile = join(source, file);
    if (otherFiles.indexOf(file) >= 0) {
      if (first) {
        const otherFile = join(other, file);
        const command = new Deno.Command("diff", {
          args: ["--unified=0", sourceFile, otherFile],
          stdout: "piped",
        });
        const { code, stdout } = command.outputSync();
        if (code !== 0) {
          differences = true;
          const out = new TextDecoder().decode(stdout);
          Deno.writeTextFileSync(name, `${BOTH_DIFF}\n===\n${out}`);
        }
      }
    } else {
      let raw = Deno.readTextFileSync(sourceFile);
      raw = `${prefix}${prefix}${prefix}\n${raw}`;
      Deno.writeTextFileSync(name, raw);
      differences = true;
    }
  }
  return differences;
}

function* diffList(
  prefix: string,
  one: Array<string>,
  two: Array<string>,
) {
  for (const entry of one) {
    if (two.indexOf(entry) >= 0) {
      continue;
    }
    yield `${prefix}${entry}`;
  }
}

function* loadFiles(path: string) {
  for (const dir of walkSync(path)) {
    if (dir.isFile) {
      const d = dir.path.replace(path, "");
      yield d;
    }
  }
}

function requireArg(args: Array<string>): string {
  if (args.length === 1) {
    console.log("sds argument required");
    Deno.exit(1);
  }
  return args[1];
}

export async function simpleDiffService(args: Array<string>) {
  if (!await run(args)) {
    Deno.exit(1);
  }
}

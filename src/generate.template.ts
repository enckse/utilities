export function main(callback: () => void) {
  if (Deno.args.length > 0) {
    switch (Deno.args[0]) {
      case "--version":
        console.log("version: VERSION");
        return;
    }
  }
  callback();
}

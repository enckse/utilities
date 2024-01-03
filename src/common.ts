export const BASH_ARG = "--bash";
export function messageAndExitNonZero<T>(message?: string): Promise<T> {
  if (message !== undefined) {
    Deno.stderr.write(new TextEncoder().encode(message));
  }
  Deno.exit(1);
}

export function getEnv(key: string): string {
  const val = Deno.env.get(key);
  if (val === undefined) {
    messageAndExitNonZero(`${key} is not set`);
    return "";
  }
  return val;
}

export function info(scope: string, msg: string, data?: unknown): void {
  const line = data === undefined ? msg : `${msg} ${JSON.stringify(data)}`;
  process.stdout.write(`${new Date().toISOString()} [${scope}] ${line}\n`);
}

export function warn(scope: string, msg: string, data?: unknown): void {
  const line = data === undefined ? msg : `${msg} ${JSON.stringify(data)}`;
  process.stderr.write(`${new Date().toISOString()} [${scope}] WARN ${line}\n`);
}

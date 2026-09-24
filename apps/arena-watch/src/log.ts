// Structured logging to stdout. Under systemd this lands in journald, one JSON
// object per line, filterable with `journalctl -u c4-watch -o cat | jq`.

export type LogFields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: LogFields): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  const out = level === 'error' ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  info: (msg: string, fields?: LogFields) => emit('info', msg, fields),
  warn: (msg: string, fields?: LogFields) => emit('warn', msg, fields),
  error: (msg: string, fields?: LogFields) => emit('error', msg, fields),
};

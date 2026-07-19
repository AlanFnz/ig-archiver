type LogContext = Record<string, unknown>;
function write(level: 'info' | 'warn' | 'error', event: string, message: string, context: LogContext = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
    ...context,
  };
  const line = JSON.stringify(record);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
  return record;
}

export const logger = {
  info: (event: string, message: string, context: LogContext = {}) => write('info', event, message, context),
  warn: (event: string, message: string, context: LogContext = {}) => write('warn', event, message, context),
  error: (event: string, message: string, context: LogContext = {}) => write('error', event, message, context),
};

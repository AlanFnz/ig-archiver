function write(level, event, message, context = {}) {
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
  info: (event, message, context) => write('info', event, message, context),
  warn: (event, message, context) => write('warn', event, message, context),
  error: (event, message, context) => write('error', event, message, context),
};

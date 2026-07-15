import path from 'path';
import { fileURLToPath } from 'url';
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
export const PUBLIC_DIR = path.join(ROOT, 'public');

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) ? value : fallback;
}

function boundedEnvInt(name, fallback, min, max) {
  const value = envInt(name, fallback);
  return value >= min && value <= max ? value : fallback;
}

export const PORT = boundedEnvInt('PORT', 3000, 1, 65_535);
export const HOST = process.env.HOST?.trim() || '127.0.0.1';
export const SCREENSHOTS = path.join(DATA_DIR, 'screenshots');
export const LEGACY_DB_PATH = path.join(DATA_DIR, 'database.json');
export const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'archive.sqlite');
export const SESSION_FILE = path.join(DATA_DIR, 'session.json');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const VIEWPORT_W = boundedEnvInt('SCREENSHOT_WIDTH', 1280, 320, 3_840);
export const VIEWPORT_H = boundedEnvInt('SCREENSHOT_HEIGHT', 720, 320, 2_160);
export const TIMEOUT_MS = boundedEnvInt('TIMEOUT_MS', 30_000, 5_000, 120_000);
export const CONCURRENCY = boundedEnvInt('CONCURRENCY', 3, 1, 8);
export const VALID_CATEGORIES = [
  'References',
  'Memes',
  'Inspiration',
  'Tutorials',
  'News',
  'Ai',
  'Tools',
  'Music production',
  'Movies and shows',
  'Design',
  'Music',
  'Politics',
];

const DEFAULTS = Object.freeze({
  concurrency: CONCURRENCY,
  timeoutMs: TIMEOUT_MS,
  viewportW: VIEWPORT_W,
  viewportH: VIEWPORT_H,
  skipExisting: true,
  retryAttempts: boundedEnvInt('RETRY_ATTEMPTS', 3, 1, 5),
  retryBaseMs: boundedEnvInt('RETRY_BASE_MS', 750, 100, 10_000),
  categories: VALID_CATEGORIES,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
});

const EDITABLE_KEYS = new Set([
  'concurrency',
  'timeoutMs',
  'viewportW',
  'viewportH',
  'skipExisting',
  'retryAttempts',
  'retryBaseMs',
  'categories',
  'openaiModel',
  'openaiBaseUrl',
  'openaiApiKey',
]);

function readStoredConfig() {
  if (!existsSync(CONFIG_PATH)) return {};

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return validatePatch(parsed);
  } catch (err) {
    console.warn(`[ig-archiver] Could not read config.json: ${err.message}`);
    return {};
  }
}

let storedConfig = readStoredConfig();

function assertInteger(value, key, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${key} must be an integer between ${min} and ${max}.`);
  }
}

function validatePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new TypeError('Configuration must be a JSON object.');
  }

  for (const key of Object.keys(patch)) {
    if (!EDITABLE_KEYS.has(key)) throw new TypeError(`Unknown configuration field: ${key}.`);
  }

  if ('concurrency' in patch) assertInteger(patch.concurrency, 'concurrency', 1, 8);
  if ('timeoutMs' in patch) assertInteger(patch.timeoutMs, 'timeoutMs', 5_000, 120_000);
  if ('viewportW' in patch) assertInteger(patch.viewportW, 'viewportW', 320, 3_840);
  if ('viewportH' in patch) assertInteger(patch.viewportH, 'viewportH', 320, 2_160);
  if ('skipExisting' in patch && typeof patch.skipExisting !== 'boolean') {
    throw new TypeError('skipExisting must be a boolean.');
  }
  if ('retryAttempts' in patch) assertInteger(patch.retryAttempts, 'retryAttempts', 1, 5);
  if ('retryBaseMs' in patch) assertInteger(patch.retryBaseMs, 'retryBaseMs', 100, 10_000);

  if ('categories' in patch) {
    if (!Array.isArray(patch.categories) || patch.categories.length < 1 || patch.categories.length > 50) {
      throw new TypeError('categories must contain between 1 and 50 values.');
    }
    const cleaned = patch.categories.map(category =>
      typeof category === 'string' ? category.trim() : '',
    );
    if (cleaned.some(category => !category || category.length > 40)) {
      throw new TypeError('Each category must be a non-empty string of at most 40 characters.');
    }
    if (new Set(cleaned.map(category => category.toLocaleLowerCase())).size !== cleaned.length) {
      throw new TypeError('Category names must be unique.');
    }
    patch.categories = cleaned;
  }

  if ('openaiModel' in patch) {
    if (typeof patch.openaiModel !== 'string' || !patch.openaiModel.trim() || patch.openaiModel.length > 100) {
      throw new TypeError('openaiModel must be a non-empty string of at most 100 characters.');
    }
    patch.openaiModel = patch.openaiModel.trim();
  }

  if ('openaiBaseUrl' in patch) {
    if (typeof patch.openaiBaseUrl !== 'string') throw new TypeError('openaiBaseUrl must be a string.');
    patch.openaiBaseUrl = patch.openaiBaseUrl.trim().replace(/\/$/, '');
    if (patch.openaiBaseUrl) {
      let parsed;
      try {
        parsed = new URL(patch.openaiBaseUrl);
      } catch {
        throw new TypeError('openaiBaseUrl must be a valid HTTP or HTTPS URL.');
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new TypeError('openaiBaseUrl must use HTTP or HTTPS.');
      }
    }
  }

  if ('openaiApiKey' in patch && (typeof patch.openaiApiKey !== 'string' || patch.openaiApiKey.length > 500)) {
    throw new TypeError('openaiApiKey must be a string of at most 500 characters.');
  }

  return patch;
}

export function getConfig() {
  return {
    ...DEFAULTS,
    ...storedConfig,
    categories: [...(storedConfig.categories || DEFAULTS.categories)],
    openaiApiKey: storedConfig.openaiApiKey || process.env.OPENAI_API_KEY || '',
  };
}

export function getPublicConfig() {
  const { openaiApiKey, ...config } = getConfig();
  return { ...config, hasOpenaiApiKey: Boolean(openaiApiKey) };
}

export function setConfig(newConfig) {
  const patch = validatePatch({ ...newConfig });
  const nextConfig = { ...storedConfig, ...patch };
  if ('openaiApiKey' in patch) {
    const key = patch.openaiApiKey.trim();
    if (key) nextConfig.openaiApiKey = key;
    else delete nextConfig.openaiApiKey;
  }

  const temporaryPath = `${CONFIG_PATH}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(nextConfig, null, 2), { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, CONFIG_PATH);
    chmodSync(CONFIG_PATH, 0o600);
  } catch (err) {
    try { unlinkSync(temporaryPath); } catch {}
    throw err;
  }
  storedConfig = nextConfig;
  return getPublicConfig();
}

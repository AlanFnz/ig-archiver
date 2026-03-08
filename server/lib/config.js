import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

export const PORT             = parseInt(process.env.PORT              ?? '3000', 10);
export const SCREENSHOTS      = path.join(ROOT, 'screenshots');
export const DB_PATH          = path.join(ROOT, 'database.json');
export const SESSION_FILE     = path.join(ROOT, 'session.json');
export const VIEWPORT_W       = parseInt(process.env.SCREENSHOT_WIDTH  ?? '1280', 10);
export const VIEWPORT_H       = parseInt(process.env.SCREENSHOT_HEIGHT ?? '720',  10);
export const TIMEOUT_MS       = 30_000;
export const VALID_CATEGORIES = ['References', 'Memes', 'Inspiration', 'Tutorials', 'News', "Ai", "Tools", "Music production", "Movies and shows"];

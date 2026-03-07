// login.js — run once to save an instagram session for the archiver server
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(__dirname, 'session.json');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page    = await context.newPage();

await page.goto('https://www.instagram.com/accounts/login/');

console.log('\n[ig-archiver] A browser window has opened.');
console.log('[ig-archiver] Log in to Instagram, then come back here and press Enter.\n');

await new Promise(resolve => process.stdin.once('data', resolve));

await context.storageState({ path: SESSION_FILE });
await browser.close();

console.log(`[ig-archiver] Session saved → ${SESSION_FILE}`);
console.log('[ig-archiver] Start the server normally — it will pick up the session automatically.\n');

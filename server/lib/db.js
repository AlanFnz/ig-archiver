import { promises as fs } from 'fs';

import { DB_PATH } from './config.js';
export { DB_PATH };

export async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function writeDb(entries) {
  await fs.writeFile(DB_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';

import { closeDatabase, exportArchive } from '../lib/db.js';

const backup = await exportArchive();
const requestedPath = process.argv[2];
const outputPath = path.resolve(requestedPath || `ig-archiver-${backup.exportedAt.slice(0, 10)}.json`);
await fs.writeFile(outputPath, JSON.stringify(backup, null, 2), { encoding: 'utf8', mode: 0o600 });
await closeDatabase();
console.log(`[ig-archiver] Backup written to ${outputPath}`);

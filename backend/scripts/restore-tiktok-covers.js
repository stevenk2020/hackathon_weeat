'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { photoMime } = require('../lib/upstream');

// Copy the cover assets as well as the database when moving an installation.
// Existing files are preserved; no remote requests or database writes are made.
function restoreCovers(source, destination) {
  const result = { copied: 0, existing: 0, invalid: 0 };
  fs.mkdirSync(destination, { recursive: true });
  const types = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const match = /^tiktok-\d{8,25}\.(jpg|png|webp)$/.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const target = path.join(destination, entry.name);
    if (fs.existsSync(target)) { result.existing++; continue; }
    const original = path.join(source, entry.name);
    if (fs.statSync(original).size > 2097152 || photoMime(fs.readFileSync(original)) !== types[match[1]]) {
      result.invalid++;
      continue;
    }
    fs.copyFileSync(original, target, fs.constants.COPYFILE_EXCL);
    result.copied++;
  }
  return result;
}

if (require.main === module) {
  const source = process.argv[2];
  if (!source) {
    console.error('Usage: node --env-file=.env scripts/restore-tiktok-covers.js <previous-cover-directory> [destination]');
    process.exitCode = 1;
  } else {
    console.log(restoreCovers(source, process.argv[3] || process.env.TIKTOK_COVER_DIR || 'data/tiktok-covers'));
  }
}

module.exports = { restoreCovers };

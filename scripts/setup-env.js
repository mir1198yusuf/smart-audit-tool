#!/usr/bin/env node
// Interactive .env scaffolder — walks backend/, frontend/, worker/, migrations/,
// reads each folder's .env.example, and prompts for a value per variable.
// A variable already answered for an earlier folder is reused (not re-asked).
// The frontend's API base URL variable is auto-derived from the backend's PORT
// answer instead of being prompted for.
//
// Every run fully overwrites each folder's .env from scratch (no merging with
// whatever was there before) — only .env.example is the source of truth for
// which keys exist and what comments describe them.

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

const ROOT = path.resolve(__dirname, '..');
const FOLDERS = ['backend', 'frontend', 'worker', 'migrations'];
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const API_URL_KEY = /API.*URL/i;

// Folder-scoped defaults that are never prompted for, even if the same key
// name is asked elsewhere for a different folder.
const HARDCODED_DEFAULTS = {
  worker: {
    PORT: '3001',
    RUN_PING_SERVER: 'false',
  },
};

const answers = new Map();
let backendPort = null;

async function promptNonEmpty(rl, question) {
  for (;;) {
    const value = (await rl.question(question)).trim();
    if (value) return value;
    console.log('  Value cannot be empty.');
  }
}

async function promptBoolean(rl, question) {
  for (;;) {
    const value = (await rl.question(question)).trim();
    if (value === 'true' || value === 'false') return value;
    console.log('  Enter "true" or "false" only.');
  }
}

async function resolveValue(rl, folder, key) {
  const hardcoded = HARDCODED_DEFAULTS[folder] && HARDCODED_DEFAULTS[folder][key];
  if (hardcoded !== undefined) {
    console.log(`  ${key} = ${hardcoded} (default, not prompted)`);
    return hardcoded;
  }

  if (folder === 'frontend' && API_URL_KEY.test(key) && backendPort) {
    const derived = `http://localhost:${backendPort}/api`;
    console.log(`  ${key} = ${derived} (derived from backend PORT)`);
    return derived;
  }

  if (answers.has(key)) {
    const value = answers.get(key);
    console.log(`  ${key} = ${value} (reused)`);
    return value;
  }

  const value = key === 'DB_SSL'
    ? await promptBoolean(rl, `  ${key} (true/false) = `)
    : await promptNonEmpty(rl, `  ${key} = `);
  answers.set(key, value);
  if (folder === 'backend' && key === 'PORT') {
    backendPort = value;
  }
  return value;
}

async function processFolder(rl, folder) {
  const examplePath = path.join(ROOT, folder, '.env.example');
  if (!fs.existsSync(examplePath)) {
    console.log(`\n${folder}/.env.example not found, skipping.`);
    return;
  }

  console.log(`\n${folder}/`);

  const exampleLines = fs.readFileSync(examplePath, 'utf8').split(/\r?\n/);
  const envPath = path.join(ROOT, folder, '.env');
  const outLines = [];

  for (const line of exampleLines) {
    const match = line.trim().match(KEY_LINE);
    if (!match) continue;

    const key = match[1];
    const value = await resolveValue(rl, folder, key);
    outLines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, outLines.join('\n') + '\n');
  console.log(`  Wrote ${folder}/.env`);
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const folder of FOLDERS) {
      await processFolder(rl, folder);
    }
  } finally {
    rl.close();
  }
  console.log('\nDone.');
}

main();

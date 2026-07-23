const { execSync } = require('child_process');

const direction = process.argv[2];
const filename = process.argv[3];

if (!direction || !filename) {
  console.error('Usage: npm run up -- <filename.js>  |  npm run down -- <filename.js>');
  process.exit(1);
}

execSync(`npx knex migrate:${direction} ${filename}`, { stdio: 'inherit' });

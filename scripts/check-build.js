'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceDirectories = ['backend', 'frontend', 'scripts'];
const files = [];

function collectJavaScript(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScript(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

for (const directory of sourceDirectories) {
  collectJavaScript(path.join(root, directory));
}

if (files.length === 0) {
  console.error('Build check failed: no JavaScript source files were found.');
  process.exit(1);
}

let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    failed = true;
    console.error(`✗ ${path.relative(root, file)}`);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
  } else {
    console.log(`✓ ${path.relative(root, file)}`);
  }
}

if (failed) {
  console.error(`Build check failed: one or more of ${files.length} JavaScript files contain syntax errors.`);
  process.exit(1);
}

console.log(`Build check passed: ${files.length} JavaScript files passed Node.js syntax validation.`);

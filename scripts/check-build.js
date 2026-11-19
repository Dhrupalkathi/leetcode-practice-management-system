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

const pageContracts = [
  { html: 'frontend/index.html', js: 'frontend/main.js', dynamicIds: ['question-answer-text'] },
  { html: 'frontend/assessment.html', js: 'frontend/candidate-assessment.js', dynamicIds: [] },
  { html: 'frontend/database-lab.html', js: 'frontend/database-lab.js', dynamicIds: [] }
];
let contractFailed = false;

for (const contract of pageContracts) {
  const htmlPath = path.join(root, contract.html);
  const jsPath = path.join(root, contract.js);
  if (!fs.existsSync(htmlPath) || !fs.existsSync(jsPath)) {
    contractFailed = true;
    console.error(`✗ Missing page or script: ${contract.html} / ${contract.js}`);
    continue;
  }

  const html = fs.readFileSync(htmlPath, 'utf8');
  const source = fs.readFileSync(jsPath, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  const selectors = [...source.matchAll(/\$\(['"]#([a-zA-Z0-9_-]+)['"]\)/g)].map((match) => match[1]);
  const missing = [...new Set(selectors.filter((id) => !ids.includes(id) && !contract.dynamicIds.includes(id)))];

  if (duplicates.length || missing.length) {
    contractFailed = true;
    console.error(`✗ HTML contract failed: ${contract.html}`);
    if (duplicates.length) console.error('  Duplicate IDs: ' + duplicates.join(', '));
    if (missing.length) console.error('  Missing JS selectors: ' + missing.join(', '));
  } else {
    console.log(`✓ HTML/JS contract: ${contract.html}`);
  }

  const localAssets = [
    ...[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css(?:\?[^"]*)?)"/g)].map((match) => match[1])
  ].filter((asset) => asset.startsWith('/'));

  for (const asset of localAssets) {
    const relative = asset.replace(/^\//, '').split('?')[0];
    if (!fs.existsSync(path.join(root, 'frontend', relative))) {
      contractFailed = true;
      console.error(`✗ Missing local asset: ${contract.html} -> ${asset}`);
    }
  }
}

if (contractFailed) {
  console.error('Build check failed: frontend HTML/JavaScript contracts are inconsistent.');
  process.exit(1);
}

for (const cssFile of ['frontend/style.css', 'frontend/database-lab.css']) {
  const css = fs.readFileSync(path.join(root, cssFile), 'utf8');
  const openBraces = (css.match(/{/g) || []).length;
  const closeBraces = (css.match(/}/g) || []).length;
  if (openBraces !== closeBraces) {
    console.error(`✗ CSS block balance failed: ${cssFile} (${openBraces} opening, ${closeBraces} closing)`);
    process.exit(1);
  }
  console.log(`✓ CSS block balance: ${cssFile}`);
}


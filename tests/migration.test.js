'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'src', 'toolbox.js');

function runToolbox(home, toolboxHome) {
  return spawnSync(process.execPath, [CLI, 'projects'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      TOOLBOX_HOME: toolboxHome
    },
    timeout: 15000
  });
}

test('migrates legacy Radar state when Toolbox state does not exist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-migration-'));
  const legacyDirectory = path.join(home, '.dev-radar');
  const toolboxHome = path.join(home, '.toolbox');
  const legacyFile = path.join(legacyDirectory, 'state.json');
  const toolboxFile = path.join(toolboxHome, 'state.json');
  const legacyState = {
    projects: [{ name: 'Collectors Vault', path: '/work/collectors-vault' }],
    sessions: { 'Collectors Vault': { lastCommand: 'test', status: 'passed' } },
    notes: { 'Collectors Vault': { text: 'Continue the AWS review', updatedAt: '2026-11-23T20:00:00.000Z' } },
    aws: { region: 'us-east-2', profile: 'staging' }
  };

  try {
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify(legacyState, null, 2));

    const result = runToolbox(home, toolboxHome);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(toolboxFile, 'utf8')), legacyState);
    assert.equal(fs.existsSync(legacyFile), true, 'legacy state remains available as a backup');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('existing Toolbox state takes precedence over legacy Radar state', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-migration-'));
  const legacyDirectory = path.join(home, '.dev-radar');
  const toolboxHome = path.join(home, '.toolbox');
  const legacyFile = path.join(legacyDirectory, 'state.json');
  const toolboxFile = path.join(toolboxHome, 'state.json');
  const legacyState = { projects: [{ name: 'Legacy', path: '/legacy' }] };
  const toolboxState = { projects: [{ name: 'Current', path: '/current' }] };

  try {
    fs.mkdirSync(legacyDirectory, { recursive: true });
    fs.mkdirSync(toolboxHome, { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify(legacyState));
    fs.writeFileSync(toolboxFile, JSON.stringify(toolboxState));

    const result = runToolbox(home, toolboxHome);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(toolboxFile, 'utf8')), {
      ...toolboxState,
      sessions: {},
      notes: {},
      aws: { region: 'us-east-2', profile: null }
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(legacyFile, 'utf8')), legacyState);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

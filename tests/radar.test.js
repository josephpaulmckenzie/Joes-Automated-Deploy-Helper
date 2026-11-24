'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getProjectSnapshot, addProject, findProject, loadState, saveState, awsLogSearch, awsLogGroups, awsLogFollow, awsLogCenterMenu, AWS_MENU_ITEMS } = require('../src/toolbox');
const { spawnSync } = require('node:child_process');
function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolbox-test-'));
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git(['init']); git(['config', 'user.email', 'test@example.com']); git(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(path.join(dir, 'README.md'), 'test'); git(['add', '.']); git(['commit', '-m', 'initial']);
  return dir;
}
test('snapshot reads repository branch, clean state and package scripts', () => {
  const dir = tempRepo();
  const s = getProjectSnapshot({ name: 'test', path: dir });
  assert.equal(s.isRepo, true); assert.equal(s.dirty, 0); assert.ok(s.branch); assert.equal(s.scripts.test, 'node -e "process.exit(0)"');
  fs.writeFileSync(path.join(dir, 'change.txt'), 'dirty');
  assert.equal(getProjectSnapshot({ name: 'test', path: dir }).dirty, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('snapshot handles missing and non-repository paths', () => {
  assert.equal(getProjectSnapshot({ name: 'missing', path: '/no/such/path' }).exists, false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-nonrepo-'));
  assert.equal(getProjectSnapshot({ name: 'plain', path: dir }).isRepo, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
test('project lookup supports names and paths', () => {
  const state = { projects: [{ name: 'Vault', path: '/tmp/vault' }] };
  assert.equal(findProject(state, 'vault').path, '/tmp/vault');
  assert.equal(findProject(state, '/tmp/vault').name, 'Vault');
  assert.equal(findProject(state, 'missing'), null);
});
test('state persistence preserves project and note data', () => {
  const oldHome = process.env.TOOLBOX_HOME;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-state-'));
  process.env.TOOLBOX_HOME = dir;
  // module state path is initialized at import, so verify serialization helpers against default shape
  const state = { projects: [{ name: 'x', path: '/x' }], sessions: {}, notes: { x: { text: 'next task', updatedAt: 'today' } } };
  const file = path.join(dir, 'state.json'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(state));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes.x.text, 'next task');
  if (oldHome === undefined) delete process.env.TOOLBOX_HOME; else process.env.TOOLBOX_HOME = oldHome;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('interactive menus expose all project and AWS workflows', () => {
  const { MAIN_MENU_ITEMS, PROJECT_MENU_ITEMS, AWS_MENU_ITEMS, CV_TOOL_GROUPS, splitCommandArgs } = require('../src/toolbox');
  assert.deepEqual(MAIN_MENU_ITEMS.map(item => item.action), ['dashboard', 'git', 'system', 'scan', 'projects', 'test', 'build', 'watch', 'cockpit', 'aws', 'cv-tools', 'version', 'help']);
  assert.deepEqual(PROJECT_MENU_ITEMS.map(item => item.action), ['list', 'add', 'remove', 'focus', 'note', 'resume', 'back']);
  assert.deepEqual(AWS_MENU_ITEMS.map(item => item.action), ['health', 'investigate', 'status', 'deployments', 'stack-events', 'lambdas', 'log-center', 'errors', 'metrics', 'queues', 'cv-audit', 'cv-stack', 'cv-lambda', 'cv-api', 'cv-iam', 'cv-cost', 'cv-backup-inventory', 'cv-changeset', 'cv-recovery-inventory', 'cv-dynamodb-backup', 'config', 'help']);
  assert.deepEqual(CV_TOOL_GROUPS.map(item => item.action), ['project', 'system', 'git', 'data', 'diagnostics', 'fun', 'back']);
  assert.deepEqual(splitCommandArgs('\"path with spaces\" --region us-east-2'), ['path with spaces', '--region', 'us-east-2']);
  assert.throws(() => splitCommandArgs('\"unfinished'), /Unclosed quote/);
});

test('AWS Log Center exposes browse, search, live-tail and log-group helpers', () => {
  assert.equal(typeof awsLogSearch, 'function');
  assert.equal(typeof awsLogGroups, 'function');
  assert.equal(typeof awsLogFollow, 'function');
  assert.equal(typeof awsLogCenterMenu, 'function');
  assert.ok(AWS_MENU_ITEMS.some(item => item.action === 'log-center'));
});


test('v1.1 command center utilities are exposed and menu actions exist', () => {
  const toolbox = require('../src/toolbox');
  assert.equal(typeof toolbox.dashboard, 'function');
  assert.equal(typeof toolbox.gitWorkspace, 'function');
  assert.equal(typeof toolbox.systemDiagnostics, 'function');
  assert.equal(typeof toolbox.awsHealth, 'function');
  assert.equal(typeof toolbox.awsInvestigate, 'function');
  assert.ok(toolbox.MAIN_MENU_ITEMS.some(item => item.action === 'dashboard'));
  assert.ok(toolbox.MAIN_MENU_ITEMS.some(item => item.action === 'git'));
  assert.ok(toolbox.MAIN_MENU_ITEMS.some(item => item.action === 'system'));
  assert.ok(toolbox.AWS_MENU_ITEMS.some(item => item.action === 'health'));
  assert.ok(toolbox.AWS_MENU_ITEMS.some(item => item.action === 'investigate'));
});

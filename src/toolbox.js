#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');

const VERSION = '1.1.0';
const HOME = process.env.TOOLBOX_HOME || process.env.DEV_RADAR_HOME || path.join(os.homedir(), '.toolbox');
const LEGACY_STATE_FILE = path.join(os.homedir(), '.dev-radar', 'state.json');
const STATE_FILE = path.join(HOME, 'state.json');

function normalizeState(parsed) {
  return {
    projects: Array.isArray(parsed?.projects) ? parsed.projects : [],
    sessions: parsed?.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
    notes: parsed?.notes && typeof parsed.notes === 'object' ? parsed.notes : {},
    aws: parsed?.aws && typeof parsed.aws === 'object'
      ? parsed.aws
      : { region: 'us-east-2', profile: null }
  };
}

function loadState() {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch (error) {
    // A missing Toolbox state file is the one safe point to import Radar state.
    // Keep the legacy file intact as a backup after migration.
    if (error.code !== 'ENOENT' || path.resolve(STATE_FILE) === path.resolve(LEGACY_STATE_FILE)) {
      return normalizeState({});
    }

    try {
      const legacyState = normalizeState(JSON.parse(fs.readFileSync(LEGACY_STATE_FILE, 'utf8')));
      saveState(legacyState);
      return legacyState;
    } catch {
      return normalizeState({});
    }
  }
}
function saveState(state) {
  fs.mkdirSync(HOME, { recursive: true });
  const temp = `${STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(temp, STATE_FILE);
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '', error: result.error };
}
function git(cwd, args) {
  const result = run('git', args, cwd);
  return result.status === 0 ? result.stdout.trim() : null;
}
function isRepo(dir) { const root = git(dir, ['rev-parse', '--show-toplevel']); return root !== null && root !== path.parse(path.resolve(dir)).root; }
function repoRoot(dir) { return git(dir, ['rev-parse', '--show-toplevel']); }
function getProjectSnapshot(project) {
  const cwd = project.path;
  if (!fs.existsSync(cwd)) return { ...project, exists: false, error: 'Directory not found' };
  if (!isRepo(cwd)) return { ...project, exists: true, isRepo: false, error: 'Not a Git repository' };
  const root = repoRoot(cwd);
  const branch = git(root, ['branch', '--show-current']) || '(detached HEAD)';
  const status = git(root, ['status', '--porcelain']) || '';
  const changes = status.split('\n').filter(Boolean);
  const upstream = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  let ahead = 0, behind = 0;
  if (upstream) {
    const counts = git(root, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]);
    if (counts) { const [b, a] = counts.split(/\s+/).map(Number); behind = b || 0; ahead = a || 0; }
  }
  let scripts = {};
  const packageFile = path.join(root, 'package.json');
  if (fs.existsSync(packageFile)) {
    try { scripts = JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts || {}; } catch { /* malformed package file */ }
  }
  const lastCommit = git(root, ['log', '-1', '--format=%h|%s|%cr']);
  return { ...project, path: root, exists: true, isRepo: true, branch, dirty: changes.length, changes, ahead, behind, upstream: upstream || null, scripts, lastCommit };
}
function findProject(state, nameOrPath) {
  if (!nameOrPath) return null;
  return state.projects.find(p => p.name.toLowerCase() === nameOrPath.toLowerCase() || p.path === path.resolve(nameOrPath)) || null;
}
function formatSnapshot(s) {
  if (!s.exists || !s.isRepo) return `  🔴 ${s.name}\n     ${s.error || 'Unavailable'}`;
  const dirty = s.dirty ? `🟡 ${s.dirty} change${s.dirty === 1 ? '' : 's'}` : '🟢 clean';
  const sync = s.upstream ? `${s.ahead} ahead / ${s.behind} behind` : 'no upstream';
  return `  ${s.dirty ? '🟡' : '🟢'} ${s.name}\n     Branch: ${s.branch}\n     Git: ${dirty} | ${sync}\n     Scripts: ${Object.keys(s.scripts).join(', ') || 'none detected'}\n     Last commit: ${s.lastCommit || 'no commits'}`;
}
function printBanner() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                    🧰 TOOLBOX                         ║');
  console.log('║                 DEVELOPMENT COMMAND CENTER             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}
function usage() {
  console.log(`TOOLBOX v${VERSION}\n\nCommands:\n  toolbox                    Interactive command center (TTY)\n  toolbox menu                Open interactive command center\n  toolbox add <name> <path>     Register a project\n  toolbox remove <name>         Remove a project\n  toolbox projects              List registered projects\n  toolbox scan                  Scan every project\n  toolbox dashboard             Command center overview
  toolbox system                System diagnostics
  toolbox git                   Git workspace overview
  toolbox config                 Toolbox configuration
  toolbox status                Quick overview\n  toolbox focus <name>          Detailed project briefing\n  toolbox note <name> <text>    Save a project note\n  toolbox resume [name]         Recall saved notes/session\n  toolbox test <name>           Run detected test script\n  toolbox build <name>          Run detected build script\n  toolbox watch [seconds]       Refresh scans continuously\n  toolbox cockpit [project]     Launch NIGHTWATCH command center
  toolbox aws                   Interactive AWS operations menu
  toolbox aws menu               Interactive AWS operations menu
  toolbox aws help               AWS command reference
  toolbox aws health             AWS environment health check
  toolbox aws investigate [since] Correlated AWS incident report
  toolbox aws status             AWS account and infrastructure overview
  toolbox aws deployments [stack] Recent CloudFormation deployments
  toolbox aws stack-events [s]   Recent stack events
  toolbox aws lambdas            List Lambda functions
  toolbox aws logs <function>    Tail CloudWatch logs
  toolbox aws errors [function]  Recent errors from CloudWatch
  toolbox aws queues             SQS queue and DLQ metrics
  toolbox aws metrics [lambda]   Lambda CloudWatch metrics
  toolbox aws config [key value] Configure AWS region/profile
  toolbox aws audit              Detailed CV AWS audit
  toolbox aws stack              Detailed stack inspection
  toolbox aws lambda             Lambda diagnostics
  toolbox aws api                API health check
  toolbox aws iam                IAM inventory
  toolbox aws cost               Cost report
  toolbox aws backup-inventory   Backup inventory
  toolbox aws changeset          Change-set review
  toolbox aws recovery-inventory Recovery readiness
  toolbox aws dynamodb-backup    Create confirmed backup
  toolbox help                  Show help\n\nState: ${STATE_FILE}`);
}
function addProject(state, name, projectPath) {
  if (!name || !projectPath) throw new Error('Usage: toolbox add <name> <path>');
  const resolved = path.resolve(projectPath);
  if (!fs.existsSync(resolved)) throw new Error(`Path does not exist: ${resolved}`);
  if (!isRepo(resolved)) throw new Error(`Not a Git repository: ${resolved}`);
  const existing = state.projects.find(p => p.name.toLowerCase() === name.toLowerCase() || p.path === repoRoot(resolved));
  if (existing) throw new Error(`Project already registered: ${existing.name}`);
  state.projects.push({ name, path: repoRoot(resolved), addedAt: new Date().toISOString() });
  saveState(state);
  console.log(`\n🛰️  ${name} added to TOOLBOX.`);
}
function scan(state) {
  printBanner();
  if (!state.projects.length) { console.log('No projects registered yet.\nTry: toolbox add collectors-vault ~/Documents/Code/collectors-vault\n'); return; }
  const snapshots = state.projects.map(getProjectSnapshot);
  console.log(snapshots.map(formatSnapshot).join('\n\n'));
  const dirty = snapshots.filter(s => s.dirty > 0).length;
  const invalid = snapshots.filter(s => !s.isRepo || !s.exists).length;
  console.log('\n──────────────────────────────────────────────────────────');
  console.log(`  ${snapshots.length} projects | ${dirty} need attention | ${invalid} unavailable`);
  console.log('──────────────────────────────────────────────────────────\n');
}
function focus(state, name) {
  const p = findProject(state, name);
  if (!p) throw new Error(`Project not found: ${name}`);
  const s = getProjectSnapshot(p);
  printBanner();
  console.log(`🎯 FOCUS MODE: ${p.name}\n${formatSnapshot(s)}\n`);
  const note = state.notes[p.name];
  if (note) console.log(`📝 LAST NOTE\n   ${note.text}\n   Saved: ${note.updatedAt}\n`);
  const session = state.sessions[p.name];
  if (session) console.log(`⏱️  LAST SESSION\n   ${session.summary}\n   ${session.updatedAt}\n`);
  console.log('Suggested commands:');
  if (s.scripts.test) console.log(`  toolbox test ${p.name}`);
  if (s.scripts.build) console.log(`  toolbox build ${p.name}`);
  console.log(`  toolbox note ${p.name} "what you are working on"\n`);
}
function saveNote(state, name, text) {
  const p = findProject(state, name);
  if (!p) throw new Error(`Project not found: ${name}`);
  if (!text) throw new Error('Usage: toolbox note <name> <text>');
  state.notes[p.name] = { text, updatedAt: new Date().toISOString() };
  state.sessions[p.name] = { summary: text, updatedAt: new Date().toISOString() };
  saveState(state);
  console.log(`📝 Note saved for ${p.name}.\n`);
}
function resume(state, name) {
  printBanner();
  const names = name ? [name] : state.projects.map(p => p.name);
  if (!names.length) { console.log('No projects registered.\n'); return; }
  for (const n of names) {
    const p = findProject(state, n);
    if (!p) { console.log(`🔴 ${n}: project not found\n`); continue; }
    const note = state.notes[p.name] || state.sessions[p.name];
    console.log(`📌 ${p.name}`);
    console.log(note ? `   ${note.text ?? note.summary ?? 'No summary available'}\n   Updated: ${note.updatedAt}` : '   No saved session notes yet.');
    console.log('');
  }
}
function runProjectScript(state, name, kind) {
  const p = findProject(state, name);
  if (!p) throw new Error(`Project not found: ${name}`);
  const s = getProjectSnapshot(p);
  const script = kind === 'test' ? (s.scripts.test ? 'test' : s.scripts.verify ? 'verify' : null) : (s.scripts.build ? 'build' : null);
  if (!script) throw new Error(`No ${kind} script detected in ${p.name}.`);
  const manager = fs.existsSync(path.join(s.path, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(s.path, 'yarn.lock')) ? 'yarn' : 'npm';
  const args = manager === 'npm' ? ['run', script] : [script];
  console.log(`\n🚀 ${kind.toUpperCase()}: ${p.name} (${manager} ${args.join(' ')})\n`);
  const result = spawnSync(manager, args, { cwd: s.path, stdio: 'inherit', shell: process.platform === 'win32', timeout: 30 * 60 * 1000 });
  const summary = result.status === 0 ? `${kind} passed` : `${kind} failed (exit ${result.status ?? 1})`;
  state.sessions[p.name] = { summary, updatedAt: new Date().toISOString() };
  saveState(state);
  console.log(result.status === 0 ? `\n✅ ${summary}\n` : `\n❌ ${summary}\n`);
  if (result.status !== 0) process.exitCode = result.status || 1;
}
function watch(state, seconds = 30) {
  const interval = Math.max(5, Number(seconds) || 30);
  let previous = new Map();
  console.log(`🛰️  TOOLBOX WATCH — refreshing every ${interval}s. Press Ctrl+C to stop.\n`);
  const refresh = () => {
    console.clear(); printBanner();
    const current = state.projects.map(getProjectSnapshot);
    for (const s of current) {
      const key = `${s.branch}|${s.dirty}|${s.ahead}|${s.behind}`;
      if (previous.has(s.name) && previous.get(s.name) !== key) console.log(`⚡ CHANGE DETECTED: ${s.name}`);
      previous.set(s.name, key);
    }
    console.log(current.map(formatSnapshot).join('\n\n'));
    console.log(`\nRefreshing in ${interval}s...`);
  };
  const timer = setInterval(refresh, interval * 1000);
  process.on('SIGINT', () => { clearInterval(timer); console.log('\n\nToolbox offline.'); process.exit(0); });
  refresh();
}

function cockpit(state, projectName) {
  printBanner();
  const snapshots = state.projects.map(getProjectSnapshot);
  const chosen = projectName ? findProject(state, projectName) : null;
  if (projectName && !chosen) throw new Error(`Project not found: ${projectName}`);
  const shown = chosen ? [getProjectSnapshot(chosen)] : snapshots;
  const healthy = shown.filter(s => s.exists && s.isRepo && !s.dirty && !s.behind).length;
  const attention = shown.filter(s => !s.exists || !s.isRepo || s.dirty || s.behind).length;
  const sessions = chosen ? [chosen] : state.projects;
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                    🌙 NIGHTWATCH                        ║');
  console.log('║               DEVELOPER COMMAND CENTER                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  SYSTEM: ${state.projects.length ? 'ONLINE' : 'AWAITING PROJECTS'}   PROJECTS: ${shown.length}`);
  console.log(`  HEALTHY: ${healthy}   NEED ATTENTION: ${attention}\n`);
  console.log('  ┌─ PROJECT STATUS ──────────────────────────────────────┐');
  for (const s of shown) {
    const icon = !s.exists || !s.isRepo ? '🔴' : s.dirty || s.behind ? '🟡' : '🟢';
    const detail = !s.exists || !s.isRepo ? s.error : `${s.branch} | ${s.dirty} changes | ${s.ahead} ahead / ${s.behind} behind`;
    const name = s.name.length > 23 ? `${s.name.slice(0, 20)}...` : s.name;
    console.log(`  │ ${icon} ${name.padEnd(23)} ${detail.slice(0, 34).padEnd(34)} │`);
  }
  if (!shown.length) console.log('  │  No projects registered. Try: toolbox add <name> <path> │');
  console.log('  └───────────────────────────────────────────────────────┘');
  console.log('\n  ┌─ MISSION CONTROL ─────────────────────────────────────┐');
  console.log('  │  toolbox scan       Scan all projects                   │');
  console.log('  │  toolbox focus      Focus on a project                   │');
  console.log('  │  toolbox test       Run project tests                    │');
  console.log('  │  toolbox build      Build a project                      │');
  console.log('  │  toolbox note       Save your next objective              │');
  console.log('  │  toolbox watch      Monitor projects                     │');
  console.log('  │  cv-fun           Launch Developer RPG                 │');
  console.log('  └───────────────────────────────────────────────────────┘');
  console.log('\n  ┌─ LAST KNOWN OBJECTIVES ───────────────────────────────┐');
  for (const p of sessions) {
    const note = state.notes[p.name] || state.sessions[p.name];
    const summary = note?.text ?? note?.summary ?? 'No saved objective';
    console.log(`  │ ${p.name}: ${summary.slice(0, 48)}`);
  }
  if (!sessions.length) console.log('  │ Register a project to begin your mission.');
  console.log('  └───────────────────────────────────────────────────────┘\n');
  console.log('  NIGHTWATCH is ready. Your projects are in view.\n');
}


function dashboard(state) {
  printBanner();
  const snapshots = state.projects.map(getProjectSnapshot);
  const dirty = snapshots.filter(s => s.dirty > 0).length;
  const unavailable = snapshots.filter(s => !s.exists || !s.isRepo).length;
  console.log('COMMAND CENTER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Projects: ${snapshots.length} | Changes: ${dirty} | Unavailable: ${unavailable}`);
  if (snapshots.length) console.log('\n' + snapshots.map(formatSnapshot).join('\n\n'));
  else console.log('\nNo projects registered. Add one with: toolbox add <name> <path>');
  console.log('\nAWS CONFIGURATION');
  console.log(`Profile: ${state.aws?.profile || 'default'} | Region: ${state.aws?.region || 'us-east-2'}`);
  console.log('Run `toolbox aws health` for a live AWS health check.');
  console.log('\nQUICK ACTIONS');
  console.log('  toolbox aws health       AWS environment health');
  console.log('  toolbox aws investigate  Correlated AWS diagnostics');
  console.log('  toolbox git              Git workspace overview');
  console.log('  toolbox system           Mac/Node/tool diagnostics');
  console.log('');
}
function systemDiagnostics() {
  printBanner();
  const checks = [
    ['OS', `${os.type()} ${os.release()} (${os.arch()})`],
    ['Node', process.version],
    ['Toolbox', VERSION],
    ['Home', os.homedir()],
    ['Toolbox state', STATE_FILE],
    ['AWS CLI', run('aws', ['--version']).stdout.trim() || run('aws', ['--version']).stderr.trim() || 'Not found'],
    ['Git', run('git', ['--version']).stdout.trim() || 'Not found'],
    ['Disk', run('df', ['-h', os.homedir()]).stdout.trim().split('\n').slice(-1)[0] || 'Unavailable'],
  ];
  console.log('SYSTEM DIAGNOSTICS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const [label, value] of checks) console.log(`${label.padEnd(15)} ${value}`);
  console.log('\n');
}
function gitWorkspace(state) {
  printBanner();
  console.log('GIT WORKSPACE\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (!state.projects.length) { console.log('No projects registered. Use `toolbox add <name> <path>`.\n'); return; }
  for (const project of state.projects) {
    const s = getProjectSnapshot(project);
    if (!s.exists || !s.isRepo) { console.log(`\n🔴 ${s.name}\n   ${s.error}`); continue; }
    console.log(`\n${s.dirty ? '🟡' : '🟢'} ${s.name}`);
    console.log(`   ${s.path}`);
    console.log(`   Branch: ${s.branch}`);
    console.log(`   Changes: ${s.dirty} | Ahead: ${s.ahead} | Behind: ${s.behind}`);
    if (s.changes.length) console.log('   Files:\n' + s.changes.slice(0, 12).map(x => `     ${x}`).join('\n') + (s.changes.length > 12 ? `\n     … ${s.changes.length - 12} more` : ''));
  }
  console.log('\n');
}
function awsHealth(state) {
  awsHeader(state, 'Health Check');
  const checks = [];
  const attempt = (label, fn) => { try { fn(); checks.push([label, 'OK']); } catch (e) { checks.push([label, `WARN: ${e.message}`]); } };
  let identity;
  attempt('Credentials', () => { identity = awsJson(state, ['sts', 'get-caller-identity']); });
  if (identity) console.log(`Account: ${identity.Account}\nIdentity: ${identity.Arn}`);
  attempt('CloudFormation', () => { const data = awsJson(state, ['cloudformation', 'list-stacks']); const active=(data.StackSummaries||[]).filter(x=>x.StackStatus&&!x.StackStatus.includes('DELETE')); const failed=active.filter(x=>x.StackStatus.includes('FAILED')); checks.push(['Stacks', `${active.length} active, ${failed.length} failed`]); });
  attempt('Lambda', () => { const data=awsJson(state,['lambda','list-functions']); checks.push(['Functions', `${(data.Functions||[]).length} found`]); });
  attempt('SQS', () => { const data=awsJson(state,['sqs','list-queues']); checks.push(['Queues', `${(data.QueueUrls||[]).length} found`]); });
  console.log('\nHEALTH CHECKS');
  for (const [label, result] of checks) console.log(`${result.startsWith('WARN')?'⚠':'✓'} ${label.padEnd(18)} ${result}`);
  console.log(`\nOverall: ${checks.some(x=>x[1].startsWith('WARN'))?'ATTENTION REQUIRED':'HEALTHY'}\n`);
}
function awsInvestigate(state, since='1h') {
  awsHeader(state, 'Incident Investigation');
  console.log('Gathering identity, stack, Lambda, queue, error and metric information…\n');
  const sections = [
    ['IDENTITY', () => { const x=awsJson(state,['sts','get-caller-identity']); console.log(`Account ${x.Account}\n${x.Arn}`); }],
    ['STACKS', () => { const x=awsJson(state,['cloudformation','list-stacks']); const a=(x.StackSummaries||[]).filter(s=>s.StackStatus&&!s.StackStatus.includes('DELETE')); console.log(a.slice(0,12).map(s=>`${s.StackStatus.includes('FAILED')?'🔴':'🟢'} ${s.StackName} — ${s.StackStatus}`).join('\n')||'No active stacks'); }],
    ['QUEUES', () => awsQueues(state)],
    ['RECENT ERRORS', () => awsErrors(state)],
    ['LAMBDA METRICS', () => awsMetrics(state)],
  ];
  for (const [title, fn] of sections) { console.log(`\n━━ ${title} ━━`); try { fn(); } catch(e) { console.log(`⚠ Unable to collect: ${e.message}`); } }
  console.log('\nInvestigation complete. This report is observational; it does not modify AWS resources.\n');
}
function toolboxConfig(state, key, value) {
  if (!key) { console.log(`Toolbox home: ${HOME}\nState file: ${STATE_FILE}\nAWS profile: ${state.aws?.profile || 'default'}\nAWS region: ${state.aws?.region || 'us-east-2'}\n`); return; }
  if (key === 'home') throw new Error('TOOLBOX_HOME is set at process launch; changing it here is not supported.');
  throw new Error('Supported: toolbox config');
}

const MAIN_MENU_ITEMS = [
  { label: 'Command Center Dashboard', detail: 'Project status, configuration and quick actions', key: '1', action: 'dashboard' },
  { label: 'Git Workspace', detail: 'All repositories, branches, changes and upstream state', key: 'g', action: 'git' },
  { label: 'System Diagnostics', detail: 'Mac, Node, Git, AWS CLI and disk overview', key: 's', action: 'system' },
  { label: 'Dashboard / Project Scan', detail: 'Git status, changes, upstream sync and project health', key: '2', action: 'scan' },
  { label: 'Project Management', detail: 'Add, remove, focus, list, note and resume projects', key: '2', action: 'projects' },
  { label: 'Run Tests', detail: 'Choose a project and run its detected test script', key: '3', action: 'test' },
  { label: 'Build Project', detail: 'Choose a project and run its build script', key: '4', action: 'build' },
  { label: 'Watch Projects', detail: 'Continuously monitor Git state for changes', key: '5', action: 'watch' },
  { label: 'NIGHTWATCH', detail: 'Project health, Git status and saved objectives', key: '6', action: 'cockpit' },
  { label: 'AWS Operations', detail: 'CloudFormation, Lambda, CloudWatch, SQS and config', key: '7', action: 'aws' },
  { label: 'Collector\'s Vault Tools', detail: 'Project, AWS, system, Git, backup and diagnostics utilities', key: '8', action: 'cv-tools' },
  { label: 'Version', detail: 'Show installed Toolbox version', key: '9', action: 'version' },
  { label: 'Help / Command Reference', detail: 'Show all CLI commands and examples', key: '?', action: 'help' },
];


const CV_TOOL_GROUPS = [
  { label: 'Project', detail: 'Repository health, tests, verification and release readiness', key: '1', action: 'project', commands: ['status','snapshot','doctor','test','preflight','release-check','verify','deploy'] },
  { label: 'Mac / System', detail: 'Disk, files, network, Docker, Time Machine, startup and Pi health', key: '1', action: 'system', commands: ['disk','large-files','network','docker','mac-backup','mac-startup','pi-health'] },
  { label: 'Git / Recovery', detail: 'Git diagnostics, recovery, source backups and cleanup', key: '2', action: 'git', commands: ['git-check','git-recovery','backup','backup-verify','cleanup-preview','cleanup-safe','recovery-plan'] },
  { label: 'Data Backup', detail: 'Encrypted backups, verification and isolated restore drills', key: '3', action: 'data', commands: ['data-backup','data-verify','data-restore-drill'] },
  { label: 'Vault / Diagnostics', detail: 'Vault integrity, config, Node, Playwright and diagnostic reports', key: '4', action: 'diagnostics', commands: ['vault-integrity','config-check','node-audit','playwright','report-json'] },
  { label: 'CV Fun', detail: 'Launch the Developer RPG', key: '5', action: 'fun', commands: ['cv-fun'] },
  { label: 'Back', detail: 'Return to Toolbox', key: 'q', action: 'back' },
];

const PROJECT_MENU_ITEMS = [
  { label: 'List Projects', detail: 'Show registered repositories', key: '1', action: 'list' },
  { label: 'Add Project', detail: 'Register a Git repository', key: '2', action: 'add' },
  { label: 'Remove Project', detail: 'Remove registration without deleting files', key: '3', action: 'remove' },
  { label: 'Focus Project', detail: 'Detailed briefing for a project', key: '4', action: 'focus' },
  { label: 'Save Note / Objective', detail: 'Record what you are working on next', key: '5', action: 'note' },
  { label: 'Resume Work', detail: 'Recall saved context for one or all projects', key: '6', action: 'resume' },
  { label: 'Back', detail: 'Return to main menu', key: 'q', action: 'back' },
];

async function promptText(label, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${label}${defaultValue ? ` [${defaultValue}]` : ''}: `);
    return answer.trim() || defaultValue;
  } finally {
    rl.close();
  }
}

function projectOptions(state, includeAll = false) {
  const options = state.projects.map((project, index) => ({
    label: project.name,
    detail: project.path,
    key: String(index + 1),
    value: project.name,
  }));
  if (includeAll) options.unshift({ label: 'All Projects', detail: 'Apply to every registered project', key: 'a', value: null });
  return options;
}

async function projectMenu(state) {
  while (true) {
    const selected = terminalMenu('PROJECT MANAGEMENT', PROJECT_MENU_ITEMS, `${state.projects.length} registered project(s)`);
    if (!selected || selected.action === 'back') return;
    try {
      switch (selected.action) {
        case 'list':
          printBanner();
          console.log(state.projects.length ? state.projects.map(p => `  • ${p.name}\n    ${p.path}`).join('\n') : 'No projects registered.');
          menuPause();
          break;
        case 'add': {
          const name = await promptText('Project name');
          const projectPath = await promptText('Repository path', '~/Documents/Code');
          if (!name || !projectPath) { console.log('Name and path are required.'); menuPause(); break; }
          addProject(state, name, projectPath.replace(/^~(?=\/)/, os.homedir()));
          menuPause();
          break;
        }
        case 'remove': {
          const project = terminalMenu('REMOVE PROJECT', projectOptions(state), 'This removes TOOLBOX registration only; files are untouched.');
          if (project) {
            const confirm = await promptText(`Remove ${project.value}? Type yes to confirm`);
            if (confirm.toLowerCase() === 'yes') {
              const found = findProject(state, project.value);
              if (found) { state.projects = state.projects.filter(p => p !== found); delete state.notes[found.name]; delete state.sessions[found.name]; saveState(state); console.log(`Removed ${found.name}.`); }
            } else console.log('Removal cancelled.');
            menuPause();
          }
          break;
        }
        case 'focus': {
          const project = terminalMenu('FOCUS PROJECT', projectOptions(state), 'Choose a project for a detailed briefing');
          if (project) { focus(state, project.value); menuPause(); }
          break;
        }
        case 'note': {
          const project = terminalMenu('SAVE PROJECT NOTE', projectOptions(state), 'Choose where to save the next objective');
          if (project) {
            const note = await promptText(`Note for ${project.value}`);
            if (note) saveNote(state, project.value, note);
            menuPause();
          }
          break;
        }
        case 'resume': {
          const project = terminalMenu('RESUME WORK', projectOptions(state, true), 'Choose one project or resume all');
          if (project) { resume(state, project.value || undefined); menuPause(); }
          break;
        }
      }
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      menuPause();
    }
  }
}

async function interactiveMainMenu(state) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    usage();
    return;
  }
  while (true) {
    const selected = terminalMenu('COMMAND CENTER', MAIN_MENU_ITEMS, `${state.projects.length} project(s) registered | ${state.aws?.region || 'us-east-2'} | AWS profile: ${state.aws?.profile || 'default'}`);
    if (!selected) return;
    try {
      switch (selected.action) {
        case 'dashboard': dashboard(state); menuPause(); break;
        case 'git': gitWorkspace(state); menuPause(); break;
        case 'system': systemDiagnostics(); menuPause(); break;
        case 'scan': scan(state); menuPause(); break;
        case 'projects': await projectMenu(state); break;
        case 'test': {
          const project = terminalMenu('RUN TESTS', projectOptions(state), 'Choose a project');
          if (project) { runProjectScript(state, project.value, 'test'); menuPause(); }
          break;
        }
        case 'build': {
          const project = terminalMenu('BUILD PROJECT', projectOptions(state), 'Choose a project');
          if (project) { runProjectScript(state, project.value, 'build'); menuPause(); }
          break;
        }
        case 'watch': {
          const seconds = await promptText('Refresh interval in seconds', '30');
          watch(state, seconds);
          break;
        }
        case 'cockpit': {
          const project = terminalMenu('NIGHTWATCH', projectOptions(state, true), 'Choose a project or all projects');
          if (project) { cockpit(state, project.value || undefined); menuPause(); }
          break;
        }
        case 'aws': awsMenu(state); break;
        case 'cv-tools': await cvToolsMenu(state); break;
        case 'version': console.log(`TOOLBOX v${VERSION}`); menuPause(); break;
        case 'help': usage(); menuPause(); break;
      }
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      menuPause();
    }
  }
}


function runCvCommand(command, args = [], state = null) {
  const env = { ...process.env };
  if (state?.aws?.profile) env.AWS_PROFILE = state.aws.profile;
  if (state?.aws?.region) { env.AWS_REGION = state.aws.region; env.AWS_DEFAULT_REGION = state.aws.region; }
  const result = spawnSync('cv', [command, ...args], { stdio: 'inherit', timeout: 60 * 60 * 1000, env });
  if (result.error) throw new Error(`CV toolkit command failed: ${result.error.message}. Ensure ~/bin/cv is installed and available on PATH.`);
  if (result.status !== 0) process.exitCode = result.status || 1;
}
async function cvToolsMenu(state = null) {
  while (true) {
    const group = terminalMenu('COLLECTOR’S VAULT TOOLS', CV_TOOL_GROUPS, 'Unified CV development and system utilities');
    if (!group || group.action === 'back') return;
    const options = group.commands.map((command, index) => ({
      label: command,
      detail: commandHelpDescription(command),
      key: String(index + 1),
      value: command,
    }));
    const selected = terminalMenu(`CV ${group.label.toUpperCase()}`, options, 'Select a utility');
    if (!selected) continue;
    try {
      const extra = selected.value === 'aws-stack' || selected.value === 'aws-lambda' || selected.value === 'aws-changeset' ||
        selected.value === 'aws-cost' || selected.value === 'large-files' || selected.value === 'pi-health' ||
        selected.value === 'backup-verify' || selected.value === 'data-verify' || selected.value === 'data-restore-drill'
        ? await promptText(`Arguments for cv ${selected.value} (leave blank for defaults)`) : '';
      runCvCommand(selected.value, extra ? extra.split(/\\s+/) : [], state);
      menuPause('Press any key to return to CV tools...');
    } catch (error) {
      console.error(`\\n❌ ${error.message}\\n`);
      menuPause('Press any key to return to CV tools...');
    }
  }
}
function splitCommandArgs(input) {
  const args = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const char of input) {
    if (escaped) { current += char; escaped = false; continue; }
    if (char === '\\' && quote !== "'") { escaped = true; continue; }
    if ((char === '"' || char === "'") && (!quote || quote === char)) { quote = quote ? null : char; continue; }
    if (/\s/.test(char) && !quote) { if (current) { args.push(current); current = ''; } continue; }
    current += char;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error('Unclosed quote in arguments.');
  if (current) args.push(current);
  return args;
}

function commandHelpDescription(command) {
  const descriptions = {
    status: 'Git/project overview', snapshot: 'Save a timestamped diagnostic report', doctor: 'Inspect local development prerequisites',
    test: 'Run available npm checks', preflight: 'Check repository cleanliness and prerequisites', 'release-check': 'Review main-branch readiness',
    verify: 'Run pinned Collector’s Vault Linux verification', deploy: 'Launch Docker-based staging deployment',
    'aws-whoami': 'Show AWS identity', 'aws-audit': 'Inspect CloudFormation, Lambda and S3 metadata', 'aws-stack': 'Inspect a CloudFormation stack',
    'aws-lambda': 'Inspect Lambda configuration', 'aws-api': 'Check HTTPS endpoint', 'aws-iam': 'Inspect IAM metadata',
    'aws-cost': 'Query service-level AWS costs', 'aws-backup-inventory': 'Inspect S3 versioning and DynamoDB PITR',
    'aws-changeset': 'Inspect a proposed change set', 'aws-recovery-inventory': 'Inspect recovery capabilities',
    'aws-dynamodb-backup': 'Create a billable backup after confirmation',
    disk: 'Disk usage overview', 'large-files': 'Find large files without deleting anything', network: 'DNS/connectivity diagnostics',
    docker: 'Docker/Colima status', 'mac-backup': 'Inspect Time Machine', 'mac-startup': 'Inspect login items',
    'pi-health': 'Inspect Raspberry Pi health over SSH', 'git-check': 'Diff/status summary', 'git-recovery': 'Inspect reflog, stashes and unreachable commits',
    backup: 'Create a source archive', 'backup-verify': 'Verify archive and checksum', 'cleanup-preview': 'Preview eligible test-cache cleanup',
    'cleanup-safe': 'Remove selected caches after confirmation', 'recovery-plan': 'Create recovery-readiness report',
    'data-backup': 'Create encrypted local data archive', 'data-verify': 'Verify encrypted archive', 'data-restore-drill': 'Restore into isolated directory',
    'vault-integrity': 'Inspect project layout and candidate data paths', 'config-check': 'Validate JSON configuration',
    'node-audit': 'Inspect Node dependency health', playwright: 'Inspect Playwright/browser installation', 'report-json': 'Write private diagnostic report',
  };
  return descriptions[command] || 'Run CV toolkit utility';
}
function awsArgs(state, args) {
  const config = state.aws || { region: 'us-east-2', profile: null };
  const out = [...args, '--region', config.region || 'us-east-2'];
  if (config.profile) out.push('--profile', config.profile);
  return out;
}
function awsRun(state, args, opts = {}) {
  const result = spawnSync('aws', awsArgs(state, args), {
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env
  });
  if (result.error) throw new Error(`AWS CLI unavailable: ${result.error.message}. Install AWS CLI v2 and configure credentials.`);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `AWS command failed (${result.status})`).trim());
  return result.stdout || '';
}
function awsJson(state, args) {
  const output = awsRun(state, [...args, '--output', 'json']);
  try { return JSON.parse(output); } catch { throw new Error(`AWS returned invalid JSON for: aws ${args.join(' ')}`); }
}
function awsHeader(state, title) {
  const cfg = state.aws || { region: 'us-east-2', profile: null };
  console.log(`\n🛰️  TOOLBOX — AWS ${title.toUpperCase()}`);
  console.log(`   Region: ${cfg.region || 'us-east-2'} | Profile: ${cfg.profile || 'default'}\n`);
}
function awsStatus(state) {
  awsHeader(state, 'Status');
  const identity = awsJson(state, ['sts', 'get-caller-identity']);
  console.log(`🟢 AUTHENTICATED`);
  console.log(`   Account: ${identity.Account}`);
  console.log(`   Identity: ${identity.Arn}`);
  const stacks = awsJson(state, ['cloudformation', 'list-stacks']);
  const active = (stacks.StackSummaries || []).filter(x => x.StackStatus && !x.StackStatus.includes('DELETE'));
  console.log(`\n☁️  CLOUD FORMATION STACKS: ${active.length}`);
  for (const stack of active.slice(0, 10)) {
    console.log(`   ${stack.StackStatus.includes('FAILED') ? '🔴' : '🟢'} ${stack.StackName}`);
    console.log(`      ${stack.StackStatus} | ${stack.LastUpdatedTime || stack.CreationTime || 'time unavailable'}`);
  }
  const functions = awsJson(state, ['lambda', 'list-functions', '--query', 'Functions[].{Name:FunctionName,State:State,Runtime:Runtime}']);
  console.log(`\n⚡ LAMBDA FUNCTIONS: ${Array.isArray(functions) ? functions.length : 0}`);
  for (const fn of (Array.isArray(functions) ? functions : []).slice(0, 12)) console.log(`   ${fn.State === 'Active' ? '🟢' : '🟡'} ${fn.Name} (${fn.Runtime || 'unknown'})`);
  console.log('');
}
function awsDeployments(state, stackName) {
  awsHeader(state, 'Recent Deployments');
  const data = awsJson(state, ['cloudformation', 'list-stacks', '--output', 'json']);
  const stacks = (data.StackSummaries || []).filter(s => !s.StackStatus.startsWith('DELETE_'))
    .sort((a,b) => new Date(b.LastUpdatedTime || b.CreationTime) - new Date(a.LastUpdatedTime || a.CreationTime));
  const selected = stackName ? stacks.filter(s => s.StackName.toLowerCase().includes(stackName.toLowerCase())) : stacks;
  if (!selected.length) { console.log(stackName ? `No stack matches "${stackName}".` : 'No CloudFormation stacks found.'); return; }
  for (const stack of selected.slice(0, 10)) {
    const when = stack.LastUpdatedTime || stack.CreationTime;
    console.log(`${stack.StackStatus.includes('FAILED') ? '🔴' : '🟢'} ${stack.StackName}`);
    console.log(`   Status: ${stack.StackStatus}`);
    console.log(`   Last deployment: ${when ? new Date(when).toLocaleString() : 'unknown'}`);
    if (stack.StackId) console.log(`   Stack ID: ${stack.StackId}`);
    console.log('');
  }
}
function awsStackEvents(state, stackName) {
  awsHeader(state, 'Stack Events');
  const data = awsJson(state, ['cloudformation', 'list-stacks', '--output', 'json']);
  const stacks = (data.StackSummaries || []).filter(s => !s.StackStatus.startsWith('DELETE_'));
  const stack = stackName ? stacks.find(s => s.StackName.toLowerCase().includes(stackName.toLowerCase())) : stacks.sort((a,b) => new Date(b.LastUpdatedTime || b.CreationTime) - new Date(a.LastUpdatedTime || a.CreationTime))[0];
  if (!stack) throw new Error(`Stack not found${stackName ? `: ${stackName}` : ''}`);
  const events = awsJson(state, ['cloudformation', 'describe-stack-events', '--stack-name', stack.StackName]);
  for (const e of (events.StackEvents || []).slice(0, 20)) {
    const failed = /FAILED|ROLLBACK|CANCELLED/.test(e.ResourceStatus || '');
    console.log(`${failed ? '🔴' : e.ResourceStatus?.includes('COMPLETE') ? '🟢' : '🔵'} ${e.Timestamp}`);
    console.log(`   ${e.ResourceType || 'Stack'}: ${e.LogicalResourceId} — ${e.ResourceStatus}`);
    if (e.ResourceStatusReason) console.log(`   ${e.ResourceStatusReason}`);
  }
}
function awsLambdaList(state) {
  awsHeader(state, 'Lambda Functions');
  const data = awsJson(state, ['lambda', 'list-functions']);
  for (const fn of data.Functions || []) {
    console.log(`${fn.State === 'Active' ? '🟢' : '🟡'} ${fn.FunctionName}`);
    console.log(`   Runtime: ${fn.Runtime} | Memory: ${fn.MemorySize} MB | Timeout: ${fn.Timeout}s`);
    console.log(`   Updated: ${fn.LastModified}`);
  }
}
function awsLogs(state, functionName, since = '1h', filter = null) {
  if (!functionName) throw new Error('Usage: toolbox aws logs <lambda-name> [since]');
  awsHeader(state, `Logs — ${functionName}`);
  const args = ['logs', 'tail', `/aws/lambda/${functionName}`, '--since', since, '--format', 'short'];
  if (filter) args.push('--filter-pattern', filter);
  const output = awsRun(state, args, { timeout: 60000 });
  console.log(output || 'No log events found for this period.');
}

function awsLogGroups(state) {
  awsHeader(state, 'Log Groups');
  const data = awsJson(state, ['logs', 'describe-log-groups']);
  const groups = data.logGroups || [];
  if (!groups.length) { console.log('No CloudWatch log groups found.'); return; }
  for (const group of groups) {
    console.log(`${group.logGroupName}`);
    console.log(`   Stored bytes: ${group.storedBytes ?? 0} | Retention: ${group.retentionInDays ?? 'Never expire'} | Streams: ${group.logStreamCount ?? 'unknown'}`);
  }
}
function awsLogSearch(state, functionName, since = '1h', filter = '') {
  awsHeader(state, `Log Search${functionName ? ` — ${functionName}` : ' — All Lambda Functions'}`);
  const data = awsJson(state, ['lambda', 'list-functions']);
  const functions = (data.Functions || []).filter(fn => !functionName || fn.FunctionName.toLowerCase().includes(functionName.toLowerCase()));
  if (!functions.length) throw new Error(`No Lambda function matches${functionName ? ` "${functionName}"` : ''}.`);
  let found = false;
  for (const fn of functions) {
    console.log(`\n── ${fn.FunctionName} ──`);
    const args = ['logs', 'tail', `/aws/lambda/${fn.FunctionName}`, '--since', since, '--format', 'short'];
    if (filter) args.push('--filter-pattern', filter);
    try {
      const output = awsRun(state, args, { timeout: 60000 });
      if (output.trim()) { console.log(output); found = true; }
      else console.log('No matching log events.');
    } catch (error) { console.log(`Unable to read logs: ${error.message}`); }
  }
  if (!found) console.log('\nNo matching log events found.');
}
function awsLogFollow(state, functionName, filter = '') {
  if (!functionName) throw new Error('Select a Lambda function for live tail.');
  awsHeader(state, `Live Tail — ${functionName}`);
  console.log('Following logs. Press Ctrl+C to stop and return to Toolbox.\n');
  const args = awsArgs(state, ['logs', 'tail', `/aws/lambda/${functionName}`, '--follow', '--format', 'short']);
  if (filter) args.push('--filter-pattern', filter);
  const result = spawnSync('aws', args, { stdio: 'inherit', timeout: 0, env: process.env });
  if (result.error) throw new Error(`Unable to start live tail: ${result.error.message}`);
  if (result.status !== 0 && result.status !== null) throw new Error(`Live tail exited with status ${result.status}`);
}
async function awsLogCenterMenu(state) {
  const options = [
    { label: 'Browse Function Logs', detail: 'Choose Lambda and time window', key: '1', action: 'browse' },
    { label: 'Search Logs', detail: 'Filter by text or CloudWatch filter pattern', key: '2', action: 'search' },
    { label: 'Recent Errors — All Functions', detail: 'Search ERROR events across Lambdas', key: '3', action: 'errors' },
    { label: 'Live Tail', detail: 'Follow a Lambda log stream in real time', key: '4', action: 'follow' },
    { label: 'Log Groups', detail: 'Inventory CloudWatch log groups and retention', key: '5', action: 'groups' },
    { label: 'Back', detail: 'Return to AWS Operations', key: 'q', action: 'back' },
  ];
  while (true) {
    const selected = terminalMenu('AWS LOG CENTER', options, awsMenuHeader(state));
    if (!selected || selected.action === 'back') return;
    try {
      if (selected.action === 'browse') {
        const fn = awsMenuSelectLambda(state);
        const since = fn && awsMenuSelectTime();
        if (fn && since) awsLogs(state, fn, since);
      } else if (selected.action === 'search') {
        const fn = await promptText('Lambda name (blank = all functions)');
        const since = awsMenuSelectTime();
        if (since) {
          const filter = await promptText('Filter pattern (blank = all logs; e.g. ERROR, \"Exception\", ?WARN)');
          awsLogSearch(state, fn || null, since, filter);
        }
      } else if (selected.action === 'errors') {
        awsLogSearch(state, null, '1h', 'ERROR');
      } else if (selected.action === 'follow') {
        const fn = awsMenuSelectLambda(state);
        if (fn) {
          const filter = await promptText('Filter pattern (blank = all events)');
          awsLogFollow(state, fn, filter);
        }
      } else if (selected.action === 'groups') {
        awsLogGroups(state);
      }
      menuPause();
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      menuPause();
    }
  }
}
function awsErrors(state, functionName) {
  awsHeader(state, 'Recent Errors');
  if (functionName) awsLogs(state, functionName, '1h', 'ERROR');
  else {
    const data = awsJson(state, ['lambda', 'list-functions']);
    const functions = (data.Functions || []).map(f => f.FunctionName);
    if (!functions.length) { console.log('No Lambda functions found.'); return; }
    for (const fn of functions) {
      console.log(`\n── ${fn} ──`);
      try { console.log(awsRun(state, ['logs', 'tail', `/aws/lambda/${fn}`, '--since', '1h', '--format', 'short', '--filter-pattern', 'ERROR'], { timeout: 60000 }) || 'No ERROR events.'); }
      catch (error) { console.log(`Unable to read logs: ${error.message}`); }
    }
  }
}
function awsQueues(state) {
  awsHeader(state, 'SQS Queues');
  const data = awsJson(state, ['sqs', 'list-queues']);
  const urls = data.QueueUrls || [];
  if (!urls.length) { console.log('No SQS queues found.'); return; }
  for (const url of urls) {
    const attrs = awsJson(state, ['sqs', 'get-queue-attributes', '--queue-url', url, '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed', 'CreatedTimestamp', 'RedrivePolicy']);
    const a = attrs.Attributes || {};
    const name = url.split('/').pop();
    const count = Number(a.ApproximateNumberOfMessages || 0);
    const inflight = Number(a.ApproximateNumberOfMessagesNotVisible || 0);
    console.log(`${count > 0 ? '🟡' : '🟢'} ${name}`);
    console.log(`   Available: ${count} | In flight: ${inflight} | Delayed: ${a.ApproximateNumberOfMessagesDelayed || 0}`);
    if (a.RedrivePolicy) {
      try { console.log(`   DLQ target: ${JSON.parse(a.RedrivePolicy).deadLetterTargetArn}`); } catch {}
    }
  }
}

function awsMetrics(state, functionName) {
  awsHeader(state, `CloudWatch Metrics${functionName ? ` — ${functionName}` : ''}`);
  const data = awsJson(state, ['lambda', 'list-functions']);
  const functions = (data.Functions || []).filter(f => !functionName || f.FunctionName.toLowerCase().includes(functionName.toLowerCase()));
  if (!functions.length) throw new Error(`No Lambda function matches${functionName ? ` "${functionName}"` : ''}.`);
  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const metric = (fn, name, stat) => {
    const result = awsJson(state, ['cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/Lambda', '--metric-name', name,
      '--dimensions', `Name=FunctionName,Value=${fn}`, '--start-time', start.toISOString(), '--end-time', end.toISOString(),
      '--period', '3600', '--statistics', stat]);
    const points = result.Datapoints || [];
    if (!points.length) return 'No datapoints';
    const value = points.reduce((sum, p) => sum + Number(p[stat] || 0), 0);
    return `${value.toFixed(stat === 'Average' ? 2 : 0)} ${stat === 'Average' ? 'avg' : 'total'}`;
  };
  for (const fn of functions) {
    console.log(`⚡ ${fn.FunctionName}`);
    for (const [name, stat] of [['Invocations','Sum'], ['Errors','Sum'], ['Throttles','Sum'], ['Duration','Average']]) {
      try { console.log(`   ${name.padEnd(12)} ${metric(fn.FunctionName, name, stat)}`); }
      catch (error) { console.log(`   ${name.padEnd(12)} unavailable (${error.message})`); }
    }
    console.log('');
  }
}
function awsConfig(state, key, value) {
  state.aws ||= { region: 'us-east-2', profile: null };
  if (!key) { console.log(`AWS region: ${state.aws.region || 'us-east-2'}\nAWS profile: ${state.aws.profile || '(default)'}`); return; }
  if (!['region', 'profile'].includes(key)) throw new Error('Config keys: region, profile');
  if (value === undefined) throw new Error(`Usage: toolbox aws config ${key} <value>`);
  state.aws[key] = value === 'default' || value === 'off' ? (key === 'profile' ? null : 'us-east-2') : value;
  saveState(state);
  console.log(`AWS ${key} set to ${state.aws[key] || '(default)'}.`);
}
const AWS_MENU_ITEMS = [
  { label: 'AWS Health Check', detail: 'Credentials, CloudFormation, Lambda and SQS availability', key: '1', action: 'health' },
  { label: 'Incident Investigation', detail: 'Correlated identity, stacks, queues, errors and metrics', key: '2', action: 'investigate' },
  { label: 'AWS Status', detail: 'Account identity, CloudFormation stacks, Lambda inventory', key: 's', action: 'status' },
  { label: 'Deployments', detail: 'Recent CloudFormation deployment history', key: '2', action: 'deployments' },
  { label: 'Stack Events', detail: 'Resource-level CloudFormation events', key: '3', action: 'stack-events' },
  { label: 'Lambda Functions', detail: 'Function inventory, runtime, memory and timeout', key: '4', action: 'lambdas' },
  { label: 'AWS Log Center', detail: 'Browse, search, follow and investigate Lambda logs', key: '5', action: 'log-center' },
  { label: 'Error Scanner', detail: 'Search recent Lambda ERROR events', key: '6', action: 'errors' },
  { label: 'CloudWatch Metrics', detail: 'Invocations, errors, throttles and duration', key: '7', action: 'metrics' },
  { label: 'SQS Queues', detail: 'Available, in-flight, delayed messages and DLQs', key: '8', action: 'queues' },
  { label: 'Infrastructure Audit', detail: 'CV detailed account and resource audit', key: '9', action: 'cv-audit' },
  { label: 'Stack Deep Inspection', detail: 'CV stack-level diagnostics beyond quick events', key: 't', action: 'cv-stack' },
  { label: 'Lambda Diagnostics', detail: 'CV detailed Lambda inspection beyond inventory', key: 'l', action: 'cv-lambda' },
  { label: 'API Health', detail: 'Check configured Collector’s Vault endpoints', key: 'a', action: 'cv-api' },
  { label: 'IAM Inventory', detail: 'Inspect IAM resources and roles', key: 'i', action: 'cv-iam' },
  { label: 'Cost Report', detail: 'AWS service cost analysis', key: 'c', action: 'cv-cost' },
  { label: 'Backup Inventory', detail: 'S3 versioning and DynamoDB PITR inventory', key: 'b', action: 'cv-backup-inventory' },
  { label: 'Change Set Review', detail: 'Inspect CloudFormation proposed changes', key: 's', action: 'cv-changeset' },
  { label: 'Recovery Inventory', detail: 'Review AWS recovery readiness', key: 'r', action: 'cv-recovery-inventory' },
  { label: 'DynamoDB Backup', detail: 'Create a backup with CV confirmation safeguards', key: 'd', action: 'cv-dynamodb-backup' },
  { label: 'AWS Configuration', detail: 'Choose AWS profile and region', key: '0', action: 'config' },
  { label: 'Help', detail: 'Command reference and examples', key: '?', action: 'help' },
];

function menuReadKey() {
  // Raw TTY reads should block until a key arrives; some pseudo-terminals otherwise
  // expose stdin as non-blocking and throw EAGAIN during interactive navigation.
  process.stdin._handle?.setBlocking?.(true);
  const one = Buffer.alloc(1);
  fs.readSync(0, one, 0, 1, null);
  const char = one.toString();
  if (char === '\x1b') {
    const seq = Buffer.alloc(2);
    fs.readSync(0, seq, 0, 2, null);
    const sequence = seq.toString();
    if (sequence === '[A') return 'UP';
    if (sequence === '[B') return 'DOWN';
    if (sequence === '[C') return 'RIGHT';
    if (sequence === '[D') return 'LEFT';
    return 'ESC';
  }
  if (char === '\r' || char === '\n') return 'ENTER';
  if (char === '\x03') return 'CTRL_C';
  return char.toLowerCase();
}

function terminalMenu(title, options, subtitle = '') {
  if (!options.length) {
    console.log(`\n${title}: no options available.\n`);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') menuPause();
    return null;
  }
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return null;
  let selected = 0;
  const wasRaw = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    while (true) {
      process.stdout.write('\x1b[2J\x1b[H');
      console.log('\x1b[1;36m╔══════════════════════════════════════════════════════════════════════╗\x1b[0m');
      console.log(`\x1b[1;36m║  🛰️  TOOLBOX — ${title.toUpperCase().padEnd(49).slice(0,49)}║\x1b[0m`);
      if (subtitle) console.log(`\x1b[1;36m║  ${subtitle.padEnd(68).slice(0,68)}║\x1b[0m`);
      console.log('\x1b[1;36m╠══════════════════════════════════════════════════════════════════════╣\x1b[0m');
      options.forEach((item, index) => {
        const prefix = index === selected ? '\x1b[1;33m ❯ ' : '   ';
        const number = item.key ? `${item.key}.` : `${index + 1}.`;
        const line = `${number.padEnd(4)} ${item.label.padEnd(25)} ${item.detail || ''}`;
        console.log(`${prefix}${line}\x1b[0m`);
      });
      console.log('\x1b[1;36m╠══════════════════════════════════════════════════════════════════════╣\x1b[0m');
      console.log('  ↑↓ Navigate   ENTER Select   Number/shortcut   Q Back/Exit');
      const key = menuReadKey();
      if (key === 'CTRL_C' || key === 'q') return null;
      if (key === 'UP' || key === 'k') selected = (selected + options.length - 1) % options.length;
      else if (key === 'DOWN' || key === 'j') selected = (selected + 1) % options.length;
      else if (key === 'ENTER') return options[selected];
      else {
        const match = options.findIndex(item => item.key === key || String(options.indexOf(item) + 1) === key);
        if (match >= 0) return options[match];
      }
    }
  } finally {
    process.stdin.setRawMode(Boolean(wasRaw));
    process.stdin._handle?.setBlocking?.(false);
    process.stdin.pause();
    process.stdout.write('\x1b[0m');
  }
}

function menuPause(message = 'Press any key to return to the AWS menu...') {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  console.log(`\n${message}`);
  menuReadKey();
  process.stdin.setRawMode(false);
  process.stdin._handle?.setBlocking?.(false);
  process.stdin.pause();
}

function awsMenuHeader(state) {
  const config = state.aws || { region: 'us-east-2', profile: null };
  let account = 'Account identity unavailable';
  try {
    const identity = awsJson(state, ['sts', 'get-caller-identity']);
    account = `Account: ${identity.Account} | ${identity.Arn}`;
  } catch (error) {
    account = `⚠ ${error.message.split('\n')[0]}`;
  }
  return `${account}\nRegion: ${config.region || 'us-east-2'} | Profile: ${config.profile || 'default'}`;
}

function awsMenuSelectStack(state, title = 'Select CloudFormation Stack') {
  const data = awsJson(state, ['cloudformation', 'list-stacks']);
  const stacks = (data.StackSummaries || [])
    .filter(stack => stack.StackStatus && !stack.StackStatus.startsWith('DELETE_'))
    .sort((a, b) => new Date(b.LastUpdatedTime || b.CreationTime) - new Date(a.LastUpdatedTime || a.CreationTime));
  const options = stacks.map((stack, index) => ({
    label: stack.StackName,
    detail: `${stack.StackStatus} | ${stack.LastUpdatedTime || stack.CreationTime || 'date unavailable'}`,
    key: String(index + 1),
    value: stack.StackName,
  }));
  if (!options.length) { console.log('No CloudFormation stacks found.'); menuPause(); return null; }
  return terminalMenu(title, options, 'Choose a stack');
}

function awsMenuSelectLambda(state, title = 'Select Lambda Function') {
  const data = awsJson(state, ['lambda', 'list-functions']);
  const functions = (data.Functions || []).map(fn => ({
    label: fn.FunctionName,
    detail: `${fn.Runtime || 'runtime unknown'} | ${fn.State || 'state unknown'}`,
    key: '',
    value: fn.FunctionName,
  }));
  if (!functions.length) { console.log('No Lambda functions found.'); menuPause(); return null; }
  const selected = terminalMenu(title, functions, 'Choose a function');
  return selected?.value || null;
}

function awsMenuSelectTime() {
  const options = [
    { label: 'Last 15 minutes', detail: '15m', key: '1', value: '15m' },
    { label: 'Last hour', detail: '1h', key: '2', value: '1h' },
    { label: 'Last 3 hours', detail: '3h', key: '3', value: '3h' },
    { label: 'Last 6 hours', detail: '6h', key: '4', value: '6h' },
    { label: 'Last 24 hours', detail: '24h', key: '5', value: '24h' },
  ];
  return terminalMenu('LOG TIME WINDOW', options, 'Select how far back to read logs')?.value || null;
}

function awsMenuConfig(state) {
  const current = state.aws || { region: 'us-east-2', profile: null };
  const options = [
    { label: `Region: ${current.region || 'us-east-2'}`, detail: 'Change AWS region', key: '1', action: 'region' },
    { label: `Profile: ${current.profile || 'default'}`, detail: 'Change AWS CLI profile', key: '2', action: 'profile' },
    { label: 'Reset to defaults', detail: 'Region us-east-2, default profile', key: '3', action: 'reset' },
    { label: 'Back', detail: 'Return to AWS menu', key: 'q', action: 'back' },
  ];
  const selected = terminalMenu('AWS CONFIGURATION', options, `Current: ${current.region || 'us-east-2'} | ${current.profile || 'default'}`);
  if (!selected || selected.action === 'back') return;
  if (selected.action === 'reset') { state.aws = { region: 'us-east-2', profile: null }; saveState(state); console.log('AWS configuration reset.'); menuPause(); return; }
  if (selected.action === 'region') {
    const regions = ['us-east-2', 'us-east-1', 'us-west-2', 'us-west-1', 'ca-central-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2'];
    const options = regions.map((region, index) => ({ label: region, detail: region === current.region ? 'Current region' : '', key: String(index + 1), value: region }));
    const choice = terminalMenu('SELECT AWS REGION', options, 'Choose a region');
    if (choice) { state.aws.region = choice.value; saveState(state); console.log(`Region set to ${choice.value}.`); menuPause(); }
  } else if (selected.action === 'profile') {
    const result = spawnSync('aws', ['configure', 'list-profiles'], { encoding: 'utf8', timeout: 10000 });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Unable to list AWS profiles').trim());
    const profiles = [...new Set(['default', ...(result.stdout || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean)])];
    const options = profiles.map((profile, index) => ({ label: profile, detail: profile === current.profile || (!current.profile && profile === 'default') ? 'Current profile' : '', key: String(index + 1), value: profile === 'default' ? null : profile }));
    const choice = terminalMenu('SELECT AWS PROFILE', options, 'Choose an AWS CLI profile');
    if (choice) { state.aws.profile = choice.value; saveState(state); console.log(`Profile set to ${choice.value || 'default'}.`); menuPause(); }
  }
}

function awsMenu(state) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    awsHelp();
    return;
  }
  while (true) {
    const selected = terminalMenu('AWS OPERATIONS', AWS_MENU_ITEMS, awsMenuHeader(state));
    if (!selected) return;
    try {
      switch (selected.action) {
        case 'health': awsHealth(state); menuPause(); break;
        case 'investigate': awsInvestigate(state); menuPause(); break;
        case 'status': awsStatus(state); menuPause(); break;
        case 'deployments': {
          const scope = terminalMenu('DEPLOYMENTS', [{ label: 'All stacks', detail: 'Recent deployment history', key: '1', value: null }, { label: 'Select a stack', detail: 'Inspect one stack', key: '2', value: 'select' }], 'Choose deployment scope');
          if (scope?.value === null) { awsDeployments(state); menuPause(); }
          else if (scope?.value === 'select') { const stack = awsMenuSelectStack(state, 'DEPLOYMENTS'); if (stack) { awsDeployments(state, stack.value); menuPause(); } }
          break;
        }
        case 'stack-events': { const stack = awsMenuSelectStack(state, 'STACK EVENTS'); if (stack) { awsStackEvents(state, stack.value); menuPause(); } break; }
        case 'lambdas': awsLambdaList(state); menuPause(); break;
        case 'logs': {
          const fn = awsMenuSelectLambda(state, 'CLOUDWATCH LOGS');
          if (fn) { const since = awsMenuSelectTime(); if (since) { awsLogs(state, fn, since); menuPause(); } }
          break;
        }
        case 'errors': {
          const options = [{ label: 'Scan all Lambda functions', detail: 'Recent ERROR events', key: '1', value: null }, { label: 'Select a Lambda function', detail: 'Scan one function', key: '2', value: 'select' }];
          const choice = terminalMenu('ERROR SCANNER', options, 'Choose scan scope');
          if (choice?.value === null) { awsErrors(state); menuPause(); }
          else if (choice?.value === 'select') { const fn = awsMenuSelectLambda(state, 'ERROR SCANNER'); if (fn) { awsErrors(state, fn); menuPause(); } }
          break;
        }
        case 'metrics': {
          const options = [{ label: 'All Lambda functions', detail: 'Metrics for every function', key: '1', value: null }, { label: 'Select a Lambda function', detail: 'Metrics for one function', key: '2', value: 'select' }];
          const choice = terminalMenu('CLOUDWATCH METRICS', options, 'Choose metrics scope');
          if (choice?.value === null) { awsMetrics(state); menuPause(); }
          else if (choice?.value === 'select') { const fn = awsMenuSelectLambda(state, 'METRICS'); if (fn) { awsMetrics(state, fn); menuPause(); } }
          break;
        }
        case 'queues': awsQueues(state); menuPause(); break;
        case 'config': awsMenuConfig(state); break;
        case 'cv-audit': case 'cv-stack': case 'cv-lambda': case 'cv-api': case 'cv-iam': case 'cv-cost': case 'cv-backup-inventory': case 'cv-changeset': case 'cv-recovery-inventory': case 'cv-dynamodb-backup': {
          runCvCommand(selected.action.replace(/^cv-/, 'aws-'), [], state);
          menuPause();
          break;
        }
        case 'help': awsHelp(); menuPause(); break;
      }
    } catch (error) {
      console.error(`\n❌ ${error.message}\n`);
      menuPause();
    }
  }
}

function awsHelp() {
  console.log(`\nTOOLBOX — AWS COMMANDS

Interactive menu:
  toolbox aws
  toolbox aws menu

Quick operations:
  toolbox aws health
  toolbox aws investigate 1h
  toolbox aws status
  toolbox aws deployments [stack-name]
  toolbox aws stack-events [stack-name]
  toolbox aws lambdas
  toolbox aws logs <function-name> [since] [filter-pattern]
  toolbox aws log-search [function-name] [since] [filter-pattern]
  toolbox aws log-tail <function-name> [filter-pattern]
  toolbox aws log-groups
  toolbox aws errors [function-name]
  toolbox aws metrics [function-name]
  toolbox aws queues

CV deep inspection:
  toolbox aws audit
  toolbox aws stack [arguments]
  toolbox aws lambda [arguments]
  toolbox aws api [arguments]
  toolbox aws iam [arguments]
  toolbox aws cost [arguments]
  toolbox aws backup-inventory [arguments]
  toolbox aws changeset [arguments]
  toolbox aws recovery-inventory [arguments]
  toolbox aws dynamodb-backup [arguments]

Configuration:
  toolbox aws config
  toolbox aws config region <region>
  toolbox aws config profile <profile>

Examples:
  toolbox aws logs collectors-vault-staging-web 1h
  toolbox aws errors collectors-vault-staging-image-cleanup
  toolbox aws metrics collectors-vault-staging-web
  toolbox aws config profile cv
  toolbox aws config region us-east-2
  toolbox aws audit
  toolbox aws backup-inventory

Native Toolbox AWS inspection commands are read-only. CV commands retain their
existing safeguards; DynamoDB backup creates a resource and requires confirmation.
The menu requires an interactive terminal.`);
}

function awsCommand(state, args) {
  const [sub = 'menu', ...rest] = args;
  if (sub === 'menu') { awsMenu(state); return; }
  switch (sub) {
    case 'health': awsHealth(state); break;
    case 'investigate': awsInvestigate(state, rest[0] || '1h'); break;
    case 'status': awsStatus(state); break;
    case 'deployments': awsDeployments(state, rest[0]); break;
    case 'stack-events': awsStackEvents(state, rest[0]); break;
    case 'lambdas': awsLambdaList(state); break;
    case 'logs': awsLogs(state, rest[0], rest[1] || '1h', rest[2] || null); break;
    case 'log-search': awsLogSearch(state, rest[0] || null, rest[1] || '1h', rest.slice(2).join(' ')); break;
    case 'log-tail': awsLogFollow(state, rest[0], rest.slice(1).join(' ')); break;
    case 'log-groups': awsLogGroups(state); break;
    case 'errors': awsErrors(state, rest[0]); break;
    case 'queues': awsQueues(state); break;
    case 'metrics': awsMetrics(state, rest[0]); break;
    case 'config': awsConfig(state, rest[0], rest[1]); break;
    case 'audit': case 'stack': case 'lambda': case 'api': case 'iam': case 'cost': case 'backup-inventory': case 'changeset': case 'recovery-inventory': case 'dynamodb-backup':
      runCvCommand(`aws-${sub}`, rest, state); break;
    case 'help': awsHelp(); break;
    default: throw new Error(`Unknown AWS command: ${sub}`);
  }
}

async function main(argv = process.argv.slice(2)) {
  let [command = (process.stdin.isTTY ? 'menu' : 'scan'), ...args] = argv;
  if (command === 'radar') { command = args.shift() || 'menu'; }
  const state = loadState();
  try {
    switch (command) {
      case 'add': addProject(state, args[0], args.slice(1).join(' ')); break;
      case 'remove': {
        const p = findProject(state, args[0]);
        if (!p) throw new Error(`Project not found: ${args[0]}`);
        state.projects = state.projects.filter(x => x !== p); delete state.notes[p.name]; delete state.sessions[p.name]; saveState(state); console.log(`Removed ${p.name}.`); break;
      }
      case 'projects': printBanner(); console.log(state.projects.length ? state.projects.map(p => `  • ${p.name}\n    ${p.path}`).join('\n') : 'No projects registered.'); console.log(''); break;
      case 'scan': case 'status': scan(state); break;
      case 'dashboard': dashboard(state); break;
      case 'system': systemDiagnostics(); break;
      case 'git': gitWorkspace(state); break;
      case 'config': toolboxConfig(state, args[0], args[1]); break;
      case 'focus': focus(state, args[0]); break;
      case 'note': saveNote(state, args[0], args.slice(1).join(' ')); break;
      case 'resume': resume(state, args[0]); break;
      case 'test': runProjectScript(state, args[0], 'test'); break;
      case 'build': runProjectScript(state, args[0], 'build'); break;
      case 'watch': watch(state, args[0]); break;
      case 'cockpit': cockpit(state, args[0]); break;
      case 'aws': awsCommand(state, args); break;
      case 'menu': case 'interactive': await interactiveMainMenu(state); break;
      case 'cv': if (args[0] === 'menu' || !args.length) await cvToolsMenu(); else if (args[0] === 'fun' || args[0] === 'cv-fun') { const result = spawnSync('cv-fun', args.slice(1), { stdio: 'inherit', timeout: 60 * 60 * 1000 }); if (result.error) throw new Error(`cv-fun was not found: ${result.error.message}`); if (result.status !== 0) process.exitCode = result.status || 1; } else runCvCommand(args[0], args.slice(1)); break;
      case 'help': case '--help': case '-h': usage(); break;
      case 'version': case '--version': console.log(`TOOLBOX v${VERSION}`); break;
      case 'verify': case 'deploy': runCvCommand(command, args); break;
      case 'cv-fun': { const result = spawnSync('cv-fun', args, { stdio: 'inherit', timeout: 60 * 60 * 1000 }); if (result.error) throw new Error(`cv-fun was not found: ${result.error.message}`); if (result.status !== 0) process.exitCode = result.status || 1; break; }
      default: usage(); if (command) process.exitCode = 1;
    }
  } catch (error) { console.error(`\n❌ ${error.message}\n`); process.exitCode = 1; }
}
if (require.main === module) main().catch(error => { console.error(`\n❌ ${error.message}\n`); process.exitCode = 1; });
module.exports = { loadState, saveState, getProjectSnapshot, formatSnapshot, addProject, findProject, cockpit, dashboard, systemDiagnostics, gitWorkspace, awsHealth, awsInvestigate, toolboxConfig, awsArgs, awsRun, awsJson, awsCommand, awsConfig, awsHelp, awsMenu, awsLogSearch, awsLogGroups, awsLogFollow, awsLogCenterMenu, terminalMenu, AWS_MENU_ITEMS, MAIN_MENU_ITEMS, PROJECT_MENU_ITEMS, CV_TOOL_GROUPS, splitCommandArgs, cvToolsMenu, interactiveMainMenu, projectMenu, main };

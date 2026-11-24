'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'src', 'toolbox.js');

function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-radar-cli-'));
  const home = path.join(base, 'toolbox-home');
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init']);
  git(['config', 'user.email', 'radar-test@example.com']);
  git(['config', 'user.name', 'Radar Test']);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
    name: 'radar-fixture',
    scripts: {
      test: 'node -e "process.exit(0)"',
      verify: 'node -e "process.exit(0)"',
      build: 'node -e "process.exit(0)"',
      fail: 'node -e "process.exit(7)"'
    }
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture');
  git(['add', '.']); git(['commit', '-m', 'initial fixture']);
  return { base, home, repo };
}
function cli(f, args, options = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, TOOLBOX_HOME: f.home },
    timeout: options.timeout || 15000,
    ...options
  });
}
function register(f, name = 'fixture') {
  const result = cli(f, ['add', name, f.repo]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
function cleanup(f) { fs.rmSync(f.base, { recursive: true, force: true }); }

test('CLI help and version return success and expected output', () => {
  const f = fixture();
  try {
    const help = cli(f, ['help']);
    assert.equal(help.status, 0); assert.match(help.stdout, /toolbox add/); assert.match(help.stdout, /toolbox watch/); assert.match(help.stdout, /toolbox aws status/); assert.match(help.stdout, /toolbox menu/); assert.match(help.stdout, /Interactive command center/);
    const version = cli(f, ['version']);
    assert.equal(version.status, 0); assert.match(version.stdout, /TOOLBOX v1\.1\.0/);
  } finally { cleanup(f); }
});

test('interactive menu falls back to command reference when terminal is non-interactive', () => {
  const f = fixture();
  try {
    const result = cli(f, ['menu']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /toolbox menu/);
    assert.match(result.stdout, /toolbox aws menu/);
  } finally { cleanup(f); }
});

test('add registers a repo and rejects missing, non-repo, and duplicate projects', () => {
  const f = fixture();
  try {
    register(f);
    assert.match(cli(f, ['projects']).stdout, /fixture/);
    assert.equal(cli(f, ['add', 'missing', path.join(f.base, 'absent')]).status, 1);
    const nonRepo = path.join(f.base, 'plain'); fs.mkdirSync(nonRepo);
    assert.equal(cli(f, ['add', 'plain', nonRepo]).status, 1);
    assert.equal(cli(f, ['add', 'fixture', f.repo]).status, 1);
    assert.equal(cli(f, ['add']).status, 1);
  } finally { cleanup(f); }
});

test('remove deletes project and associated notes/sessions', () => {
  const f = fixture();
  try {
    register(f);
    assert.equal(cli(f, ['note', 'fixture', 'next task']).status, 0);
    const remove = cli(f, ['remove', 'fixture']);
    assert.equal(remove.status, 0); assert.match(remove.stdout, /Removed fixture/);
    assert.doesNotMatch(cli(f, ['projects']).stdout, /fixture/);
    const state = JSON.parse(fs.readFileSync(path.join(f.home, 'state.json'), 'utf8'));
    assert.equal(state.notes.fixture, undefined); assert.equal(state.sessions.fixture, undefined);
  } finally { cleanup(f); }
});

test('scan and status display project snapshots and dirty changes', () => {
  const f = fixture();
  try {
    register(f);
    const scan = cli(f, ['scan']); assert.equal(scan.status, 0); assert.match(scan.stdout, /fixture/); assert.match(scan.stdout, /clean/);
    const defaultScan = cli(f, []); assert.equal(defaultScan.status, 0); assert.match(defaultScan.stdout, /fixture/);
    fs.writeFileSync(path.join(f.repo, 'new.txt'), 'dirty');
    const status = cli(f, ['status']); assert.equal(status.status, 0); assert.match(status.stdout, /1 change/); assert.match(status.stdout, /need attention/);
  } finally { cleanup(f); }
});

test('focus reports project details and saved notes', () => {
  const f = fixture();
  try {
    register(f); cli(f, ['note', 'fixture', 'continue testing']);
    const result = cli(f, ['focus', 'fixture']);
    assert.equal(result.status, 0); assert.match(result.stdout, /FOCUS MODE/); assert.match(result.stdout, /continue testing/);
    assert.equal(cli(f, ['focus', 'unknown']).status, 1);
  } finally { cleanup(f); }
});

test('note saves session and resume retrieves it by project or all projects', () => {
  const f = fixture();
  try {
    register(f);
    const note = cli(f, ['note', 'fixture', 'review serial mappings']);
    assert.equal(note.status, 0); assert.match(note.stdout, /Note saved/);
    assert.match(cli(f, ['resume', 'fixture']).stdout, /review serial mappings/);
    assert.match(cli(f, ['resume']).stdout, /review serial mappings/);
    assert.equal(cli(f, ['note', 'fixture']).status, 1);
    assert.equal(cli(f, ['note', 'missing', 'text']).status, 1);
  } finally { cleanup(f); }
});

test('test command chooses test script and persists successful session', () => {
  const f = fixture();
  try {
    register(f);
    const result = cli(f, ['test', 'fixture'], { timeout: 30000 });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /test passed/);
    assert.match(cli(f, ['resume', 'fixture']).stdout, /test passed/);
  } finally { cleanup(f); }
});

test('test command falls back to verify and reports missing scripts', () => {
  const f = fixture();
  try {
    register(f);
    const packageFile = path.join(f.repo, 'package.json');
    fs.writeFileSync(packageFile, JSON.stringify({ scripts: { verify: 'node -e "process.exit(0)"' } }));
    const result = cli(f, ['test', 'fixture']); assert.equal(result.status, 0); assert.match(result.stdout, /verify/);
    fs.writeFileSync(packageFile, JSON.stringify({ scripts: {} }));
    assert.equal(cli(f, ['test', 'fixture']).status, 1);
  } finally { cleanup(f); }
});

test('build command succeeds, fails, and reports missing build script', () => {
  const f = fixture();
  try {
    register(f);
    assert.equal(cli(f, ['build', 'fixture'], { timeout: 30000 }).status, 0);
    fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify({ scripts: { build: 'node -e "process.exit(7)"' } }));
    assert.equal(cli(f, ['build', 'fixture'], { timeout: 30000 }).status, 7);
    fs.writeFileSync(path.join(f.repo, 'package.json'), JSON.stringify({ scripts: {} }));
    assert.equal(cli(f, ['build', 'fixture']).status, 1);
  } finally { cleanup(f); }
});

test('CV toolkit commands are passed through to the installed cv executable', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'bin'); fs.mkdirSync(fakeBin);
  const record = path.join(f.base, 'cv-args.txt');
  const fakeCv = path.join(fakeBin, 'cv');
  fs.writeFileSync(fakeCv, `#!/bin/sh
printf '%s\n' "$@" > "${record}"
echo 'CV toolkit invoked'
`);
  fs.chmodSync(fakeCv, 0o755);
  try {
    const result = cli(f, ['cv', 'verify', '--quick'], { env: { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /CV toolkit invoked/);
    assert.equal(fs.readFileSync(record, 'utf8'), 'verify\n--quick\n');
  } finally { cleanup(f); }
});

test('unknown command returns nonzero and prints usage', () => {
  const f = fixture();
  try {
    const result = cli(f, ['nonsense']); assert.equal(result.status, 1); assert.match(result.stdout, /Commands:/);
  } finally { cleanup(f); }
});

test('watch starts, prints snapshot, and exits cleanly on SIGINT', async () => {
  const f = fixture();
  try {
    register(f);
    const child = spawn(process.execPath, [CLI, 'watch', '5'], { env: { ...process.env, TOOLBOX_HOME: f.home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGINT'); reject(new Error('watch did not start in time')); }, 5000);
      const check = () => { if (output.includes('WATCH')) { clearTimeout(timeout); resolve(); } else setTimeout(check, 25); };
      check();
    });
    child.kill('SIGINT');
    const exit = await new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
    assert.equal(exit.code, 0); assert.match(output, /fixture/); assert.match(output, /Toolbox offline/);
  } finally { cleanup(f); }
});

test('installer has valid shell syntax and installs wrapper into isolated home', () => {
  const f = fixture();
  try {
    const installer = path.join(ROOT, 'install.sh');
    assert.equal(spawnSync('bash', ['-n', installer]).status, 0);
    const result = spawnSync('bash', [installer], { encoding: 'utf8', env: { ...process.env, HOME: f.base } });
    assert.equal(result.status, 0, result.stderr); assert.ok(fs.existsSync(path.join(f.base, 'bin', 'toolbox'))); assert.ok(fs.existsSync(path.join(f.base, 'bin', 'radar')));
    const wrapper = fs.readFileSync(path.join(f.base, 'bin', 'toolbox'), 'utf8'); assert.match(wrapper, /src\/toolbox\.js/);
    const alias = fs.readFileSync(path.join(f.base, 'bin', 'radar'), 'utf8'); assert.match(alias, /bin\/toolbox/);
  } finally { cleanup(f); }
});

test('NIGHTWATCH cockpit shows command center and project health', () => {
  const f = fixture();
  try {
    register(f);
    cli(f, ['note', 'fixture', 'finish test coverage']);
    const result = cli(f, ['cockpit']);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /NIGHTWATCH/);
    assert.match(result.stdout, /PROJECT STATUS/);
    assert.match(result.stdout, /MISSION CONTROL/);
    assert.match(result.stdout, /finish test coverage/);
    const focused = cli(f, ['cockpit', 'fixture']);
    assert.equal(focused.status, 0);
    assert.match(focused.stdout, /fixture/);
    assert.equal(cli(f, ['cockpit', 'missing']).status, 1);
  } finally { cleanup(f); }
});

test('AWS config persists region and profile settings', () => {
  const f = fixture();
  try {
    assert.equal(cli(f, ['aws', 'config', 'region', 'us-east-2']).status, 0);
    assert.equal(cli(f, ['aws', 'config', 'profile', 'staging']).status, 0);
    const config = cli(f, ['aws', 'config']);
    assert.equal(config.status, 0);
    assert.match(config.stdout, /us-east-2/);
    assert.match(config.stdout, /staging/);
    const state = JSON.parse(fs.readFileSync(path.join(f.home, 'state.json'), 'utf8'));
    assert.deepEqual(state.aws, { region: 'us-east-2', profile: 'staging' });
  } finally { cleanup(f); }
});

test('AWS status command uses CLI and reports account, stacks, and Lambda', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'bin'); fs.mkdirSync(fakeBin);
  const fakeAws = path.join(fakeBin, 'aws');
  fs.writeFileSync(fakeAws, `#!/bin/sh
case "$1 $2" in
  "sts get-caller-identity") echo '{"Account":"123456789012","Arn":"arn:aws:iam::123456789012:user/test"}' ;;
  "cloudformation list-stacks") echo '{"StackSummaries":[{"StackName":"CollectorsVaultStaging","StackStatus":"UPDATE_COMPLETE","LastUpdatedTime":"2026-11-23T12:00:00Z"}]}' ;;
  "lambda list-functions") echo '[{"Name":"web","State":"Active","Runtime":"nodejs24.x"},{"Name":"worker","State":"Active","Runtime":"nodejs24.x"}]' ;;
  *) echo '{}' ;;
esac
`);
  fs.chmodSync(fakeAws, 0o755);
  try {
    const result = cli(f, ['aws', 'status'], { env: { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /123456789012/);
    assert.match(result.stdout, /CollectorsVaultStaging/);
    assert.match(result.stdout, /web/);
  } finally { cleanup(f); }
});

test('AWS logs command invokes CloudWatch tail with requested function and interval', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'bin'); fs.mkdirSync(fakeBin);
  const record = path.join(f.base, 'aws-args.txt');
  const fakeAws = path.join(fakeBin, 'aws');
  fs.writeFileSync(fakeAws, `#!/bin/sh
printf '%s\\n' "$@" > "${record}"
echo '2026-11-23T12:00:00 ERROR test failure'
`);
  fs.chmodSync(fakeAws, 0o755);
  try {
    const result = cli(f, ['aws', 'logs', 'cv-web', '30m'], { env: { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /ERROR test failure/);
    const args = fs.readFileSync(record, 'utf8');
    assert.ok(args.includes('/aws/lambda/cv-web'));
    assert.match(args, /30m/);
    assert.match(args, /--region/);
  } finally { cleanup(f); }
});

test('AWS metrics queries Lambda CloudWatch metrics', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'bin'); fs.mkdirSync(fakeBin);
  const record = path.join(f.base, 'aws-args.txt');
  const fakeAws = path.join(fakeBin, 'aws');
  fs.writeFileSync(fakeAws, `#!/bin/sh
printf '%s\\n' "$@" >> "${record}"
case "$1 $2" in
  "lambda list-functions") echo '{"Functions":[{"FunctionName":"cv-web"}]}' ;;
  "cloudwatch get-metric-statistics") echo '{"Datapoints":[{"Sum":12,"Average":123.4}]}' ;;
  *) echo '{}' ;;
esac
`);
  fs.chmodSync(fakeAws, 0o755);
  try {
    const result = cli(f, ['aws', 'metrics', 'cv-web'], { env: { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Invocations/);
    assert.match(result.stdout, /Errors/);
    assert.match(result.stdout, /Duration/);
    assert.ok(fs.readFileSync(record, 'utf8').includes('AWS/Lambda'));
  } finally { cleanup(f); }
});

test('AWS deployments, stack-events, Lambda list, and SQS queues use read-only AWS commands', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'bin'); fs.mkdirSync(fakeBin);
  const fakeAws = path.join(fakeBin, 'aws');
  fs.writeFileSync(fakeAws, `#!/bin/sh
case "$1 $2" in
  "cloudformation list-stacks") echo '{"StackSummaries":[{"StackName":"CollectorsVaultStaging","StackStatus":"UPDATE_COMPLETE","LastUpdatedTime":"2026-11-23T12:00:00Z","StackId":"stack-id"}]}' ;;
  "cloudformation describe-stack-events") echo '{"StackEvents":[{"Timestamp":"2026-11-23T12:00:00Z","LogicalResourceId":"WebFunction","ResourceType":"AWS::Lambda::Function","ResourceStatus":"UPDATE_COMPLETE"},{"Timestamp":"2026-11-23T11:59:00Z","LogicalResourceId":"Stack","ResourceType":"AWS::CloudFormation::Stack","ResourceStatus":"UPDATE_FAILED","ResourceStatusReason":"simulated failure"}]}' ;;
  "lambda list-functions") echo '{"Functions":[{"FunctionName":"cv-web","State":"Active","Runtime":"nodejs24.x","MemorySize":512,"Timeout":30,"LastModified":"2026-11-23T12:00:00.000+0000"}]}' ;;
  "sqs list-queues") echo '{"QueueUrls":["https://sqs.us-east-2.amazonaws.com/123456789012/image-queue","https://sqs.us-east-2.amazonaws.com/123456789/image-dlq"]}' ;;
  "sqs get-queue-attributes") echo '{"Attributes":{"ApproximateNumberOfMessages":"2","ApproximateNumberOfMessagesNotVisible":"1","ApproximateNumberOfMessagesDelayed":"0","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"arn:aws:sqs:us-east-2:123456789012:image-dlq\\"}"}}' ;;
  *) echo '{}' ;;
esac
`);
  fs.chmodSync(fakeAws, 0o755);
  const env = { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` };
  try {
    const deployments = cli(f, ['aws', 'deployments'], { env });
    assert.equal(deployments.status, 0, deployments.stderr || deployments.stdout);
    assert.match(deployments.stdout, /CollectorsVaultStaging/);
    const events = cli(f, ['aws', 'stack-events', 'CollectorsVault'], { env });
    assert.equal(events.status, 0, events.stderr || events.stdout);
    assert.match(events.stdout, /UPDATE_FAILED/);
    assert.match(events.stdout, /simulated failure/);
    const lambdas = cli(f, ['aws', 'lambdas'], { env });
    assert.equal(lambdas.status, 0, lambdas.stderr || lambdas.stdout);
    assert.match(lambdas.stdout, /cv-web/);
    const queues = cli(f, ['aws', 'queues'], { env });
    assert.equal(queues.status, 0, queues.stderr || queues.stdout);
    assert.match(queues.stdout, /image-queue/);
    assert.match(queues.stdout, /Available: 2/);
  } finally { cleanup(f); }
});

test('unified AWS commands pass through to CV toolkit with Toolbox profile and region', () => {
  const f = fixture();
  const fakeBin = path.join(f.base, 'fake-bin');
  fs.mkdirSync(fakeBin);
  const record = path.join(f.base, 'cv-args.json');
  const fakeCv = path.join(fakeBin, 'cv');
  fs.writeFileSync(fakeCv, `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(record)}, JSON.stringify({args: process.argv.slice(2), profile: process.env.AWS_PROFILE, region: process.env.AWS_REGION, defaultRegion: process.env.AWS_DEFAULT_REGION}));
`);
  fs.chmodSync(fakeCv, 0o755);
  try {
    cli(f, ['aws', 'config', 'profile', 'cv']);
    cli(f, ['aws', 'config', 'region', 'us-east-2']);
    const result = cli(f, ['aws', 'audit'], { env: { ...process.env, TOOLBOX_HOME: f.home, PATH: `${fakeBin}:${process.env.PATH}` } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(record, 'utf8')), {
      args: ['aws-audit'], profile: 'cv', region: 'us-east-2', defaultRegion: 'us-east-2'
    });
  } finally { cleanup(f); }
});

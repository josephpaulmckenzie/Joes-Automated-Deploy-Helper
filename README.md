# TOOLBOX v1.1.0

A unified, zero-dependency personal developer command center for project management, development workflows, AWS operations, Collector's Vault utilities, and NIGHTWATCH.

## Requirements
- Node.js 20+
- Git
- AWS CLI v2 for Toolbox's AWS menu
- The existing `cv` toolkit installed and available on PATH for Collector's Vault utilities

## Install / upgrade
```bash
unzip toolbox-v1.1.0.zip
cd toolbox-v1.1.0
bash install.sh
source ~/.zshrc
```

Installs `toolbox` in `~/bin`. The old `radar` command remains as a compatibility alias to `toolbox menu`. If `~/.toolbox/state.json` does not exist, Toolbox imports the existing `~/.dev-radar/state.json` data and writes it to the new location. The original Radar file is kept as a backup. Set `TOOLBOX_HOME` to override the Toolbox state directory.

## Interactive menu
```bash
toolbox
toolbox menu
```

Menus support arrows, Enter, numeric shortcuts, and Q/back.

- Command Center Dashboard
- Git Workspace
- System Diagnostics
- Dashboard / project scan
- Project management
- Run tests / build
- Watch projects
- NIGHTWATCH
- AWS operations
- Collector's Vault tools
- Version / help

## Commands
```bash
toolbox add <name> <path>
toolbox remove <name>
toolbox projects
toolbox dashboard
toolbox system
toolbox git
toolbox config
toolbox scan
toolbox status
toolbox focus <name>
toolbox note <name> <text>
toolbox resume [name]
toolbox test <name>
toolbox build <name>
toolbox watch [seconds]
toolbox cockpit [project]
toolbox aws
toolbox aws health
toolbox aws investigate [since]
toolbox cv
toolbox cv <cv-command> [arguments]
toolbox verify [arguments]
toolbox deploy [arguments]
toolbox help
toolbox version
```

## Collector's Vault tools

The CV Tools menu integrates the existing `cv` toolkit without copying or rewriting its individual utilities. AWS-specific CV commands are centralized under `toolbox aws` so there is only one AWS menu.

Categories:
- Project: status, snapshot, doctor, test, preflight, release-check, verify, deploy
- Mac/System: disk, large files, network, Docker, Time Machine, startup items, Raspberry Pi health
- Git/Recovery: Git checks, recovery inspection, source backup/verification, cleanup preview/safe cleanup, recovery plan
- Data Backup: encrypted backup, verify, isolated restore drill
- Vault/Diagnostics: integrity, config, Node audit, Playwright, JSON report

Direct pass-through:
```bash
toolbox cv status
toolbox cv verify
toolbox cv deploy
toolbox cv aws-audit
toolbox cv data-backup
```

Toolbox invokes the installed `cv` command. If it is unavailable, install/restore your existing CV toolkit and ensure `~/bin` is on PATH.

## AWS operations

The unified AWS menu combines Toolbox's operational dashboard with the deeper CV AWS utilities. v1.1 adds live health checks and a correlated incident-investigation command:
- Health Check, Incident Investigation, status, deployments, stack events, Lambda inventory, AWS Log Center, metrics, SQS
- Infrastructure audit, API health, IAM inventory, cost reporting
- Backup inventory, change-set review, recovery inventory, DynamoDB backup

AWS profile and region settings are applied to Toolbox AWS CLI calls and passed to CV AWS commands through `AWS_PROFILE`, `AWS_REGION`, and `AWS_DEFAULT_REGION`. CV commands retain their own safety confirmations. Toolbox's native AWS inspection operations remain read-only. The CV DynamoDB backup command creates a backup and retains its existing confirmation safeguards.

## Command Center (v1.1)

```bash
toolbox dashboard       # project overview and quick actions
toolbox git             # repository branches, changes and upstream state
toolbox system          # OS, Node, Git, AWS CLI and disk diagnostics
toolbox aws health      # credential, CloudFormation, Lambda and SQS checks
toolbox aws investigate 1h  # read-only correlated AWS diagnostic report
toolbox config          # display Toolbox configuration
```

The incident investigation gathers account identity, active stacks, queue inventory, recent Lambda errors, and metrics. Each section is isolated so a failed AWS API call does not prevent the remaining diagnostics. It is observational and does not modify AWS resources.

## State and safety

State: `~/.toolbox/state.json` (or `TOOLBOX_HOME`).
Toolbox reads Git state and only runs project scripts when explicitly requested. CV commands retain their own confirmation/safety behavior. AWS operations in Toolbox are read-only.

## Tests
```bash
npm test
```

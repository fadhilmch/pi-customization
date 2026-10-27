'use strict';
// Deterministic bash risk rules. Pure: given a command string and a context
// ({cwd, home, env, config, tmpRoots}) it returns {findings, denies}.
//   findings: [{id, reason, severity: 'normal'|'high', signature}]  -> ask
//   denies:   [{id, reason}]                                         -> hard block
const path = require('node:path');
const { parseShell, SUB, PSUB } = require('./shell.js');
const P = require('./paths.js');

const MAX_DEPTH = 3;

function mk(id, reason, key, severity) {
  return { id, reason, severity: severity || 'normal', signature: key ? `${id}:${key}` : id };
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'ash', 'csh', 'tcsh']);
const NET_SRC = new Set(['curl', 'wget', 'nc', 'ncat', 'fetch', 'http', 'https', 'xh']);
const HEREDOC_SAFE = new Set(['cat', 'tee', 'git', 'gh', 'echo', 'printf', 'jq', 'grep', 'egrep', 'sed', 'awk', 'wc', 'sort', 'uniq', 'head', 'tail', 'base64', 'less', 'more', 'diff', 'patch', 'xargs', 'read', 'mail', 'sendmail']);
const DB_CLIS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlite', 'mongosh', 'mongo', 'redis-cli', 'clickhouse-client', 'duckdb', 'cockroach', 'usql', 'sqlcmd']);
const NO_ARG_SCAN = new Set(['echo', 'printf', 'which', 'type', 'ls', 'test', '[', '[[', 'stat', 'file', 'cd', 'man', 'help', 'export', 'unset', 'set', 'alias', 'true', 'false']);
const WRITE_ALL = new Set(['mv', 'tee', 'touch', 'mkdir', 'rmdir', 'truncate', 'rm', 'shred', 'unlink']);
const WRITE_DEST_LAST = new Set(['cp', 'rsync', 'install', 'ln']);

const SYSTEM_DIRS = new Set(['/usr', '/etc', '/bin', '/sbin', '/lib', '/lib64', '/var', '/System', '/Library', '/Applications', '/boot', '/opt', '/dev', '/private', '/Users', '/home', '/root', '/srv', '/mnt', '/Volumes']);

function cmdName(tok) {
  return path.basename(String(tok || ''));
}

function flagSet(args) {
  const short = new Set();
  const long = new Set();
  for (const a of args) {
    if (a === '--') break;
    if (a.startsWith('--')) long.add(a.split('=')[0]);
    else if (/^-[A-Za-z0-9]+$/.test(a)) for (const ch of a.slice(1)) short.add(ch);
  }
  return { short, long };
}

function positional(args) {
  const out = [];
  let rest = false;
  for (const a of args) {
    if (!rest && a === '--') { rest = true; continue; }
    if (!rest && a.startsWith('-') && a !== '-') continue;
    out.push(a);
  }
  return out;
}

function optValue(args, shorts, longs) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((shorts.includes(a) || longs.includes(a)) && args[i + 1] !== undefined) return args[i + 1];
    for (const l of longs) if (a.startsWith(l + '=')) return a.slice(l.length + 1);
    for (const s of shorts) if (s.length === 2 && a.startsWith(s) && a.length > 2 && !a.startsWith('--')) return a.slice(2);
  }
  return undefined;
}

function isCatastrophicTarget(t, home) {
  if (!t || /[\u0001\u0002]/.test(t)) return false;
  let x = P.expandHome(t, home).replace(/\/+$/, '') || '/';
  if (x.endsWith('/*') || x.endsWith('/.')) x = x.slice(0, -2) || '/';
  if (!path.isAbsolute(x)) return false;
  x = path.normalize(x);
  return x === '/' || x === home || x === path.dirname(home) || SYSTEM_DIRS.has(x);
}

// ---- SQL ---------------------------------------------------------------------
function sqlRisk(text) {
  const t = String(text);
  if (/\bdrop\s+(table|database|schema|index|view|user|role|collection)\b/i.test(t)) return 'DROP statement';
  if (/\btruncate\b/i.test(t)) return 'TRUNCATE statement';
  if (/\bdelete\s+from\b/i.test(t) && !/\bwhere\b/i.test(t)) return 'DELETE FROM without WHERE';
  if (/\bupdate\s+\S+\s+set\b/i.test(t) && !/\bwhere\b/i.test(t)) return 'UPDATE without WHERE';
  if (/\b(flushall|flushdb)\b/i.test(t)) return 'Redis flush';
  if (/\b(dropdatabase|\.drop\s*\(|deletemany\s*\(\s*\{\s*\}\s*\))/i.test(t)) return 'Mongo drop/deleteMany({})';
  return null;
}

// ---- wrapper unwrapping ------------------------------------------------------
function unwrap(tokens, out) {
  const t = tokens.slice();
  let guard = 0;
  while (t.length && guard++ < 10) {
    while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();
    if (!t.length) break;
    const c = cmdName(t[0]);
    if (c === 'sudo' || c === 'doas' || c === 'pkexec') {
      out.findings.push(mk('sudo', `privileged command (${c})`, ''));
      t.shift();
      while (t.length && t[0].startsWith('-')) {
        const o = t.shift();
        if (c === 'sudo' && ['-u', '-g', '-h', '-p', '-C', '-U', '-r', '-t'].includes(o)) t.shift();
        if (c === 'doas' && ['-u', '-C'].includes(o)) t.shift();
      }
      continue;
    }
    if (c === 'su') { out.findings.push(mk('sudo', 'privileged command (su)', '')); return []; }
    if (c === 'env') {
      t.shift();
      while (t.length && (t[0].startsWith('-') || /^[A-Za-z_]\w*=/.test(t[0]))) {
        const o = t.shift();
        if (['-u', '-C', '-S'].includes(o)) t.shift();
      }
      continue;
    }
    if (['command', 'builtin', 'nohup', 'exec', 'time', 'nice', 'ionice', 'caffeinate', 'stdbuf', 'setsid', 'unbuffer'].includes(c)) {
      t.shift();
      while (t.length && t[0].startsWith('-')) {
        const o = t.shift();
        if ((c === 'nice' && o === '-n') || (c === 'ionice' && (o === '-c' || o === '-n'))) t.shift();
      }
      continue;
    }
    if (c === 'timeout') {
      t.shift();
      while (t[0] && t[0].startsWith('-')) { const o = t.shift(); if (o === '-s' || o === '-k') t.shift(); }
      t.shift();
      continue;
    }
    if (c === 'xargs') {
      t.shift();
      while (t[0] && t[0].startsWith('-')) {
        const o = t.shift();
        if (['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'].includes(o)) t.shift();
      }
      if (!t.length) t.push('echo');
      continue;
    }
    break;
  }
  return t;
}

// ---- path helpers --------------------------------------------------------------
function display(p) {
  return p.length > 70 ? '…' + p.slice(-69) : p;
}

function protectedGlob(abs, ctx) {
  for (const g of (ctx.config && ctx.config.protectedPaths) || []) {
    if (P.matchesGlob(abs, g, ctx.home)) return g;
  }
  return null;
}

function checkWritePath(p, ctx, how) {
  if (!p || p === '-' || /^\/dev\/(null|stdout|stderr|tty|zero)$/.test(p)) return null;
  if (/^\/dev\//.test(p)) return mk('write-device', `${how} device ${p}`, p, 'high');
  if (P.hasUnresolved(p)) return mk('path-unknown', `${how} a path built from variables/substitutions (${display(p)})`, p);
  const abs = P.resolvePath(p, ctx.cwd, ctx.home);
  const sk = P.secretKind(abs);
  if (sk) return mk('sensitive-write', `${how} ${sk}: ${display(abs)}`, abs);
  const wk = P.writeKind(abs);
  if (wk) return mk('protected-write', `${how} ${wk}: ${display(abs)}`, abs);
  const g = protectedGlob(abs, ctx);
  if (g) return mk('protected-path', `${how} protected path ${display(abs)} (matches ${g})`, abs);
  if (P.isScratch(abs, ctx.tmpRoots)) return null;
  if (!P.isInside(abs, ctx.cwdReal)) return mk('write-outside-cwd', `${how} outside the project: ${display(abs)}`, path.dirname(abs));
  return null;
}

function checkReadPath(p, ctx, how, strict) {
  if (!p || p === '-' || /^\/dev\//.test(p)) return null;
  if (P.hasUnresolved(p)) return null;
  const abs = P.resolvePath(p, ctx.cwd, ctx.home);
  const sk = P.secretKind(abs, { strict });
  if (sk) return mk('sensitive-read', `${how} ${sk}: ${display(abs)}`, abs);
  const g = protectedGlob(abs, ctx);
  if (g) return mk('protected-path', `${how} protected path ${display(abs)} (matches ${g})`, abs);
  return null;
}

// ---- git -----------------------------------------------------------------------
const MAIN_BRANCHES = /^(main|master|trunk|production|prod|release)$/;

// dir: the directory `git -C <path>` points at (several -C compose, like git does), or null.
function gitParts(args) {
  let i = 0;
  let dir = null;
  while (i < args.length) {
    const a = args[i];
    if (a === '-C') {
      const p = args[i + 1];
      if (p !== undefined) dir = dir === null || path.isAbsolute(p) ? p : path.join(dir, p);
      i += 2;
    } else if (['-c', '--git-dir', '--work-tree', '--namespace', '--exec-path'].includes(a)) i += 2;
    else if (a.startsWith('-')) i++;
    else break;
  }
  return { sub: args[i], rest: args.slice(i + 1), dir };
}

// Branch guard: ctx.currentBranch is a string or a lazy (dir) => string|null, where dir is the
// `git -C` target (null when absent); ctx.protectedBranches a list.
function protectedCurrentBranch(ctx, dir = null) {
  const list = ctx.protectedBranches;
  if (!list || !list.length) return null;
  let b = ctx.currentBranch;
  if (typeof b === 'function') { try { b = b(dir); } catch { b = null; } }
  return b && list.includes(b) ? b : null;
}

function gitRules(args, out, ctx = {}) {
  const { sub, rest, dir } = gitParts(args);
  if (!sub) return;
  const { short, long } = flagSet(rest);
  const pos = positional(rest);
  const has = (...names) => names.some((n) => long.has(n) || (n.length === 2 && short.has(n[1])));
  switch (sub) {
    case 'commit': {
      if (has('--dry-run')) return;
      const b = protectedCurrentBranch(ctx, dir);
      if (b) out.findings.push(mk('branch-guard', `git commit on protected branch ${b}`, `commit:${b}`));
      return;
    }
    case 'push': {
      const b = protectedCurrentBranch(ctx, dir);
      if (b) {
        const refs = pos.slice(1);
        const targetsCurrent = !refs.length || refs.some((a) => {
          const ref = a.replace(/^\+/, '');
          const dst = ref.includes(':') ? ref.split(':').pop() : ref;
          return dst.replace(/^refs\/heads\//, '') === b || (!ref.includes(':') && ref === 'HEAD');
        });
        if (targetsCurrent) out.findings.push(mk('branch-guard', `git push from protected branch ${b}`, `push:${b}`));
      }
      const force = has('--force', '-f', '--force-with-lease', '--force-if-includes', '--mirror') || rest.some((a) => /^\+\S/.test(a) && !a.startsWith('+-'));
      const del = has('--delete', '-d') || rest.some((a) => /^:\S/.test(a));
      const toMain = rest.some((a) => {
        if (a.startsWith('-')) return false;
        const ref = a.replace(/^\+/, '').split(':').pop().replace(/^refs\/heads\//, '');
        return MAIN_BRANCHES.test(ref);
      });
      const parts = [];
      if (force) parts.push('--force');
      if (del) parts.push('delete');
      if (toMain) parts.push('to main/master');
      const reason = 'git push' + (parts.length ? ' ' + parts.join(' ') : '');
      const high = force || del || toMain;
      out.findings.push(mk(high ? 'git-push-risky' : 'git-push', reason, pos.join(' '), high ? 'high' : 'normal'));
      return;
    }
    case 'reset':
      if (has('--hard', '--merge')) out.findings.push(mk('git-reset-hard', 'git reset --hard (discards changes)', pos.join(' '), 'high'));
      return;
    case 'clean':
      if ((has('-f', '--force') || short.has('f')) && !has('-n', '--dry-run')) out.findings.push(mk('git-clean', 'git clean -f (deletes untracked files)', pos.join(' ')));
      return;
    case 'checkout': {
      const dd = rest.indexOf('--');
      if (has('-f', '--force') || has('--ours', '--theirs') || dd >= 0 || pos.includes('.')) {
        if (!has('-b', '-B', '--orphan')) out.findings.push(mk('git-discard', 'git checkout that discards working-tree changes', rest.join(' ')));
      }
      return;
    }
    case 'restore':
      if (has('--staged') && !has('--worktree', '-W')) return;
      out.findings.push(mk('git-discard', 'git restore (discards working-tree changes)', rest.join(' ')));
      return;
    case 'switch':
      if (has('-f', '--force', '--discard-changes')) out.findings.push(mk('git-discard', 'git switch --discard-changes', rest.join(' ')));
      return;
    case 'branch':
      if (short.has('D') || ((has('-d', '--delete')) && has('-f', '--force'))) out.findings.push(mk('git-branch-delete', 'git branch -D (force-deletes a branch)', pos.join(' ')));
      return;
    case 'rebase':
      if (has('--abort', '--quit')) return;
      out.findings.push(mk('git-rebase', 'git rebase (rewrites history)', pos.join(' ')));
      return;
    case 'stash':
      if (pos[0] === 'drop' || pos[0] === 'clear') out.findings.push(mk('git-stash-drop', `git stash ${pos[0]} (loses stashed work)`, pos.join(' ')));
      return;
    case 'filter-branch': case 'filter-repo':
      out.findings.push(mk('git-rewrite', `git ${sub} (rewrites history)`, '', 'high'));
      return;
    case 'reflog':
      if (pos[0] === 'expire' || pos[0] === 'delete') out.findings.push(mk('git-reflog', `git reflog ${pos[0]}`, ''));
      return;
    case 'gc':
      if (rest.some((a) => a.startsWith('--prune'))) out.findings.push(mk('git-gc-prune', 'git gc --prune', ''));
      return;
    case 'update-ref':
      if (has('-d')) out.findings.push(mk('git-update-ref', 'git update-ref -d', ''));
      return;
    case 'tag':
      if (has('-d', '--delete')) out.findings.push(mk('git-tag-delete', 'git tag -d', pos.join(' ')));
      return;
    default:
  }
}

// ---- infra / deploy --------------------------------------------------------------
const K8S_MUTATING = new Set(['apply', 'delete', 'scale', 'rollout', 'patch', 'replace', 'edit', 'drain', 'cordon', 'uncordon', 'taint', 'create', 'exec', 'cp', 'set', 'run', 'expose', 'autoscale', 'annotate', 'label', 'debug', 'attach', 'port-forward']);
const AWS_READ = /^(get|describe|list|ls|head|show|view|read|batch-get|query|scan|lookup|search|filter|wait|help|validate|simulate|estimate|check|test|select|export-|verify|preview|detect|find|poll|tail|summarize)/;
const CLOUD_MUT_WORDS = /^(create|delete|update|deploy|patch|resize|start|stop|reset|restart|apply|enable|disable|attach|detach|move|rotate|submit|purge|import|remove|add|set|assign|invoke|destroy|up|down|scale|swap|ssh|scp|rm|mv|cp|rsync|mk|load|insert|release|publish|promote|delegate|login)$|^(set|add|remove|delete|create|update)-/;

function cloudRules(cmd, args, out) {
  const pos = positional(args);
  if (cmd === 'aws') {
    const svc = pos[0];
    const action = pos[1];
    if (!svc) return;
    if (svc === 's3') {
      if (['sync', 'mv', 'rm', 'rb', 'mb'].includes(action)) out.findings.push(mk('cloud-mutate', `aws s3 ${action}`, `aws s3 ${action}`, action === 'rb' || action === 'rm' ? 'high' : 'normal'));
      else if (action === 'cp' && String(pos[pos.length - 1] || '').startsWith('s3://')) out.findings.push(mk('cloud-mutate', 'aws s3 cp (upload)', 'aws s3 cp'));
      return;
    }
    if (svc === 'configure' || svc === 'sso') { if (action && action !== 'list' && action !== 'get') out.findings.push(mk('cloud-mutate', `aws ${svc} ${action}`, `aws ${svc} ${action}`)); return; }
    if (action && !AWS_READ.test(action)) out.findings.push(mk('cloud-mutate', `aws ${svc} ${action} (mutating)`, `aws ${svc} ${action}`));
    return;
  }
  if (cmd === 'gcloud' || cmd === 'az') {
    if (pos.some((w) => CLOUD_MUT_WORDS.test(w))) {
      const w = pos.find((x) => CLOUD_MUT_WORDS.test(x));
      out.findings.push(mk('cloud-mutate', `${cmd} ${pos.slice(0, 3).join(' ')} (mutating: ${w})`, `${cmd} ${pos.slice(0, 3).join(' ')}`));
    }
    return;
  }
  if (cmd === 'gsutil') {
    if (['rm', 'mv', 'rsync', 'cp', 'rb', 'mb'].includes(pos[0]) && (pos[0] !== 'cp' || String(pos[pos.length - 1] || '').startsWith('gs://'))) out.findings.push(mk('cloud-mutate', `gsutil ${pos[0]}`, `gsutil ${pos[0]}`));
    return;
  }
  if (cmd === 'bq' && ['rm', 'mk', 'load', 'update', 'truncate', 'insert'].includes(pos[0])) {
    out.findings.push(mk('cloud-mutate', `bq ${pos[0]}`, `bq ${pos[0]}`));
  }
}

function infraRules(cmd, args, out) {
  const pos = positional(args);
  const { long } = flagSet(args);
  switch (cmd) {
    case 'kubectl': case 'oc': {
      // verb = first positional (skipping values of common global flags is imprecise; good enough)
      const verb = pos.find((w) => K8S_MUTATING.has(w) || ['get', 'describe', 'logs', 'top', 'config', 'version', 'explain', 'diff', 'api-resources', 'auth', 'events', 'cluster-info', 'wait'].includes(w));
      if (!verb) return;
      if (verb === 'rollout' && ['status', 'history'].includes(pos[pos.indexOf('rollout') + 1])) return;
      if (K8S_MUTATING.has(verb)) out.findings.push(mk('infra-k8s', `kubectl ${verb}`, `kubectl ${verb}`, verb === 'delete' ? 'high' : 'normal'));
      return;
    }
    case 'helm':
      if (['install', 'upgrade', 'uninstall', 'delete', 'rollback', 'push'].includes(pos[0]) && !long.has('--dry-run')) out.findings.push(mk('infra-helm', `helm ${pos[0]}`, `helm ${pos[0]}`));
      return;
    case 'terraform': case 'tofu': case 'terragrunt':
      if (['apply', 'destroy', 'import', 'taint', 'untaint', 'force-unlock', 'run-all'].includes(pos[0]) || (pos[0] === 'state' && ['rm', 'mv', 'push'].includes(pos[1])) || (pos[0] === 'workspace' && pos[1] === 'delete')) {
        out.findings.push(mk('infra-terraform', `${cmd} ${pos.slice(0, 2).join(' ')}`.trim(), `${cmd} ${pos[0]}`, pos[0] === 'destroy' ? 'high' : 'normal'));
      }
      return;
    case 'pulumi':
      if (['up', 'destroy', 'cancel', 'import', 'refresh'].includes(pos[0]) || (pos[0] === 'stack' && pos[1] === 'rm')) out.findings.push(mk('infra-pulumi', `pulumi ${pos.slice(0, 2).join(' ')}`.trim(), `pulumi ${pos[0]}`, pos[0] === 'destroy' ? 'high' : 'normal'));
      return;
    case 'docker': case 'podman': {
      const sub = pos[0];
      if (sub === 'push') out.findings.push(mk('infra-docker', 'docker push', 'docker push'));
      else if (sub === 'system' && pos[1] === 'prune') out.findings.push(mk('infra-docker', 'docker system prune', 'docker system prune'));
      else if (['image', 'container', 'volume', 'network', 'builder', 'buildx'].includes(sub) && pos[1] === 'prune') out.findings.push(mk('infra-docker', `docker ${sub} prune`, `docker ${sub} prune`));
      else if (sub === 'volume' && pos[1] === 'rm') out.findings.push(mk('infra-docker', 'docker volume rm', 'docker volume rm'));
      else if (sub === 'compose' && pos[1] === 'down' && (long.has('--volumes') || flagSet(args).short.has('v'))) out.findings.push(mk('infra-docker', 'docker compose down -v (deletes volumes)', 'docker compose down -v'));
      else if (sub === 'run' && (long.has('--privileged') || args.some((a) => /^(-v|--volume)?=?\/:/.test(a) || a === '/:/host'))) out.findings.push(mk('infra-docker', 'docker run --privileged / mounting host root', 'docker run privileged', 'high'));
      return;
    }
    case 'ansible-playbook': case 'ansible':
      out.findings.push(mk('infra-deploy', `${cmd} (changes remote hosts)`, cmd));
      return;
    case 'vercel': case 'netlify': case 'fly': case 'flyctl': case 'firebase': case 'wrangler': case 'serverless': case 'sls': case 'cdk': case 'heroku': case 'railway': case 'supabase': {
      const words = pos.filter((w) => /^(deploy|publish|destroy|delete|rm|remove|release|promote|push|up|rollback|secrets|migrate)$/.test(w));
      if (words.length || long.has('--prod') || long.has('--production')) out.findings.push(mk('infra-deploy', `${cmd} ${pos.slice(0, 2).join(' ')} (deploy/destructive)`.replace(/\s+/g, ' '), `${cmd} ${words[0] || 'prod'}`));
      return;
    }
    default:
  }
}

function publishRules(cmd, args, out) {
  if (/^python[\d.]*$/.test(cmd) && args[0] === '-m' && args[1]) { cmd = args[1]; args = args.slice(2); }
  const pos = positional(args);
  const { long, short } = flagSet(args);
  const pkgMgr = ['npm', 'pnpm', 'yarn', 'bun'].includes(cmd);
  if (pkgMgr) {
    const sub = pos[0];
    if (['publish', 'unpublish', 'deprecate'].includes(sub) || (sub === 'npm' && pos[1] === 'publish') || (sub === 'dist-tag' && ['add', 'rm'].includes(pos[1])) || (sub === 'owner' && ['add', 'rm'].includes(pos[1])) || ['adduser', 'login', 'token'].includes(sub)) {
      out.findings.push(mk('publish', `${cmd} ${sub} (publishes/changes registry state)`, `${cmd} ${sub}`, 'high'));
      return;
    }
    const global = long.has('--global') || short.has('g') || (cmd === 'yarn' && sub === 'global') || (cmd === 'bun' && args.includes('-g'));
    if (global && ['install', 'i', 'add', 'uninstall', 'remove', 'rm', 'update', 'up', 'link', 'unlink', 'ln', 'global'].includes(sub)) {
      out.findings.push(mk('global-install', `${cmd} ${sub} -g (global install/uninstall)`, `${cmd} ${sub} -g`));
      return;
    }
    if (cmd === 'npm' && (sub === 'link' || sub === 'ln') && pos.length === 1) out.findings.push(mk('global-install', 'npm link (global symlink)', 'npm link'));
    return;
  }
  if (cmd === 'twine' && pos[0] === 'upload') out.findings.push(mk('publish', 'twine upload', 'twine upload', 'high'));
  else if (cmd === 'cargo' && pos[0] === 'publish') out.findings.push(mk('publish', 'cargo publish', 'cargo publish', 'high'));
  else if (cmd === 'cargo' && pos[0] === 'install') out.findings.push(mk('global-install', 'cargo install (global)', 'cargo install'));
  else if (cmd === 'gem' && ['push', 'yank'].includes(pos[0])) out.findings.push(mk('publish', `gem ${pos[0]}`, `gem ${pos[0]}`, 'high'));
  else if (cmd === 'gem' && pos[0] === 'install') out.findings.push(mk('global-install', 'gem install (global)', 'gem install'));
  else if (['poetry', 'uv', 'flit', 'hatch'].includes(cmd) && pos[0] === 'publish') out.findings.push(mk('publish', `${cmd} publish`, `${cmd} publish`, 'high'));
  else if (cmd === 'vsce' && pos[0] === 'publish') out.findings.push(mk('publish', 'vsce publish', 'vsce publish', 'high'));
  else if (cmd === 'go' && pos[0] === 'install') out.findings.push(mk('global-install', 'go install (global)', 'go install'));
}

function ghRules(args, out) {
  const pos = positional(args);
  const sub = pos[0];
  const act = pos[1];
  if (sub === 'pr' && act === 'merge') out.findings.push(mk('gh-merge', 'gh pr merge', 'gh pr merge', 'high'));
  else if (sub === 'repo' && ['delete', 'archive', 'rename', 'edit'].includes(act)) out.findings.push(mk('gh-repo', `gh repo ${act}`, `gh repo ${act}`, act === 'delete' ? 'high' : 'normal'));
  else if (sub === 'release' && ['create', 'delete', 'upload', 'edit'].includes(act)) out.findings.push(mk('publish', `gh release ${act}`, `gh release ${act}`, 'high'));
  else if (sub === 'issue' && act === 'delete') out.findings.push(mk('gh-repo', 'gh issue delete', 'gh issue delete'));
  else if (['secret', 'variable'].includes(sub) && ['set', 'delete', 'remove'].includes(act)) out.findings.push(mk('gh-repo', `gh ${sub} ${act}`, `gh ${sub} ${act}`));
  else if (sub === 'auth' && ['logout', 'refresh'].includes(act)) out.findings.push(mk('gh-repo', `gh auth ${act}`, `gh auth ${act}`));
  else if (sub === 'api') {
    const method = (optValue(args, ['-X'], ['--method']) || '').toUpperCase();
    const writes = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
    const implicit = !method && args.some((a) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(a));
    if (writes || implicit) out.findings.push(mk('gh-api-write', `gh api ${method || 'POST'} (mutating API call)`, `gh api ${method || 'POST'}`, method === 'DELETE' ? 'high' : 'normal'));
  }
}

function curlRules(cmd, args, out, ctx) {
  const local = args.some((a) => /^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/.test(a));
  if (local) return;
  if (cmd === 'curl') {
    const method = (optValue(args, ['-X'], ['--request']) || '').toUpperCase();
    const upload = args.some((a) => /^(-d|-F|-T|--data|--data-\w+|--form|--upload-file|--json)$/.test(a) || /^--(data|form|json)=/.test(a));
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || upload) out.findings.push(mk('network-write', `curl ${method || 'POST'} (sends data / mutates remote)`, `curl ${method || 'POST'}`));
  } else if (cmd === 'wget') {
    if (args.some((a) => /^--(post-data|post-file|method|body-data|body-file)/.test(a))) out.findings.push(mk('network-write', 'wget with request body/method', 'wget post'));
  }
}

function systemRules(cmd, args, out) {
  const pos = positional(args);
  const { short, long } = flagSet(args);
  switch (cmd) {
    case 'chmod': case 'chown': case 'chgrp': {
      const rec = short.has('R') || long.has('--recursive');
      const modes = cmd === 'chmod' ? pos[0] || '' : '';
      const wide = /^(0?777|a\+rwx|ugo\+rwx|o\+w|a\+w)/.test(modes);
      if (rec || wide) out.findings.push(mk('perm-change', `${cmd}${rec ? ' -R' : ''}${wide ? ' ' + modes : ''} (broad permission change)`, `${cmd} ${rec ? '-R' : ''} ${modes}`.trim()));
      return;
    }
    case 'killall': case 'pkill': case 'killall5':
      out.findings.push(mk('kill-broad', `${cmd} (kills processes by name)`, cmd));
      return;
    case 'kill': {
      const sig9 = args.some((a) => /^-(9|KILL|SIGKILL)$/i.test(a)) || (args.includes('-s') && /^(9|KILL|SIGKILL)$/i.test(args[args.indexOf('-s') + 1] || ''));
      const broad = pos.some((p) => /^(-1|0|-\d+)$/.test(p)) || args.some((a) => /[\u0001\u0002]/.test(a));
      if (sig9 || broad) out.findings.push(mk('kill-broad', 'kill -9 / broad kill', 'kill'));
      return;
    }
    case 'shutdown': case 'reboot': case 'halt': case 'poweroff':
      out.findings.push(mk('system-power', cmd, cmd, 'high'));
      return;
    case 'launchctl':
      if (['unload', 'remove', 'bootout', 'disable', 'load', 'bootstrap', 'enable'].includes(pos[0])) out.findings.push(mk('system-service', `launchctl ${pos[0]}`, `launchctl ${pos[0]}`));
      return;
    case 'systemctl': case 'service':
      if (['stop', 'disable', 'restart', 'mask', 'start', 'enable', 'reload', 'kill'].some((v) => pos.includes(v))) out.findings.push(mk('system-service', `${cmd} ${pos.join(' ')}`, `${cmd} ${pos.join(' ')}`));
      return;
    case 'crontab':
      if (!short.has('l')) out.findings.push(mk('system-service', 'crontab modification', 'crontab'));
      return;
    case 'brew':
      if (['install', 'reinstall', 'uninstall', 'remove', 'rm', 'upgrade', 'tap', 'untap', 'link', 'unlink'].includes(pos[0])) out.findings.push(mk('global-install', `brew ${pos[0]} (system-wide package change)`, `brew ${pos[0]}`));
      return;
    case 'apt': case 'apt-get': case 'dnf': case 'yum': case 'pacman': case 'apk': case 'zypper': case 'port': case 'snap':
      if (args.some((a) => /^(install|remove|purge|upgrade|dist-upgrade|autoremove|add|del|-S|-R|-Syu?)$/.test(a))) out.findings.push(mk('global-install', `${cmd} (system package change)`, cmd));
      return;
    default:
  }
}

function pipRules(cmd, args, ctx, out) {
  let a = args;
  if (/^python[\d.]*$/.test(cmd) && a[0] === '-m' && (a[1] === 'pip' || a[1] === 'pip3')) a = a.slice(2);
  else if (!/^pip[\d.]*$/.test(cmd)) return;
  const pos = positional(a);
  if (!['install', 'uninstall'].includes(pos[0])) return;
  const env = ctx.env || {};
  if (env.VIRTUAL_ENV || env.CONDA_PREFIX) return;
  if (a.some((x) => /^(--target|-t|--prefix|--dry-run)(=|$)/.test(x))) return;
  out.findings.push(mk('global-install', `pip ${pos[0]} with no virtualenv active (installs globally)`, `pip ${pos[0]}`));
}

// ---- catastrophic --------------------------------------------------------------
const FORK_BOMB = /:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:\s*&?[^}]*\}\s*;?\s*:/;

function catastrophic(cmd, args, ctx, out) {
  const { short, long } = flagSet(args);
  const pos = positional(args);
  if (cmd === 'rm') {
    const rec = short.has('r') || short.has('R') || long.has('--recursive');
    if (long.has('--no-preserve-root')) out.denies.push({ id: 'rm-root', reason: 'rm --no-preserve-root' });
    else if (rec && pos.some((t) => isCatastrophicTarget(t, ctx.home))) out.denies.push({ id: 'rm-root', reason: 'recursive delete of root/home/system directory' });
  } else if (['chmod', 'chown', 'chgrp'].includes(cmd) && (short.has('R') || long.has('--recursive'))) {
    if (pos.slice(1).some((t) => isCatastrophicTarget(t, ctx.home))) out.denies.push({ id: 'perm-root', reason: `recursive ${cmd} on root/home/system directory` });
  } else if (/^mkfs(\.|$)/.test(cmd) || cmd === 'newfs' || cmd === 'wipefs') {
    out.denies.push({ id: 'mkfs', reason: `${cmd} (formats a device)` });
  } else if (cmd === 'dd' && args.some((a) => /^of=\/dev\/(sd|hd|nvme|disk|rdisk|vd|mmcblk)/.test(a))) {
    out.denies.push({ id: 'dd-device', reason: 'dd writing to a block device' });
  } else if (cmd === 'diskutil' && /^(erase|partition|zero|secure|reformat)/i.test(pos[0] || '')) {
    out.denies.push({ id: 'diskutil', reason: `diskutil ${pos[0]}` });
  } else if (cmd === 'mv' && pos.length >= 2 && pos.slice(0, -1).some((t) => isCatastrophicTarget(t, ctx.home) && P.expandHome(t, ctx.home) !== '') ) {
    out.denies.push({ id: 'mv-root', reason: 'moving root/home/system directory' });
  }
}

// ---- segment classification ------------------------------------------------------
function classifySegment(seg, ctx, depth, out) {
  for (const r of seg.redirects) {
    if (r.kind === 'write') {
      const f = checkWritePath(r.target, ctx, 'writing via redirection to');
      if (f) out.findings.push(f);
    } else {
      const f = checkReadPath(r.target, ctx, 'reading', false);
      if (f) out.findings.push(f);
    }
  }
  if (/>\s*\/dev\/(sd|hd|nvme|disk|rdisk)/.test(seg.raw)) out.denies.push({ id: 'dd-device', reason: 'redirect into a block device' });

  const tokens = unwrap(seg.tokens, out);
  if (!tokens.length) return;
  const cmd = cmdName(tokens[0]);
  const args = tokens.slice(1);

  if (/[\u0001\u0002$]/.test(tokens[0]) || (tokens[0].startsWith('$') )) {
    out.findings.push(mk('uncertain', 'command name comes from a variable/substitution', ''));
  }

  if (seg.heredocs.length && !HEREDOC_SAFE.has(cmd)) {
    out.findings.push(mk('uncertain', `heredoc fed to ${cmd} (body not analysed)`, `heredoc:${cmd}`));
  }

  catastrophic(cmd, args, ctx, out);

  // Pipes into interpreters (curl | sh, base64 -d | bash ...)
  if (seg.pipedFromPrev) {
    const prevCmd = seg.prevSeg ? cmdName(unwrapQuiet(seg.prevSeg.tokens)[0]) : '';
    const prevDecode = seg.prevSeg && (prevCmd === 'base64' || seg.prevSeg.tokens.includes('-d') && prevCmd === 'openssl' || ['xxd', 'uudecode', 'gunzip', 'zcat'].includes(prevCmd));
    const net = NET_SRC.has(prevCmd);
    if (SHELLS.has(cmd) || cmd === 'source' || cmd === '.' || cmd === 'eval') {
      out.findings.push(mk('pipe-to-shell', net ? `piping network download into ${cmd}` : prevDecode ? `piping decoded data into ${cmd}` : `piping data into ${cmd}`, `pipe-to-shell:${prevCmd}`, net || prevDecode ? 'high' : 'normal'));
    } else if (net && /^(python[\d.]*|node|ruby|perl|php|deno|bun)$/.test(cmd)) {
      out.findings.push(mk('pipe-to-shell', `piping network download into ${cmd}`, `pipe-to-shell:${prevCmd}`, 'high'));
    }
  }

  switch (true) {
    case cmd === 'eval':
      out.findings.push(mk('eval', 'eval (executes dynamically built code)', ''));
      return;
    case SHELLS.has(cmd): {
      if (args.some((a) => a === '\u0002' || a.includes(PSUB))) out.findings.push(mk('pipe-to-shell', `${cmd} running process-substitution output`, 'procsub', 'high'));
      const ci = args.findIndex((a) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
      if (ci >= 0 && args[ci + 1] !== undefined) {
        if (depth >= MAX_DEPTH) out.findings.push(mk('uncertain', 'deeply nested shell -c', ''));
        else classifyInto(args[ci + 1], ctx, depth + 1, out);
      }
      return;
    }
    case cmd === 'source' || cmd === '.':
      if (args.some((a) => a.includes(PSUB))) out.findings.push(mk('pipe-to-shell', `${cmd} running process-substitution output`, 'procsub', 'high'));
      break;
    default:
  }

  switch (cmd) {
    case 'rm': {
      const { short, long } = flagSet(args);
      const pos = positional(args);
      const rec = short.has('r') || short.has('R') || long.has('--recursive');
      const force = short.has('f') || long.has('--force');
      if (rec) out.findings.push(mk('rm-recursive', `recursive delete: rm ${args.filter((a) => a.startsWith('-')).join(' ')} ${pos.join(' ')}`.replace(/\s+/g, ' ').trim(), pos.join(' ')));
      else if (force && pos.some((t) => /[*?]/.test(t))) out.findings.push(mk('rm-force-glob', `forced delete with wildcard: rm ${pos.join(' ')}`, pos.join(' ')));
      break;
    }
    case 'rimraf': case 'shred':
      out.findings.push(mk('rm-recursive', `${cmd} ${positional(args).join(' ')}`, positional(args).join(' ')));
      break;
    case 'find': {
      if (args.includes('-delete')) out.findings.push(mk('find-delete', 'find -delete', positional(args).join(' ')));
      for (let i = 0; i < args.length; i++) {
        if (['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) {
          const sub = [];
          for (let j = i + 1; j < args.length && args[j] !== ';' && args[j] !== '+'; j++) sub.push(args[j]);
          if (sub.length) classifySegment({ tokens: sub, redirects: [], raw: sub.join(' '), heredocs: [], pipedFromPrev: false, prevSeg: null }, ctx, depth + 1, out);
        }
      }
      break;
    }
    case 'git': gitRules(args, out, ctx); break;
    case 'gh': ghRules(args, out); break;
    case 'curl': case 'wget': {
      curlRules(cmd, args, out, ctx);
      const o = cmd === 'curl' ? optValue(args, ['-o'], ['--output']) : optValue(args, ['-O', '-P'], ['--output-document', '--directory-prefix']);
      if (o) { const f = checkWritePath(o, ctx, `${cmd} saving to`); if (f) out.findings.push(f); }
      break;
    }
    case 'ssh': case 'scp': case 'sftp': case 'nc': case 'ncat': case 'telnet':
      out.findings.push(mk('remote', `${cmd} (remote access / data transfer)`, cmd));
      break;
    case 'rsync':
      if (args.some((a) => /^[^/\s-][^/\s]*:/.test(a) && !a.startsWith('--'))) out.findings.push(mk('remote', 'rsync to/from remote host', 'rsync'));
      break;
    case 'dropdb': case 'dropuser': case 'mysqladmin':
      if (cmd !== 'mysqladmin' || args.includes('drop')) out.findings.push(mk('db-destructive', `${cmd} (drops database objects)`, cmd, 'high'));
      break;
    case 'prisma':
      if ((positional(args)[0] === 'migrate' && positional(args)[1] === 'reset') || (positional(args)[0] === 'db' && args.includes('--force-reset'))) out.findings.push(mk('db-destructive', 'prisma reset (wipes database)', 'prisma reset', 'high'));
      break;
    case 'rails': case 'rake':
      if (positional(args).some((w) => /^db:(drop|reset|schema:load|purge)$/.test(w))) out.findings.push(mk('db-destructive', `${cmd} ${positional(args).join(' ')}`, 'rails db', 'high'));
      break;
    case 'dd': {
      const of = args.find((a) => a.startsWith('of='));
      if (of) { const f = checkWritePath(of.slice(3), ctx, 'dd writing to'); if (f) out.findings.push(f); }
      break;
    }
    default:
  }

  if (DB_CLIS.has(cmd)) {
    const r = sqlRisk(seg.raw);
    if (r) out.findings.push(mk('db-destructive', `destructive SQL/DB command in ${cmd}: ${r}`, `${cmd}:${r}`, 'high'));
  }

  publishRules(cmd, args, out);
  pipRules(cmd, args, ctx, out);
  infraRules(cmd, args, out);
  cloudRules(cmd, args, out);
  systemRules(cmd, args, out);

  // Destination / target path checks for file-mutating commands
  if (WRITE_ALL.has(cmd) || WRITE_DEST_LAST.has(cmd) || (cmd === 'sed' && (flagSet(args).short.has('i') || args.some((a) => a.startsWith('--in-place')))) || ['chmod', 'chown', 'chgrp'].includes(cmd)) {
    let targets = positional(args);
    if (['chmod', 'chown', 'chgrp'].includes(cmd)) targets = targets.slice(1);
    if (cmd === 'sed' && !args.some((a) => a === '-e' || a === '-f')) targets = targets.slice(1);
    const tflag = optValue(args, ['-t'], ['--target-directory']);
    if (WRITE_DEST_LAST.has(cmd)) targets = tflag ? [tflag] : targets.slice(-1);
    for (const t of targets) {
      if (/^[^/\s]+@?[^/\s]*:/.test(t) && cmd === 'rsync') continue;
      const f = checkWritePath(t, ctx, `${cmd} modifies`);
      if (f) out.findings.push(f);
    }
  }

  // Reading secrets via any command's arguments
  if (!NO_ARG_SCAN.has(cmd) && !(cmd === 'git' && gitParts(args).sub === 'check-ignore')) {
    for (const a of args) {
      let v = a;
      if (a.startsWith('--') && a.includes('=')) v = a.slice(a.indexOf('=') + 1);
      else if (a.startsWith('-')) continue;
      if (!v || /\s/.test(v) || /[\u0001\u0002]/.test(v)) continue;
      if (!/[./~]/.test(v)) continue;
      const f = checkReadPath(v, ctx, `${cmd} touches`, false);
      if (f) out.findings.push(f);
    }
  }
}

function unwrapQuiet(tokens) {
  return unwrap(tokens, { findings: [], denies: [] });
}

function classifyInto(command, ctx, depth, out) {
  if (depth === 0 && FORK_BOMB.test(command)) out.denies.push({ id: 'fork-bomb', reason: 'fork bomb' });
  const parsed = parseShell(command);
  for (const u of parsed.uncertain) out.findings.push(mk('uncertain', `shell syntax not fully analysable (${u})`, ''));
  const cfg = ctx.config || {};
  for (const d of cfg.deny || []) if (d.re.test(command)) out.denies.push({ id: 'config-deny', reason: `matches deny rule /${d.source}/` });
  for (const seg of parsed.segments) {
    const text = seg.raw.trim();
    let denied = false;
    for (const d of cfg.deny || []) if (d.re.test(text)) { out.denies.push({ id: 'config-deny', reason: `matches deny rule /${d.source}/` }); denied = true; }
    if (denied) continue;
    // Always run built-in analysis for catastrophic patterns and structure.
    const local = { findings: [], denies: out.denies };
    classifySegment(seg, ctx, depth, local);
    for (const a of cfg.ask || []) if (a.re.test(text)) local.findings.push(mk('config-ask', `matches ask rule /${a.source}/`, a.source));
    const allowed = (cfg.allow || []).some((a) => a.re.test(text));
    // user-level "allow" can suppress ordinary findings but never "uncertain" ones
    const keep = allowed ? local.findings.filter((f) => f.id === 'uncertain' || f.id === 'config-ask') : local.findings;
    out.findings.push(...keep);
  }
}

function classifyBash(command, ctx) {
  const c = Object.assign({}, ctx);
  c.home = c.home || require('node:os').homedir();
  c.cwd = c.cwd || process.cwd();
  c.cwdReal = P.realish(path.resolve(c.cwd));
  c.tmpRoots = c.tmpRoots || P.tmpRoots();
  const out = { findings: [], denies: [] };
  classifyInto(String(command == null ? '' : command), c, 0, out);
  // de-duplicate
  const seen = new Set();
  out.findings = out.findings.filter((f) => (seen.has(f.signature + f.reason) ? false : (seen.add(f.signature + f.reason), true)));
  const dseen = new Set();
  out.denies = out.denies.filter((d) => (dseen.has(d.reason) ? false : (dseen.add(d.reason), true)));
  return out;
}

module.exports = { classifyBash, checkWritePath, checkReadPath, sqlRisk, isCatastrophicTarget, mk };

const test = require('node:test');
const assert = require('node:assert/strict');

const { stripAnsi, visibleWidth } = require('../ansi.js');
const { isSafeCommand } = require('../bash.js');
const plan = require('../plan.js');

test('bash allowlist: read-only commands pass', () => {
  for (const c of [
    'ls -la', 'cat README.md', 'grep -rn "foo > bar" src', 'rg TODO | head -20', 'git status', 'git log --oneline -5',
    'git diff HEAD~1', 'git branch -a', 'git branch --list', 'git config --get user.name', 'find . -name "*.ts"',
    'wc -l a.js && cat b.js', 'sed -n 1,5p file.txt', 'ls 2>/dev/null', 'ls foo 2>&1 | head', 'npm ls --depth=0',
    'node --version', 'echo "a; rm b"', "echo 'x && y'", 'FOO=1 ls', 'pwd; date', 'jq .name package.json',
    'curl -s https://example.com', 'sort a.txt | uniq -c', 'env', 'git remote -v',
  ]) assert.equal(isSafeCommand(c), true, c);
});

test('bash allowlist: mutating or unknown commands are blocked', () => {
  for (const c of [
    '', '   ', 'rm -rf x', 'mv a b', 'cp a b', 'mkdir d', 'touch f', 'echo hi > f', 'echo hi >> f', 'cat a > b',
    'ls; rm x', 'ls && rm x', 'ls | tee f', 'cat $(rm x)', 'cat `rm x`', 'echo "$(rm x)"', 'find . -delete',
    'find . -exec rm {} ;', 'sed -i s/a/b/ f', 'sed -n "w out" f', 'git commit -m x', 'git add .', 'git push',
    'git checkout main', 'git branch newbranch', 'git branch -D x', 'git config user.name x', 'git stash',
    'npm install', 'npm run build', 'yarn add x', 'pip install x', 'sudo ls', 'curl -o f https://x', 'curl -X POST x',
    'env rm x', 'sort -o out in', 'awk \'BEGIN{system("rm x")}\'', 'node script.js', 'python -c "print(1)"', 'vim f',
    'ls "unterminated', 'cat <(ls)', 'cat < f', 'rg --pre ./evil x', 'fd -x rm', 'echo a & rm x', 'xargs rm',
    'bash -c "ls"', 'git -c core.pager=evil log',
  ]) assert.equal(isSafeCommand(c), false, c);
  assert.equal(isSafeCommand(undefined), false);
});

test('tool sets', () => {
  assert.deepEqual(plan.planTools(['read', 'bash', 'edit', 'write', 'todo']), ['read', 'bash', 'todo', 'exit_plan_mode']);
  assert.deepEqual(plan.planTools(['read', 'exit_plan_mode']), ['read', 'exit_plan_mode']);
  assert.deepEqual(plan.restoredTools(['read', 'edit'], ['read']), ['read', 'edit']);
  assert.deepEqual(plan.restoredTools(undefined, ['read', 'exit_plan_mode']), ['read']);
});

test('instructions mention the exit tool and approval messages differ', () => {
  const text = plan.planInstructions();
  assert.ok(text.startsWith(plan.CONTEXT_TAG));
  assert.match(text, /exit_plan_mode/);
  assert.match(plan.approvalMessage('ask'), /asked before/);
  assert.doesNotMatch(plan.approvalMessage('auto'), /asked before/);
  assert.match(plan.keepPlanningMessage('use tests'), /use tests/);
  assert.doesNotMatch(plan.keepPlanningMessage(''), /feedback/);
});

test('extractSteps prefers numbered items, falls back to bullets', () => {
  const md = '## Plan\nSummary.\n\n1. **Add** `foo.js` helper\n2) Wire it up in index.ts\n   - sub bullet\n3. x\n\n- Risk: none';
  assert.deepEqual(plan.extractSteps(md), ['Add foo.js helper', 'Wire it up in index.ts']);
  assert.deepEqual(plan.extractSteps('- one step\n- [ ] checkbox\n- two step'), ['one step', 'two step']);
  assert.deepEqual(plan.extractSteps(''), []);
  assert.equal(plan.extractSteps('1. ' + 'a'.repeat(200))[0].length, 120);
});

test('indicators are teal', () => {
  assert.equal(stripAnsi(plan.widgetLine('ctrl+alt+p')), '⏸ plan mode on (ctrl+alt+p or /plan to exit)');
  assert.match(plan.widgetLine('x'), /38;2;72;150;140/);
  assert.equal(stripAnsi(plan.statusText()), '⏸ plan');
});

test('plan call and result rendering', () => {
  const out = plan.formatPlanCall('Summary\n1. step', { state: 'success' }).map(stripAnsi);
  assert.deepEqual(out, ['⏺ Plan (plan mode)', '  Summary', '  1. step']);
  const narrow = plan.formatPlanCall('x'.repeat(100), { width: 20 });
  assert.ok(narrow.every((l) => visibleWidth(l) <= 20));
  assert.equal(stripAnsi(plan.formatPlanResult('User approved\nmore', {})[0]), '  ⎿  User approved');
  assert.equal(stripAnsi(plan.formatPlanResult('', { isPartial: true })[0]), '  ⎿  Waiting for approval…');
});

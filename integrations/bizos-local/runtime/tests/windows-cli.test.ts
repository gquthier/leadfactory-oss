import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { cliLaunch } from '../src/harness/procs.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('runs npm Windows shims through Node without parsing prompt text in cmd.exe', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizos-win-shim-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules', 'codex'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'codex', 'cli.js'), '');
  const shim = join(root, 'codex.cmd');
  writeFileSync(shim, '@ECHO off\n"%~dp0\\node_modules\\codex\\cli.js" %*\n');
  const prompt = 'literal & del %PATH% | echo dangerous';
  expect(cliLaunch(shim, ['exec', prompt], 'win32')).toEqual({
    command: process.execPath,
    args: [join(root, 'node_modules', 'codex', 'cli.js'), 'exec', prompt],
  });
});

it('refuses unknown Windows command shims', () => {
  const root = mkdtempSync(join(tmpdir(), 'bizos-win-shim-'));
  roots.push(root);
  const shim = join(root, 'claude.cmd');
  writeFileSync(shim, '@ECHO off\necho unknown\n');
  expect(() => cliLaunch(shim, [], 'win32')).toThrow(/Unsupported Windows CLI shim/);
});

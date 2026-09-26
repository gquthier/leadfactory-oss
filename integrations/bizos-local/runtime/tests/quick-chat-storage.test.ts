import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/harness/storage.js';
import { ThreadStore } from '../src/harness/threads.js';
import { fixedClock } from '../src/harness/clock.js';

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'quick-purge-')); roots.push(root); return new Storage(root); };
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

describe('QuickChat owned preview cleanup', () => {
  it('deletes only unshared runtime previews, never business files or another transcript’s preview', () => {
    const storage = fixture();
    const previews = join(storage.layout.root, 'previews'); mkdirSync(previews);
    const privateImage = join(previews, `prv_${'a'.repeat(24)}.png`);
    const sharedImage = join(previews, `prv_${'b'.repeat(24)}.png`);
    const business = join(storage.workspacePath('shared'), `prv_${'c'.repeat(24)}.png`);
    [privateImage, sharedImage, business].forEach(path => writeFileSync(path, 'keep original unless exclusively disposable'));
    const expired = 'chat:qchat_abc'; const other = 'bot:keep';
    for (const path of [privateImage, sharedImage, business]) storage.appendNdjson(storage.threadPath(expired), { preview: { image: { path } } });
    storage.appendNdjson(storage.threadPath(other), { preview: { image: { path: sharedImage } } });
    const threads = new ThreadStore(storage, fixedClock(Date.now()));
    threads.clear({ chatId: 'qchat_abc' }, true);
    expect(existsSync(privateImage)).toBe(false);
    expect(existsSync(sharedImage)).toBe(true);
    expect(existsSync(business)).toBe(true);
    expect(existsSync(storage.threadPath(other))).toBe(true);
  });

  it('does not follow a symlinked preview directory into a workspace', () => {
    const storage = fixture();
    const business = storage.workspacePath('shared');
    const preview = `prv_${'d'.repeat(24)}.png`;
    writeFileSync(join(business, preview), 'business original');
    symlinkSync(business, join(storage.layout.root, 'previews'));
    storage.appendNdjson(storage.threadPath('chat:qchat_abc'), { preview: { image: { path: join(storage.layout.root, 'previews', preview) } } });
    new ThreadStore(storage, fixedClock(Date.now())).clear({ chatId: 'qchat_abc' }, true);
    expect(readFileSync(join(business, preview), 'utf8')).toBe('business original');
  });
});

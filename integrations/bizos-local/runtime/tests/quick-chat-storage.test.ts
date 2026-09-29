import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Storage } from '../src/harness/storage.js';
import { ThreadStore } from '../src/harness/threads.js';
import { fixedClock } from '../src/harness/clock.js';
import { QuickChatStore } from '../src/harness/quick-chats.js';

const roots: string[] = [];
const fixture = () => { const root = mkdtempSync(join(tmpdir(), 'quick-purge-')); roots.push(root); return new Storage(root); };
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });

describe('QuickChat owned preview cleanup', () => {
  it('keeps a reused blank chat bound to the same request id after it receives messages and restarts', () => {
    const storage = fixture();
    const clock = fixedClock(Date.now());
    const chats = new QuickChatStore(storage, clock);
    const blank = chats.create('ordinary blank');
    const comment = chats.create('comment:message-123');
    expect(comment.id).toBe(blank.id);
    chats.recordMessage({ id: 'message', threadId: `chat:${blank.id}`, seq: 1, role: 'user', createdAt: clock.nowIso(), blocks: [{ kind: 'text', text: 'A comment' }] });
    expect(chats.create('comment:message-123').id).toBe(blank.id);
    expect(new QuickChatStore(storage, clock).create('comment:message-123').id).toBe(blank.id);
  });
  it('keeps comments on different source messages in separate QuickChats', () => {
    const storage = fixture();
    const chats = new QuickChatStore(storage, fixedClock(Date.now()));
    const sourceA = { threadId: 'local:thread:a', messageId: 'local:message:a', excerpt: 'First' };
    const sourceB = { threadId: 'local:thread:a', messageId: 'local:message:b', excerpt: 'Second' };
    const first = chats.create('comment:source-a', sourceA);
    const second = chats.create('comment:source-b', sourceB);
    expect(second.id).not.toBe(first.id);
    expect(chats.create('comment:source-a', sourceA).id).toBe(first.id);
    expect(chats.create('another-request-same-source', sourceA).id).toBe(first.id);
    expect(new QuickChatStore(storage, fixedClock(Date.now())).create('comment:source-a', sourceA).id).toBe(first.id);
  });
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

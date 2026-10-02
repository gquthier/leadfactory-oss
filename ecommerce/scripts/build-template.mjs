// Rebuild the distributable vault from its editable Markdown sources.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'template.json');
const template = JSON.parse(readFileSync(target, 'utf8'));
const folders = [];
const notes = [];
function walk(prefix = '') {
  for (const entry of readdirSync(join(root, 'vault', prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink refused: ${path}`);
    if (entry.isDirectory()) { folders.push(path); walk(path); }
    else if (entry.isFile() && path.endsWith('.md')) notes.push({ path, text: readFileSync(join(root, 'vault', path), 'utf8') });
  }
}
walk();
template.folders = folders;
template.notes = notes;
writeFileSync(target, `${JSON.stringify(template, null, 2)}\n`);
console.log(`E-commerce: ${notes.length} notes, ${folders.length} folders, ${template.bots.length} roles.`);

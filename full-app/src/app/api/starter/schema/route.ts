import fs from 'node:fs/promises';import path from 'node:path';
export const runtime='nodejs';
export async function GET(){const files=['schema.sql'];const content=(await Promise.all(files.map(f=>fs.readFile(path.join(process.cwd(),'database',f),'utf8')))).join('\n\n');return new Response(content,{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="leadfactory-schema.sql"'}});}

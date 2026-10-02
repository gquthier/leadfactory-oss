import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const ts=(await import(process.env.TYPESCRIPT_MODULE?pathToFileURL(process.env.TYPESCRIPT_MODULE).href:'typescript')).default;
const root=process.argv[2];
if(!root)throw new Error('Pass the local source folder');
const schema=JSON.parse(await fs.readFile(new URL('./validation-report.json',import.meta.url),'utf8'));
const cols=new Map();for(const c of schema.columns){if(!cols.has(c.table_name))cols.set(c.table_name,new Set());cols.get(c.table_name).add(c.column_name);}
const checked=[],missing=[];
function tableOf(node){
 if(!node)return null;
 if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
  if(node.expression.name.text==='from'&&ts.isStringLiteral(node.arguments[0]))return node.arguments[0].text;
  return tableOf(node.expression.expression);
 }
 return null;
}
async function walk(dir){for(const item of await fs.readdir(dir,{withFileTypes:true})){
 const file=path.join(dir,item.name);if(item.isDirectory()){await walk(file);continue;}
 if(!/\.tsx?$/.test(file))continue;
 const src=ts.createSourceFile(file,await fs.readFile(file,'utf8'),ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&['insert','upsert','update'].includes(node.expression.name.text)){
   const table=tableOf(node.expression.expression), arg=node.arguments[0];
   const objects=arg&&ts.isObjectLiteralExpression(arg)?[arg]:arg&&ts.isArrayLiteralExpression(arg)?arg.elements.filter(ts.isObjectLiteralExpression):[];
   if(table)for(const object of objects)for(const prop of object.properties){
    const column=prop.name?.getText(src).replace(/^['"]|['"]$/g,'');if(!column)continue;
    const ref={table,column,source:path.relative(root,file)};checked.push(ref);if(!cols.get(table)?.has(column))missing.push(ref);
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(src);
}}
await walk(root);
const report={reviewedAt:'2026-10-01',checkedWriteProperties:checked.length,missingWriteProperties:missing,coverage:'TypeScript AST: literal object properties passed directly to .from(...).insert/update/upsert. Variable/spread payloads and runtime SQL excluded.'};
await fs.writeFile(new URL('./write-coverage.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

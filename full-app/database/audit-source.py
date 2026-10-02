#!/usr/bin/env python3
"""Check static table/column references. Does not execute application code."""
import argparse,json,re
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);a=p.parse_args()
root=Path(__file__).parent
cols={}
for c in json.loads((root/'validation-report.json').read_text())['columns']:cols.setdefault(c['table_name'],set()).add(c['column_name'])
refs=[];missing=[];tables=set();dynamic=0
for f in a.source.rglob('*'):
 if f.suffix not in ['.ts','.tsx']:continue
 text=f.read_text()
 for m in re.finditer(r'\.from\([\"\']([a-z_]+)[\"\']\)',text):
  table=m[1];tables.add(table);chunk=text[m.end():].split(';',1)[0].split('.from(',1)[0]
  used=set()
  for cm in re.finditer(r'\.(?:eq|neq|gte|gt|lte|lt|in|order|is)\([\"\']([a-z_]+)[\"\']',chunk):used.add(cm[1])
  sel=re.search(r'\.select\(\s*([\"\'])(.*?)\1',chunk,re.S)
  if sel:
   # Ignore nested joins, aliases and star; verify literal top-level columns.
   depth=0;buf='';parts=[]
   for char in sel[2]+',':
    if char=='(':depth+=1
    if char==')':depth-=1
    if char==',' and depth==0:parts.append(buf.strip());buf=''
    else:buf+=char
   used.update(v for v in parts if re.fullmatch(r'[a-z_]+',v))
  for column in used:
   refs.append({'table':table,'column':column,'source':str(f.relative_to(a.source))})
   if column not in cols.get(table,set()):missing.append(refs[-1])
report={'reviewedAt':'2026-10-01','literalTables':sorted(tables),'missingTables':sorted(tables-cols.keys()),'checkedColumnReferences':len(refs),'missingColumnReferences':missing,'coverage':'Literal .from table names, top-level string .select columns and basic filters/order in TS/TSX. Dynamic select strings, nested joins, object writes and runtime conditions require manual review; not complete static typing.'}
(root/'source-coverage.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))

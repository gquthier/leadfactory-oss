#!/usr/bin/env python3
"""Rebuild the reviewed, data-free historical DDL from a local migrations folder.
Does not connect to PostgreSQL. Output is supplemented by 002_source_alignment.sql.
"""
import argparse, json, re
from pathlib import Path


def statements(text):
    # SQL-aware statement splitter: quoted strings, dollar bodies and comments.
    out=[]; buf=[]; i=0; quote=None; dollar=None
    while i<len(text):
        if dollar:
            if text.startswith(dollar,i): buf.append(dollar);i+=len(dollar);dollar=None
            else: buf.append(text[i]);i+=1
        elif quote:
            c=text[i];buf.append(c);i+=1
            if c==quote:
                if i<len(text) and text[i]==quote:buf.append(text[i]);i+=1
                else:quote=None
        elif text.startswith('--',i):
            end=text.find('\n',i);i=len(text) if end<0 else end
        elif text.startswith('/*',i):
            end=text.find('*/',i+2)
            if end<0: raise ValueError('Unclosed comment')
            i=end+2
        elif text[i] in "'\"":quote=text[i];buf.append(text[i]);i+=1
        elif text[i]=='$' and (m:=re.match(r'\$[A-Za-z_0-9]*\$',text[i:])):
            dollar=m[0];buf.append(dollar);i+=len(dollar)
        elif text[i]==';':
            s=''.join(buf).strip();buf=[];i+=1
            if s:out.append(s+';')
        else:buf.append(text[i]);i+=1
    if ''.join(buf).strip():raise ValueError('Missing final semicolon')
    return out


def build(source,out):
    skipped=[]; groups=[]; tables=[]
    omit={'008_leads_deal_value.sql','009_leads_revenue_rename.sql','014_campaign_status_pipeline_alignment.sql','016_reconcile_leads_revenue.sql','019_fix_client_managed_by_backfill.sql','024_backfill_leads_crm_defaults.sql'}
    for f in sorted(source.glob('*.sql')):
        if f.name in omit:skipped.append({'source':f.name,'reason':'legacy migration/backfill replaced by final empty schema'});continue
        kept=[]
        for s in statements(f.read_text()):
            upper=s.upper()
            if re.match(r'^(INSERT|UPDATE|DELETE|SELECT|CREATE EXTENSION|CREATE POLICY|DROP POLICY)\b',upper):
                skipped.append({'source':f.name,'kind':upper.split()[0],'reason':'no data, extension unnecessary, policies replaced separately'});continue
            # Policy-only historical DO blocks; constraint-only blocks retained.
            if upper.startswith('DO ') and 'CREATE POLICY' in upper:continue
            if 'CREATE TYPE campaign_status AS ENUM' in s:
                s="CREATE TYPE campaign_status AS ENUM ('brief_received','campaign_proposal','ad_creative','meta_account_setup','live_optimizing','reworks','paused','completed_project','onboarding','setup','creative_review','live','optimizing','completed');"
            if f.name=='001_initial_schema.sql': s=s.replace("DEFAULT 'onboarding'","DEFAULT 'brief_received'")
            if 'seed_client_credits_on_new_profile' in s and upper.startswith('CREATE OR REPLACE FUNCTION'):
                s="""CREATE OR REPLACE FUNCTION seed_client_credits_on_new_profile() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.client_credits (client_id, balance, total_granted) VALUES (NEW.id, 0, 0) ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;"""
            if 'fn_notify_new_lead() RETURNS TRIGGER' in s:
                s=s.replace("  src :=", "  IF NEW.client_id IS NULL THEN RETURN NEW; END IF;\n  src :=")
                s=s.replace('LANGUAGE plpgsql SECURITY DEFINER;', 'LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;')
            if 'SECURITY DEFINER;' in s:s=s.replace('SECURITY DEFINER;','SECURITY DEFINER SET search_path = public;')
            match=re.match(r'CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)\s*\(',s,re.I)
            if match: tables.append(match[1])
            kept.append(s)
        if kept:groups.append('-- Source structure: '+f.name+'\n\n'+'\n\n'.join(kept))
    header='''-- LeadFactory / empty bootstrap, reviewed 2026-10-01.
-- Requires a NEW Supabase project (auth.users/auth.uid and service_role exist).
-- No business rows, user identities, credentials or historical backfills.
-- NOT an upgrade migration. Apply 001, 002, 003 in order before exposing the app.
BEGIN;
SET LOCAL search_path = public;
'''
    tail='\nALTER TABLE leads ADD COLUMN IF NOT EXISTS revenue NUMERIC(10,2);\nCOMMIT;\n'
    (out/'001_schema.sql').write_text(header+'\n\n'.join(groups)+tail)
    (out/'source-map.json').write_text(json.dumps({'reviewedAt':'2026-10-01','sourceCommit':'e909784','sourceMigrationCount':len(list(source.glob('*.sql'))),'historicalTables':tables,'excludedStatements':skipped},indent=2)+'\n')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('migrations',type=Path);a=p.parse_args();build(a.migrations,Path(__file__).parent)

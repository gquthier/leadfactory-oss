"""Offline behavioral checks; synthetic data only, no messages or paid API calls."""
import importlib.util
from importlib.machinery import SourceFileLoader
import subprocess
import sys
import json
from pathlib import Path
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1] / 'skills'

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path, loader=SourceFileLoader(name, str(path)))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

p = load('prospects', BASE / 'agency-prospect-research/references/prospects.py.txt')
t = load('tracking', BASE / 'outbound-campaign-ops/references/tracking.py.txt')

class PipelineTest(unittest.TestCase):
    def test_extract_visible_and_mailto_dedup(self):
        content = '<p>ACHATS@entreprise.example.invalid</p><a href="mailto:achats@entreprise.example.invalid?subject=test">Contact</a>'
        self.assertEqual(p.extract(content), ['achats@entreprise.example.invalid'])

    def test_reject_script_placeholders_and_noreply(self):
        content = '<script>admin@invisible.example.invalid</script><p>noreply@entreprise.example.invalid hello@example.com</p>'
        self.assertEqual(p.extract(content), [])

    def valid(self):
        return dict(email='achats@entreprise.example.invalid',status='valid',regexp=True,mx_records=True,
                    smtp_server=True,smtp_check=True,accept_all=False,disposable=False,block=False)

    def test_provider_valid_requires_actual_checks(self):
        data = self.valid()
        self.assertEqual(p.classify(data,data['email']), 'verified')
        data.pop('smtp_check')
        self.assertEqual(p.classify(data,data['email']), 'unknown')

    def test_catch_all_cannot_be_promoted(self):
        data = self.valid()
        data['accept_all'] = True
        self.assertEqual(p.classify(data,data['email']), 'unknown')

    def test_mismatch_cannot_verify_another_address(self):
        data = self.valid()
        self.assertEqual(p.classify(data,'autre@entreprise.example.invalid'), 'unknown')

    def test_webmail_and_pending_are_not_verified(self):
        for status in ('pending','unknown','webmail','invalid','accept_all','disposable'):
            data = dict(self.valid(),status=status)
            self.assertEqual(p.classify(data,data['email']),status)

    def event(self, id='1', type='accepted', campaign='pilot'):
        return dict(provider='fixture',event_id=id,campaign_id=campaign,account_id='test-account',
                    email='ACHATS@entreprise.example.invalid',event_type=type,occurred_at='2026-09-21T08:00:00Z',evidence='fixture://'+id)

    def test_events_are_idempotent(self):
        with tempfile.TemporaryDirectory() as d:
            db=t.connect(str(Path(d)/'t.sqlite'))
            e=self.event()
            self.assertEqual(t.ingest(db,[e,e]),1)
            self.assertEqual(t.ingest(db,[e]),0)
            self.assertEqual(t.report(db)['campaigns']['pilot']['contacted_accounts'],1)
            db.close()

    def test_reply_and_late_delivery_cannot_clear_stop(self):
        with tempfile.TemporaryDirectory() as d:
            db=t.connect(str(Path(d)/'t.sqlite'))
            t.ingest(db,[self.event(),self.event('2','replied'),self.event('3','delivered')])
            report=t.report(db)
            self.assertEqual(report['stopped_campaign_contacts'],1)
            self.assertEqual(report['campaigns']['pilot']['reply_rate_on_contacted'],1)
            db.close()

    def test_suppression_is_global_and_survives_other_campaign(self):
        with tempfile.TemporaryDirectory() as d:
            db=t.connect(str(Path(d)/'t.sqlite'))
            t.ingest(db,[self.event('1','opt_out'),self.event('2','accepted','other')])
            self.assertEqual(db.execute('SELECT email FROM suppressed').fetchone()[0],'achats@entreprise.example.invalid')
            self.assertEqual(t.report(db)['global_suppressions'],1)
            db.close()

    def test_invalid_batch_rolls_back(self):
        with tempfile.TemporaryDirectory() as d:
            db=t.connect(str(Path(d)/'t.sqlite'))
            bad=self.event('2'); bad.pop('evidence')
            with self.assertRaises(ValueError): t.ingest(db,[self.event(),bad])
            self.assertEqual(db.execute('SELECT count(*) FROM events').fetchone()[0],0)
            db.close()

    def test_conflicting_event_id_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            db=t.connect(str(Path(d)/'t.sqlite'))
            t.ingest(db,[self.event()])
            with self.assertRaises(ValueError): t.ingest(db,[self.event(type='opt_out')])
            self.assertEqual(t.report(db)['global_suppressions'],0)
            db.close()

    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/'input.json';src.write_text('[]')
            dst=Path(d)/'output.json';dst.write_text('original')
            run=subprocess.run([sys.executable,p.__file__,'collect','--input',str(src),'--output',str(dst)],capture_output=True,text=True)
            self.assertEqual(run.returncode,2)
            self.assertIn('Output exists',run.stderr)
            self.assertEqual(dst.read_text(),'original')

    def test_verification_default_is_dryrun(self):
        with tempfile.TemporaryDirectory() as d:
            src=Path(d)/'input.json';src.write_text(json.dumps({'contacts':[{'email':'achats@entreprise.example.invalid'}]}))
            dst=Path(d)/'output.json'
            run=subprocess.run([sys.executable,p.__file__,'verify','--input',str(src),'--output',str(dst)],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertFalse(dst.exists())
            self.assertIn('dry_run',run.stdout)

    def test_client_databases_are_isolated(self):
        with tempfile.TemporaryDirectory() as d:
            a=t.connect(str(Path(d)/'a.sqlite'));b=t.connect(str(Path(d)/'b.sqlite'))
            t.ingest(a,[self.event('1','opt_out')])
            self.assertEqual(t.report(a)['global_suppressions'],1)
            self.assertEqual(t.report(b)['global_suppressions'],0)
            a.close();b.close()

if __name__ == '__main__':
    unittest.main()

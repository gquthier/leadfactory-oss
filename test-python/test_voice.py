import base64
import importlib.util
from importlib.machinery import SourceFileLoader
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
FILE=Path(__file__).resolve().parents[1]/'skills/agency-meta-motion-ad/references/elevenlabs_voice.py.txt'
spec=importlib.util.spec_from_loader('voice',SourceFileLoader('voice',str(FILE)));v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
class VoiceTest(unittest.TestCase):
 def data(self):return {'audio_base64':base64.b64encode(b'ID3synthetic').decode(),'alignment':{'characters':list('Hi all'),'character_start_times_seconds':[0,.1,.2,.3,.4,.5],'character_end_times_seconds':[.1,.2,.3,.4,.5,.6]}}
 def test_words_use_actual_character_alignment(self):
  audio,alignment,words=v.decode_response(self.data());self.assertEqual(audio,b'ID3synthetic');self.assertEqual(words,[{'text':'Hi','start':0,'end':.2},{'text':'all','start':.3,'end':.6}])
 def test_bad_alignment_and_audio_refused(self):
  d=self.data();d['alignment']['character_start_times_seconds'][2]=-.1
  with self.assertRaises(ValueError):v.decode_response(d)
  d=self.data();d['audio_base64']='!'
  with self.assertRaises(ValueError):v.decode_response(d)
 def test_dryrun_needs_no_key_and_output_cannot_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   src=Path(d)/'script.txt';src.write_text('Bonjour.');dst=Path(d)/'voice'
   cmd=[sys.executable,str(FILE),'--text',str(src),'--voice-id','authorized','--model-id','chosen','--output',str(dst)]
   r=subprocess.run(cmd,capture_output=True,text=True);self.assertEqual(r.returncode,0,r.stderr);self.assertIn('"requests": 0',r.stdout);self.assertFalse(dst.exists())
   dst.mkdir();(dst/'keep').write_text('original');r=subprocess.run(cmd,capture_output=True,text=True);self.assertEqual(r.returncode,2);self.assertEqual((dst/'keep').read_text(),'original')
if __name__=='__main__':unittest.main()

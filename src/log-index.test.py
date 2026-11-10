import hashlib
import importlib.util
import json
import tempfile
import unittest
import uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('log_index',Path(__file__).with_name('log-index.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class IndexTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.database=self.root/'index.sqlite'
        self.producer=str(uuid.uuid4())

    def event(self,sequence=1,**extra):
        return dict(schemaVersion=1,eventId=str(uuid.uuid4()),producerId=self.producer,producerSeq=sequence,eventType='worker.completed',severity='info',observedAt='2026-11-04T12:00:00.000Z',elapsedMs=50,provenance='runner_observed',taskId='sample-task',provider='codex',details={'status':'completed','inputTokens':100},**extra)

    def source(self,name,content):
        file=self.root/name
        file.write_bytes(content)
        entry={'path':str(file),'sha256':hashlib.sha256(content).hexdigest()}
        if content.endswith(b'\n'):
            try:
                events=[json.loads(line) for line in content.splitlines()]
                seal={'schemaVersion':1,'producerId':events[0]['producerId'],'written':len(events),'dropped':0,'coverageComplete':True}
                seal_bytes=json.dumps(seal).encode()
                seal_path=Path(str(file)+'.closed')
                seal_path.write_bytes(seal_bytes)
                entry['seal']={'path':str(seal_path),'sha256':hashlib.sha256(seal_bytes).hexdigest()}
            except (ValueError,KeyError,IndexError):
                pass
        return entry

    def build(self,entries):
        manifest=self.root/'selected.json'
        manifest.write_text(json.dumps({'schemaVersion':1,'files':entries}),encoding='utf8')
        return module.build(manifest,self.database)

    def test_build_search_rebuild_and_privacy(self):
        event=self.event()
        event['prompt']='SECRET RAW TEXT'
        event['details']['raw']='sk-SECRET'
        source=self.source('a.jsonl',(json.dumps(event)+'\n').encode())
        report=self.build([source])
        self.assertTrue(report['coverageComplete'])
        result=module.search(self.database,'completed',task_id='sample-task')
        self.assertEqual(len(result['events']),1)
        self.assertNotIn('SECRET',json.dumps(result))
        self.assertIsNone(report['providerCalls'])
        self.database.unlink()
        self.assertEqual(self.build([source])['indexedEvents'],1)

    def test_injection_is_literal_and_database_survives(self):
        self.build([self.source('a.jsonl',(json.dumps(self.event())+'\n').encode())])
        self.assertEqual(module.search(self.database,"' OR 1=1; DROP TABLE events;--")['events'],[])
        self.assertEqual(module.search(self.database,provider="codex' OR 1=1 --")['events'],[])
        self.assertEqual(len(module.search(self.database)['events']),1)

    def test_partial_tail_preserves_complete_prefix(self):
        report=self.build([self.source('a.jsonl',(json.dumps(self.event())+'\n{"broken":').encode())])
        self.assertFalse(report['coverageComplete'])
        self.assertEqual(report['indexedEvents'],1)
        self.assertTrue(report['sources'][0]['partialTail'])

    def test_unsealed_journal_is_searchable_but_not_complete(self):
        source=self.source('a.jsonl',(json.dumps(self.event())+'\n').encode())
        source.pop('seal')
        report=self.build([source])
        self.assertFalse(report['coverageComplete'])
        self.assertEqual(report['sources'][0]['status'],'unsealed')
        self.assertEqual(report['indexedEvents'],1)

    def test_changed_seal_does_not_claim_complete_coverage(self):
        source=self.source('a.jsonl',(json.dumps(self.event())+'\n').encode())
        Path(source['seal']['path']).write_text('{}')
        report=self.build([source])
        self.assertFalse(report['coverageComplete'])
        self.assertEqual(report['sources'][0]['status'],'seal-conflict')

    def test_mid_file_corruption_rejects_whole_source(self):
        content=(json.dumps(self.event())+'\nBROKEN\n'+json.dumps(self.event(2))+'\n').encode()
        report=self.build([self.source('a.jsonl',content)])
        self.assertEqual(report['indexedEvents'],0)
        self.assertEqual(report['sources'][0]['status'],'malformed-or-unreadable')

    def test_conflicting_duplicate_event_is_excluded(self):
        event=self.event()
        changed={**event,'elapsedMs':90}
        a=self.source('a.jsonl',(json.dumps(event)+'\n').encode())
        b=self.source('b.jsonl',(json.dumps(changed)+'\n').encode())
        report=self.build([a,b])
        self.assertEqual(report['conflictingEvents'],1)
        self.assertEqual(report['indexedEvents'],0)

    def test_equal_duplicate_does_not_double_count(self):
        content=(json.dumps(self.event())+'\n').encode()
        report=self.build([self.source('a.jsonl',content),self.source('b.jsonl',content)])
        self.assertEqual(report['indexedEvents'],1)
        self.assertEqual(report['duplicateEvents'],1)

    def test_cross_source_sequence_collision_is_excluded(self):
        a=self.source('a.jsonl',(json.dumps(self.event())+'\n').encode())
        b=self.source('b.jsonl',(json.dumps(self.event())+'\n').encode())
        report=self.build([a,b])
        self.assertEqual(report['sequenceConflicts'],1)
        self.assertEqual(report['indexedEvents'],0)

    def test_hash_conflict_missing_source_sequence_gap(self):
        changed=self.source('changed.jsonl',b'')
        Path(changed['path']).write_bytes(b'changed')
        missing={'path':str(self.root/'missing.jsonl'),'sha256':'0'*64}
        gap=self.source('gap.jsonl',(json.dumps(self.event(3))+'\n').encode())
        report=self.build([changed,missing,gap])
        self.assertEqual([item['status'] for item in report['sources']],['hash-conflict','missing','partial'])
        self.assertEqual(report['indexedEvents'],1)

    def test_unrelated_database_is_not_overwritten(self):
        self.database.write_text('private unrelated file',encoding='utf8')
        with self.assertRaises(Exception):
            self.build([self.source('a.jsonl',b'')])
        self.assertEqual(self.database.read_text(),'private unrelated file')

    def test_source_database_collision_is_rejected(self):
        source=self.source('index.sqlite',b'')
        with self.assertRaises(ValueError):
            self.build([source])

    def test_bounds_and_duplicate_selection(self):
        entry=self.source('a.jsonl',(json.dumps(self.event())+'\n').encode())
        with self.assertRaises(ValueError):
            self.build([entry,entry])
        self.build([entry])
        with self.assertRaises(ValueError):
            module.search(self.database,limit=1000)


if __name__=='__main__':
    unittest.main()

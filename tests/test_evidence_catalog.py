"""Defensive tests for curated, read-only visual QA evidence."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'vps/evidence_catalog.py'
spec = importlib.util.spec_from_file_location('evidence_catalog', SOURCE)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class EvidenceCatalogTests(unittest.TestCase):
    def test_only_qa_directories_and_png_files_are_exposed(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            project = base / 'projects' / 'ronda-pro' / 'session1'
            proof = project / 'artifacts' / 'ui-test'
            proof.mkdir(parents=True)
            (proof / 'real.png').write_bytes(b'\x89PNG\r\n\x1a\nreal-test-pixels')
            (project / 'private-document.png').write_bytes(b'\x89PNG\r\n\x1a\nprivate')
            (proof / 'not-an-image.png').write_bytes(b'spoof')
            with patch.object(catalog,'PROJECTS',base/'projects'),patch.object(catalog,'WORKSPACE',base/'missing'),patch.object(catalog,'IMPORTS',base/'missing'):
                items=catalog.list_evidence()['items']
                self.assertEqual(len(items),1)
                self.assertEqual(items[0]['file'],'real.png')
                self.assertNotIn('_path',items[0])
                raw=catalog.read_evidence(items[0]['id'])
                self.assertEqual(raw['mime'],'image/png')
                with self.assertRaises(ValueError):
                    catalog.read_evidence('../../etc/passwd')
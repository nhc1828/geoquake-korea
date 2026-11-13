import unittest
from datetime import datetime, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fetch_earthquakes as f


class TestNormalizers(unittest.TestCase):
    def test_jma_decimal_coords(self):
        self.assertEqual(f.jma_coordinate('+36.7+140.7-10000/'), (36.7, 140.7, 10.0))

    def test_jma_degrees_minutes_coords(self):
        lat, lon, dep = f.jma_coordinate('+3606.2+13959.5-48000/')
        self.assertAlmostEqual(lat, 36.10333, places=4)
        self.assertAlmostEqual(lon, 139.99167, places=4)
        self.assertEqual(dep, 48.0)

    def test_invalid_coords(self):
        self.assertEqual(f.jma_coordinate('invalid'), (None, None, None))

    def test_missing_mag_not_zero(self):
        self.assertIsNone(f.number(''))
        self.assertIsNone(f.number(None))
        self.assertEqual(f.number(0), 0)

    def test_kma_time_kst_to_utc(self):
        self.assertEqual(f.iso(f.parse_time('20261113090000')), '2026-11-13T00:00:00Z')

    def test_kma_numeric_time(self):
        self.assertEqual(f.iso(f.parse_time(20261113090000)), '2026-11-13T00:00:00Z')

    def test_usgs_time_ms(self):
        self.assertEqual(f.iso(f.parse_time(1609459200000)), '2021-01-01T00:00:00Z')

    def test_kma_normal(self):
        payload = {'response': {'header': {'resultCode': '00'}, 'body': {'items': {'item': [
            {'tmEqk':'20261113090100','tmFc':'20261113090500','tmSeq':'1',
             'loc':'경북 동쪽 해역','lat':'36.1','lon':'129.5','mt':'3.4', 'dep':'12','inT':'III'}
        ]}}}}
        e = f.parse_kma(payload)[0]
        self.assertEqual(e['source'], 'KMA')
        self.assertEqual(e['occurredAt'], '2026-11-13T00:01:00Z')
        self.assertEqual(e['magnitude'], 3.4)
        self.assertEqual(e['depthKm'], 12)

    def test_kma_no_events(self):
        self.assertEqual(f.parse_kma({'response': {'header': {'resultCode': '00'}, 'body': {'items': {}}}}), [])

    def test_kma_error_is_not_empty(self):
        with self.assertRaises(ValueError):
            f.parse_kma({'response': {'header': {'resultCode': '30'}, 'body': {'items': {}}}})

    def test_jma_dedupe_and_jma_scale(self):
        payload = [
            {'eid':'abc','at':'2026-11-13T09:00:00+09:00','rdt':'2026-11-13T09:02:00+09:00',
             'anm':'福岡県','cod':'+33.6+130.4-10000/','mag':'4.2','maxi':'5-','ttl':'震源・震度情報'},
            {'eid':'abc','at':'2026-11-13T09:00:00+09:00','rdt':'2026-11-13T09:01:00+09:00',
             'anm':'福岡県','cod':'','mag':'','maxi':''}
        ]
        e = f.parse_jma(payload)
        self.assertEqual(len(e), 1)
        self.assertEqual(e[0]['maxIntensity'], '5약')
        self.assertEqual(e[0]['magnitude'], 4.2)

    def test_usgs_geojson(self):
        payload = {'features': [{'type': 'Feature', 'id': 'test123',
                 'properties': {'type':'earthquake','mag':5.1,'time':1609459200000,
                                'updated':1609459260000, 'place':'Example',
                                'url':'https://earthquake.usgs.gov/earthquakes/eventpage/test123'},
                 'geometry':{'type':'Point','coordinates':[130.5,35.5,20]}}]}
        e = f.parse_usgs(payload)[0]
        self.assertEqual(e['id'], 'USGS:test123')
        self.assertEqual((e['latitude'], e['longitude']), (35.5, 130.5))
        self.assertIsNone(e['maxIntensity'])

    def test_source_failure_not_zero_earthquakes(self):
        def fail():
            raise RuntimeError('HTTP 403')
        now = datetime(2026, 11, 13, tzinfo=timezone.utc)
        result = f.build_snapshot(now, {
            'KMA': lambda: [], 'JMA': fail, 'USGS': lambda: []}, kma_key='dummy')
        self.assertEqual(result['sources']['JMA']['state'], 'error')
        self.assertEqual(result['sources']['KMA']['state'], 'ok')
        self.assertEqual(result['events'], [])

    def test_unconfigured_kma(self):
        now = datetime(2026, 11, 13, tzinfo=timezone.utc)
        s = f.build_snapshot(now, {
            'KMA': lambda: [], 'JMA': lambda: [], 'USGS': lambda: []}, kma_key='')
        self.assertEqual(s['sources']['KMA']['state'], 'unconfigured')

    def test_same_id_unique(self):
        now = datetime(2026, 11, 13, 1, 0, tzinfo=timezone.utc)
        e = f.event(id='USGS:a', source='USGS', agency_id='a', occurred='2026-11-13T00:00:00Z',
                    url='https://earthquake.usgs.gov/')
        self.assertEqual(len(f.validate_events([e, e], now)), 1)


if __name__ == '__main__':
    unittest.main()

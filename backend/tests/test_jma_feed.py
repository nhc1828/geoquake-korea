import asyncio
import json
import unittest
from datetime import datetime, timezone, timedelta

import main
from jma_feed import PREFECTURES, jma_scale, parse_jma_551, prefecture_id, jst_to_utc


def stamp(dt):
    return dt.astimezone(timezone(timedelta(hours=9))).strftime('%Y/%m/%d %H:%M:%S')


def sample(mid='jma-test-1'):
    current = datetime.now(timezone.utc) - timedelta(minutes=3)
    return {
        'id': mid, 'code': 551, 'time': stamp(current+timedelta(seconds=90)),
        'issue': {'source':'気象庁', 'time': stamp(current+timedelta(seconds=40)),
                  'type':'DetailScale', 'correct':'None'},
        'earthquake': {'time': stamp(current), 'maxScale': 50,
                       'hypocenter': {'name':'福岡県西方沖', 'latitude': 33.6,
                                      'longitude':130.2,'depth':12, 'magnitude': 5.4}},
        'points': [
            {'pref':'福岡県', 'addr':'福岡市中央区', 'isArea':False, 'scale':45},
            {'pref':'福岡県', 'addr':'福岡市博多区', 'isArea':False, 'scale':50},
            {'pref':'佐賀県', 'addr':'佐賀市', 'isArea':False, 'scale':40},
            {'pref':'長崎県', 'addr':'長崎地方', 'isArea':True, 'scale':45},
            {'pref':'熊本県', 'addr':'熊本市(未確定)', 'isArea':False, 'scale':46},
        ],
        'comments':{'freeFormComment':''},
    }


class ParserTests(unittest.TestCase):
    def test_47_prefectures(self):
        self.assertEqual(len(PREFECTURES), 47)
        self.assertEqual(len({prefecture_id(x) for x in PREFECTURES}), 47)
        self.assertEqual(prefecture_id('北海道道東'), 'JP-01')
        self.assertEqual(prefecture_id('東京都'), 'JP-13')
        self.assertEqual(prefecture_id('福岡県'), 'JP-40')
        self.assertEqual(prefecture_id('沖縄県'), 'JP-47')
        self.assertIsNone(prefecture_id('부산'))

    def test_all_jma_scale_values(self):
        self.assertEqual([jma_scale(k) for k in (10,20,30,40,45,50,55,60,70)],
                         ['1','2','3','4','5약','5강','6약','6강','7'])
        for bad in (-1,0,46,99,None,True,'?',45.5):
            self.assertIsNone(jma_scale(bad))

    def test_jst_is_utc(self):
        self.assertEqual(jst_to_utc('2026/11/14 21:05:00'), '2026-11-14T12:05:00.000Z')
        self.assertEqual(jst_to_utc('2026/11/14 21:05:00.249'), '2026-11-14T12:05:00.249Z')
        self.assertIsNone(jst_to_utc('not-a-date'))

    def test_real_stations_max_per_prefecture(self):
        e = parse_jma_551(sample())
        self.assertEqual(e['source'], 'JMA')
        self.assertEqual(e['id'], 'JMA:jma-test-1')
        self.assertEqual(e['maxIntensity'], '5강')
        self.assertEqual(e['observedRegions']['JP-40']['value'], '5강')
        self.assertEqual(e['observedRegions']['JP-40']['stationCount'], 2)
        self.assertEqual(e['observedRegions']['JP-41']['value'], '4')
        self.assertNotIn('JP-42', e['observedRegions'])  # area bulletin is NOT point observation
        self.assertEqual(e['reportedAreas']['JP-42']['value'], '5약')
        self.assertNotIn('JP-43', e['observedRegions'])  # uncertainty 46 is not exact 5-lower
        self.assertIn('JP-43', e['uncertainRegions'])
        self.assertEqual(e['observedStationCount'], 3)
        self.assertTrue(e['observationsVerified'])

    def test_scale_prompt_only_has_no_verified_stations(self):
        s = sample()
        s['earthquake']['hypocenter']={'latitude':-200,'longitude':-200,'depth':-1,'magnitude':-1}
        s['points']=[{'pref':'東京都','addr':'23区','scale':30,'isArea':True}]
        e = parse_jma_551(s)
        self.assertIsNone(e['latitude'])
        self.assertIsNone(e['longitude'])
        self.assertIsNone(e['depthKm'])
        self.assertIsNone(e['magnitude'])
        self.assertFalse(e['observationsVerified'])
        self.assertEqual(e['reportedAreas']['JP-13']['value'], '3')

    def test_556_and_bad_inputs_are_not_551(self):
        x=sample();x['code']=556
        self.assertIsNone(parse_jma_551(x))
        self.assertIsNone(parse_jma_551({}))
        x=sample();x['earthquake']['time']='bad'
        self.assertIsNone(parse_jma_551(x))

    def test_malformed_points_treated_as_unavailable(self):
        s=sample();s['points']={'unexpected':'object'}
        e=parse_jma_551(s)
        self.assertFalse(e['observationsVerified'])
        self.assertEqual(e['observedRegions'],{})

    def test_history_marker(self):
        self.assertEqual(parse_jma_551(sample(), ingest_mode='history')['ingestMode'],'history')
        self.assertEqual(parse_jma_551(sample(), ingest_mode='stream')['ingestMode'],'stream')


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        main.snapshot=main.make_snapshot()
        main.usgs_records=[]
        main.jma_records.clear()

    def test_ingest_duplicate_and_source_health(self):
        async def job():
            self.assertTrue(await main.ingest_jma_551(sample(), mode='stream'))
            self.assertFalse(await main.ingest_jma_551(sample(), mode='stream'))
            self.assertEqual(len(main.snapshot['events']),1)
            self.assertEqual(main.snapshot['events'][0]['id'],'JMA:jma-test-1')
            self.assertEqual(main.snapshot['sources']['JMA']['count'],1)
            self.assertIsNotNone(main.snapshot['sources']['JMA']['lastMessageAt'])
        asyncio.run(job())

    def test_usgs_merge_does_not_erase_jma(self):
        class FakeResponse:
            content=b'{}'
            def raise_for_status(self): pass
            def json(self):
                t=int((datetime.now(timezone.utc)-timedelta(minutes=1)).timestamp()*1000)
                return {'type':'FeatureCollection', 'features':[{'id':'usgs-test',
                    'properties':{'type':'earthquake','time':t,'mag':4.8,'place':'test'},
                    'geometry':{'coordinates':[135.3,36.2,10]}}]}
        class FakeClient:
            async def get(self,url): return FakeResponse()
        async def job():
            await main.ingest_jma_551(sample(),mode='stream')
            await main.collect_once(FakeClient())
            self.assertEqual({e['source'] for e in main.snapshot['events']},{'USGS','JMA'})
            self.assertEqual(main.snapshot['sources']['JMA']['count'],1)
            self.assertEqual(main.snapshot['sources']['USGS']['count'],1)
        asyncio.run(job())

    def test_seed_history_dedup_and_no_stream_flag(self):
        s1=sample('a');s2=sample('b')
        class HistoryResponse:
            content=b'[]'
            def raise_for_status(self): pass
            def json(self): return [s1,s2,s1]
        class FakeClient:
            async def get(self, url, params):
                self.test_case.assertEqual(params, {'codes':'551','limit':100})
                return HistoryResponse()
        fc=FakeClient();fc.test_case=self
        async def job():
            added=await main.seed_jma_history(fc)
            self.assertEqual(added,2)
            self.assertEqual(len(main.jma_records),2)
            self.assertTrue(all(e['ingestMode']=='history' for e in main.jma_records.values()))
            self.assertFalse(await main.ingest_jma_551(s1,mode='stream'))
        asyncio.run(job())

    def test_jma_rejected_future_and_old_data(self):
        s=sample('old')
        for k in ['time']:
            s[k]='2015/01/01 12:00:00'
        s['issue']['time']=s['time'];s['earthquake']['time']=s['time']
        self.assertFalse(asyncio.run(main.ingest_jma_551(s)))

    def test_local_websocket_snapshot_without_upstream(self):
        from fastapi.testclient import TestClient
        from unittest.mock import patch
        with patch.dict('os.environ', {'GEOQUAKE_DISABLE_POLL':'1', 'GEOQUAKE_DISABLE_JMA':'1'}):
            with TestClient(main.app) as client:
                response=client.get('/health')
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()['jmaConnected'])
                with client.websocket_connect('/ws', headers={'origin':'https://nhc1828.github.io'}) as socket:
                    data=socket.receive_json()
                    self.assertEqual(data['type'],'snapshot')
                    self.assertIn('JMA',data['data']['sources'])

    def test_health_endpoint(self):
        data=asyncio.run(main.health())
        self.assertEqual(data['service'],'ok')
        self.assertIn('jmaConnected',data)
        self.assertFalse(data['jmaConnected'])


if __name__ == '__main__':
    unittest.main()

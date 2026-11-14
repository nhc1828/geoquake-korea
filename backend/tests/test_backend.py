import unittest
from main import parse_usgs, num, from_ms, make_snapshot

class Tests(unittest.TestCase):
    def sample(self):
        return {'type':'FeatureCollection','features':[{'id':'test123','properties':{'type':'earthquake','mag':4.1,'place':'test','time':1780000000000,'updated':1780000001000,'url':'https://earthquake.usgs.gov/earthquakes/map/'},'geometry':{'coordinates':[129.1,35.2,14]}}]}
    def test_schema(self):
        self.assertEqual(parse_usgs(self.sample())[0]['source'],'USGS')
    def test_mag(self):
        self.assertEqual(parse_usgs(self.sample())[0]['magnitude'],4.1)
    def test_null_not_zero(self):
        x=self.sample();x['features'][0]['properties']['mag']=None
        self.assertIsNone(parse_usgs(x)[0]['magnitude'])
    def test_bad_location(self):
        x=self.sample();x['features'][0]['geometry']['coordinates']=[999,35.2,14]
        with self.assertRaises(ValueError):parse_usgs(x)
    def test_discard_non_quake(self):
        x=self.sample();x['features'].append({'id':'a','properties':{'type':'quarry blast'},'geometry':{'coordinates':[126,35,1]}})
        self.assertEqual(len(parse_usgs(x)),1)
    def test_timestamp(self):self.assertTrue(from_ms(1780000000000).endswith('Z'))
    def test_nan(self):self.assertIsNone(num(float('nan')))
    def test_bad_feed(self):
        with self.assertRaises(ValueError):parse_usgs({'features':[]})
    def test_kma_unconfigured_jma_pending(self):
        self.assertEqual(make_snapshot()['sources']['KMA']['state'],'unconfigured')
        self.assertEqual(make_snapshot()['sources']['JMA']['state'],'pending')
if __name__=='__main__': unittest.main()

class HistoryParamsTests(unittest.TestCase):
    def test_normal_date_span(self):
        from datetime import date
        from main import history_params
        data=history_params(date(2016,9,10),date(2016,9,12),4.0,100)
        self.assertEqual(data['starttime'],'2016-09-10')
        self.assertEqual(data['endtime'],'2016-09-13')
        self.assertEqual(data['limit'],'100')

    def test_reversed_dates_fail(self):
        from datetime import date
        from main import history_params
        with self.assertRaises(ValueError):
            history_params(date(2020,1,2),date(2020,1,1),4.0,100)

    def test_overlong_span_fails(self):
        from datetime import date
        from main import history_params
        with self.assertRaises(ValueError):
            history_params(date(2016,1,1),date(2016,2,5),4.0,100)

    def test_minimum_magnitude_and_count(self):
        from datetime import date
        from main import history_params
        with self.assertRaises(ValueError):
            history_params(date(2016,1,1),date(2016,1,3),1.0,100)
        with self.assertRaises(ValueError):
            history_params(date(2016,1,1),date(2016,1,3),4.0,200)

class ArchiveEndpointTests(unittest.TestCase):
    def test_history_success_and_cache(self):
        import asyncio, json
        from datetime import date
        from unittest.mock import patch
        import main
        main.HISTORY_CACHE.clear()
        data = {'type':'FeatureCollection','features':[
            {'type':'Feature','id':'testinghistory', 'properties':{'type':'earthquake','time':1473694374000,'mag':5.5,'place':'Korea old quake','url':'https://earthquake.usgs.gov/x'},'geometry':{'coordinates':[129.2,35.8,10.0]}}
        ],'metadata':{'count':1}}
        class FakeResponse:
            status_code=200
            def __init__(self): self.content=json.dumps(data).encode()
            def raise_for_status(self): return None
            def json(self): return data
        class FakeHTTP:
            async def __aenter__(self):return self
            async def __aexit__(self,*args):return False
            async def get(self,url,params=None):
                self.last_url=url
                return FakeResponse()
        with patch.object(main.httpx,'AsyncClient',return_value=FakeHTTP()):
            result=asyncio.run(main.historical_events(start=date(2016,9,10),end=date(2016,9,13),minmag=4.0,limit=50))
            payload=json.loads(result.body)
            self.assertEqual(payload['source'],'USGS')
            self.assertEqual(len(payload['events']),1)
            self.assertEqual(payload['events'][0]['id'],'USGS:testinghistory')
            self.assertEqual(payload['events'][0]['depthKm'],10.0)
            self.assertEqual(payload['events'][0]['magnitude'],5.5)

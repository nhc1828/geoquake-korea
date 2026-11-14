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
    def test_kma_jma_pending(self):
        self.assertEqual(make_snapshot()['sources']['KMA']['state'],'pending')
        self.assertEqual(make_snapshot()['sources']['JMA']['state'],'pending')
if __name__=='__main__': unittest.main()

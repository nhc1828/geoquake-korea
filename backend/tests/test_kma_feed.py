"""KMA parser/poller tests with synthetic official-schema responses. No real API key."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import logging
import unittest
from unittest.mock import patch

import main
from kma_feed import (KMAResponseError, KST, parse_kma_bulletin,
                      parse_kma_page, fetch_kma_bulletins,
                      kst_timestamp, finite_num)


def today_kst():
    return datetime.now(KST)


def item(*, seq='1', minutes_ago=2, correction=None):
    t=today_kst() - timedelta(minutes=minutes_ago)
    return {
        'stnId':'108','fcTp':'3','tmFc':t.strftime('%Y%m%d%H%M'),
        'tmSeq':seq,'cnt':'','tmEqk':(t-timedelta(seconds=25)).strftime('%Y%m%d%H%M%S'),
        'lat':'36.10','lon':'129.20','dep':'13','loc':'경북 동해 부근',
        'mt':'4.2','inT':'IV', 'rem':'참고사항', 'cor':correction,
    }


def page(items, total=None, result='00'):
    return {'response': {'header':{'resultCode':result,'resultMsg':'NORMAL SERVICE.'},
            'body':{'totalCount':len(items) if total is None else total,
                    'items':{'item':items}}}}


class FakeResp:
    def __init__(self, payload):
        self.payload=payload
        self.content=json.dumps(payload, ensure_ascii=False).encode('utf-8')
    def raise_for_status(self):
        return None
    def json(self):
        return self.payload


class FakeHttp:
    def __init__(self, pages):
        self.pages=pages
        self.calls=[]
    async def get(self,url,params):
        self.calls.append((url,dict(params)))
        return FakeResp(self.pages[len(self.calls)-1])


class KMASchemaTests(unittest.TestCase):
    def test_kst_to_utc(self):
        self.assertEqual(kst_timestamp('20261114160000'),'2026-11-14T07:00:00Z')
        self.assertEqual(kst_timestamp('202611141600'),'2026-11-14T07:00:00Z')
    def test_null_and_invalid_times(self):
        self.assertIsNone(kst_timestamp(None))
        self.assertIsNone(kst_timestamp('20261199000000'))
        self.assertIsNone(kst_timestamp('no-time'))
    def test_normal_bulletin(self):
        e=parse_kma_bulletin(item())
        self.assertEqual(e['source'],'KMA')
        self.assertEqual(e['magnitude'],4.2)
        self.assertEqual(e['depthKm'],13)
        self.assertEqual(e['latitude'],36.10)
        self.assertEqual(e['maxIntensity'],'IV')
        self.assertFalse(e['observationsVerified'])
        self.assertEqual(e['observedRegions'],{})
        self.assertEqual(e['ingestMode'],'history')
        self.assertFalse(e['cancelled'])
    def test_unavailable_values_not_zero(self):
        raw=item();raw.update({'lat':'','lon':'','mt':None,'dep':'-'})
        e=parse_kma_bulletin(raw)
        self.assertIsNone(e['latitude']);self.assertIsNone(e['longitude'])
        self.assertIsNone(e['magnitude']);self.assertIsNone(e['depthKm'])
    def test_partial_coordinates_not_used(self):
        raw=item();raw['lon']=''
        e=parse_kma_bulletin(raw)
        self.assertIsNone(e['latitude']);self.assertIsNone(e['longitude'])
    def test_invalid_numeric_nan(self):
        self.assertIsNone(finite_num(float('nan')))
        self.assertIsNone(finite_num(True))
        self.assertIsNone(finite_num('inf'))
    def test_correction_unique_no_fabricated_cancel(self):
        first=parse_kma_bulletin(item(correction=None))
        corrected=parse_kma_bulletin(item(correction='규모 정정'))
        self.assertNotEqual(first['id'],corrected['id'])
        self.assertEqual(corrected['correctionType'],'규모 정정')
        self.assertFalse(corrected['cancelled'])
    def test_report_id_deterministic(self):
        record=item()
        self.assertEqual(parse_kma_bulletin(record)['id'],parse_kma_bulletin(record)['id'])
    def test_bad_shape_refused(self):
        with self.assertRaises(KMAResponseError):parse_kma_page({})
        with self.assertRaises(KMAResponseError):parse_kma_page({'response':{'header':{'resultCode':'00'},'body':{'items':'error'}}})
    def test_service_error_refused(self):
        with self.assertRaises(KMAResponseError):parse_kma_page(page([],result='99'))
    def test_no_data_result_code(self):
        self.assertEqual(parse_kma_page(page([],result='03')),([],0))
    def test_single_item_form(self):
        p=page([item()])
        p['response']['body']['items']['item']=item()
        rows,total=parse_kma_page(p)
        self.assertEqual(total,1);self.assertEqual(len(rows),1)
    def test_missing_items_for_nonempty_total_refused(self):
        p=page([],total=2)
        # The parser can parse a page with no rows, but the fetch must reject incomplete results.
        result=asyncio.run(_fetch_with(p))
        self.assertIsInstance(result,KMAResponseError)


async def _fetch_with(payload):
    try:
        await fetch_kma_bulletins(FakeHttp([payload]),'a-test-key')
    except Exception as e:
        return e
    return None


class KMAFetchTests(unittest.TestCase):
    def test_params_and_normal_fetch(self):
        http=FakeHttp([page([item()])])
        records,total=asyncio.run(fetch_kma_bulletins(http,'test-secret'))
        self.assertEqual(total,1)
        self.assertEqual(len(records),1)
        url,query=http.calls[0]
        self.assertTrue(url.startswith('https://apihub.kma.go.kr/'))
        self.assertEqual(query['authKey'],'test-secret')
        self.assertEqual(query['dataType'],'JSON')
        self.assertEqual(len(query['fromTmFc']),8)
    def test_pagination_and_dedup(self):
        a,b=item(seq='1'),item(seq='2')
        http=FakeHttp([page([a],total=2),page([b],total=2)])
        records,total=asyncio.run(fetch_kma_bulletins(http,'test-secret'))
        self.assertEqual(total,2)
        self.assertEqual(len(records),2)
        self.assertEqual([x[1]['pageNo'] for x in http.calls],[1,2])
    def test_unknown_api_error(self):
        http=FakeHttp([page([],result='99')])
        with self.assertRaises(KMAResponseError):asyncio.run(fetch_kma_bulletins(http,'test-secret'))
    def test_empty_api_success(self):
        http=FakeHttp([page([],result='03')])
        self.assertEqual(asyncio.run(fetch_kma_bulletins(http,'test-secret')),([],0))
    def test_no_key_rejected_before_request(self):
        with self.assertRaises(KMAResponseError):asyncio.run(fetch_kma_bulletins(FakeHttp([]),''))


class KMAIntegrationTests(unittest.TestCase):
    def setUp(self):
        main.snapshot=main.make_snapshot()
        main.usgs_records=[]
        main.jma_records.clear()
        main.kma_records.clear()
        main.kma_seeded=False
    def test_first_batch_history_then_stream(self):
        async def scenario():
            a=item(seq='1')
            h1=FakeHttp([page([a])])
            self.assertTrue(await main.collect_kma_once(h1,'secret'))
            self.assertEqual(main.snapshot['sources']['KMA']['state'],'ok')
            self.assertEqual(next(iter(main.kma_records.values()))['ingestMode'],'history')
            b=item(seq='2')
            h2=FakeHttp([page([a,b])])
            self.assertTrue(await main.collect_kma_once(h2,'secret'))
            stream=[v for v in main.kma_records.values() if v['agencyEventId'].split('-')[1]=='2']
            self.assertEqual(len(stream),1)
            self.assertEqual(stream[0]['ingestMode'],'stream')
            self.assertEqual(main.snapshot['sources']['KMA']['count'],2)
        asyncio.run(scenario())
    def test_failure_retains_previous_records(self):
        async def scenario():
            self.assertTrue(await main.collect_kma_once(FakeHttp([page([item()])]),'secret'))
            self.assertFalse(await main.collect_kma_once(FakeHttp([page([],result='99')]),'secret'))
            self.assertEqual(main.snapshot['sources']['KMA']['state'],'error')
            self.assertEqual(len(main.snapshot['events']),1)
        asyncio.run(scenario())
    def test_merged_with_usgs_and_jma(self):
        async def scenario():
            main.usgs_records=[{'id':'USGS:test','source':'USGS','occurredAt':main.now()}]
            self.assertTrue(await main.collect_kma_once(FakeHttp([page([item()])]),'secret'))
            self.assertEqual({x['source'] for x in main.snapshot['events']},{'KMA','USGS'})
        asyncio.run(scenario())
    def test_health_fields_not_secret(self):
        async def scenario():
            response=await main.health()
            self.assertIn('kma',response)
            self.assertIn('kmaConfigured',response)
            self.assertNotIn('authKey',json.dumps(response))
        asyncio.run(scenario())
    def test_correction_not_new_alert(self):
        async def scenario():
            a=item(seq='1')
            await main.collect_kma_once(FakeHttp([page([a])]),'secret')
            b=item(seq='2',correction='규모 정정')
            await main.collect_kma_once(FakeHttp([page([a,b])]),'secret')
            corrections=[v for v in main.kma_records.values() if v['correctionType']=='규모 정정']
            self.assertEqual(len(corrections),1)
            self.assertEqual(corrections[0]['ingestMode'],'history')
        asyncio.run(scenario())


if __name__=='__main__': unittest.main()

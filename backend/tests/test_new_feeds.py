import unittest
from kma_feed import parse_kma_regions, parse_kma_json, parse_kma_bulletin
from hazard_feed import (volcano_reports, tsunami_reports, kma_tsunami_reports,
                         kma_tsunami_info_reports, kma_volcano_reports, kma_failure_reason)
from kma_feed import KMAResponseError

class RegionalBulletinTests(unittest.TestCase):
    def test_realistic_kma_grouped_intensity(self):
        result = parse_kma_regions('최대진도 Ⅳ(경북,충북),Ⅲ(강원,세종,전북),Ⅱ(경기,경남,대구,대전,전남광주,충남)')
        self.assertEqual(result['KR-47']['value'], '4')
        self.assertEqual(result['KR-43']['value'], '4')
        self.assertEqual(result['KR-50']['value'], '3')
        self.assertEqual(result['KR-44']['value'], '2')
        self.assertNotIn('KR-46', result) # Combined administrative unit cannot be split safely.
        self.assertNotIn('KR-29', result)
    def test_no_region_is_not_invented(self):
        self.assertEqual(parse_kma_regions('최대진도 Ⅳ'), {})
    def test_cp949_json_is_decoded_without_replacement(self):
        class Response: content = '{"loc":"경북"}'.encode('cp949')
        self.assertEqual(parse_kma_json(Response())['loc'],'경북')
    def test_full_bulletin_keeps_regional_report(self):
        row={'tmFc':'202611172314','tmEqk':'20261117231017','inT':'최대진도 Ⅳ(경북,충북)'}
        e=parse_kma_bulletin(row)
        self.assertEqual(e['reportedAreas']['KR-47']['value'],'4')
        self.assertFalse(e['observationsVerified'])

class HazardFeedTests(unittest.TestCase):
    def test_kma_failure_reason_never_exposes_provider_text(self):
        class Response:
            status_code = 403
        class HTTPError(Exception):
            response = Response()
        self.assertEqual(kma_failure_reason(HTTPError('authKey=secret')), 'http_403')
        self.assertEqual(kma_failure_reason(KMAResponseError('KMA API resultCode=20')), 'api_20')
        self.assertEqual(kma_failure_reason(KMAResponseError('secret in error')), 'invalid_response')
        self.assertEqual(kma_failure_reason(ValueError('authKey=secret')), 'invalid_response')
    def test_volcano_official_level_and_release(self):
        payload=[{'reportDatetime':'2026-09-01T16:00:00+09:00','eventId':'503','volcanoInfos':[{'type':'噴火警報・予報（対象火山）','items':[{'code':'12','areas':[{'name':'阿蘇山'}]}]}]}]
        item=volcano_reports(payload)[0]
        self.assertEqual(item['name'],'아소산')
        self.assertEqual(item['level'],'분화 경보 · 경계 레벨 2')
        payload[0]['volcanoInfos'][0]['items'][0]['code']='11'
        self.assertIn('예보',volcano_reports(payload)[0]['level'])
    def test_cancelled_tsunami_is_a_release_not_warning(self):
        payload=[{'id':'a','code':552,'issue':{'time':'2026/01/01 12:00:00'},'cancelled':True}]
        self.assertTrue(tsunami_reports(payload)[0]['cancelled'])
        self.assertEqual(tsunami_reports(payload)[0]['areas'],[])
    def test_kma_tsunami_bulletin_and_empty_response(self):
        payload={'response':{'header':{'resultCode':'00'},'body':{'totalCount':1,'items':{'item':[{'tmFc':'202611171200','fcTp':'지진해일정보','reg':'강원','ann':'통보 내용'}]}}}}
        row=kma_tsunami_reports(payload)[0]
        self.assertEqual(row['issuedAt'],'2026-11-17T03:00:00Z')
        self.assertEqual(row['area'],'강원')
        self.assertEqual(kma_tsunami_reports({'response':{'header':{'resultCode':'03'}}}),[])
    def test_kma_tsunami_information_fallback(self):
        raw = ('<root><item><tmIssue>2026-11-25 20:00:00</tmIssue>'
               '<msgKo>지진해일정보</msgKo><wrnHighLoc>강원</wrnHighLoc>'
               '<relLowLoc>경북</relLowLoc><eqkLoc>동해</eqkLoc></item></root>').encode('utf-8')
        item = kma_tsunami_info_reports(raw)[0]
        self.assertEqual(item['issuedAt'], '2026-11-25T11:00:00Z')
        self.assertIn('경보: 강원', item['area'])
        self.assertIn('주의보 해제: 경북', item['area'])
        with self.assertRaises(ValueError):
            kma_tsunami_info_reports(b'<root/>')
        with self.assertRaises(ValueError):
            kma_tsunami_info_reports(b'<!DOCTYPE x [<!ENTITY y "x">]><x>&y;</x>')
    def test_kma_volcano_xml_and_unrecognized_response(self):
        raw='<root><item><volcName>백두산</volcName><tmIssue>2026-11-17 12:00:00</tmIssue><release>해제</release></item></root>'.encode('utf-8')
        self.assertEqual(kma_volcano_reports(raw)[0]['name'],'백두산')
        with self.assertRaises(ValueError): kma_volcano_reports(b'<error/>')
    def test_invalid_feed_does_not_become_empty_success(self):
        with self.assertRaises(ValueError): tsunami_reports({'error':'no access'})
        with self.assertRaises(ValueError): volcano_reports([{'volcanoInfos':[]}])

if __name__ == '__main__': unittest.main()

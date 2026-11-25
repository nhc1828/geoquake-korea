import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
import main


class Response:
    def __init__(self, payload=b'', status=200):
        self.content = payload
        self.status_code = status
    def raise_for_status(self):
        if self.status_code >= 400:
            error = httpx.HTTPError('upstream failure')
            error.response = self
            raise error
    def json(self):
        return json.loads(self.content)


class FakeHTTP:
    def __init__(self, fallback_status):
        self.fallback_status = fallback_status
        self.calls = []
    async def __aenter__(self): return self
    async def __aexit__(self, *args): return False
    async def get(self, url, params=None):
        self.calls.append(url)
        if url == main.VOLCANO_URL or url == main.TSUNAMI_URL:
            return Response(b'[]')
        if url == main.KMA_TSUNAMI_URL:
            return Response(b'{"response":{"header":{"resultCode":"99"}}}')
        if url == main.KMA_TSUNAMI_INFO_URL:
            body = ('<root><item><tmIssue>2026-11-25 20:00:00</tmIssue>'
                    '<msgKo>지진해일정보</msgKo><wrnHighLoc>강원</wrnHighLoc>'
                    '</item></root>').encode('utf-8')
            return Response(body, self.fallback_status)
        if url == main.KMA_VOLCANO_URL:
            return Response(('<root><item><volcName>백두산</volcName>'
                             '<tmIssue>2026-11-25 20:00:00</tmIssue></item></root>').encode('utf-8'))
        raise AssertionError('unexpected endpoint')


class KMAFallbackIntegrationTests(unittest.TestCase):
    def run_one_poll(self, status):
        fake = FakeHTTP(status)
        async def stop_after_poll(_): raise asyncio.CancelledError()
        async def run():
            with patch.dict(main.os.environ, {'KMA_API_KEY': 'test-secret'}), \
                 patch.object(main.httpx, 'AsyncClient', return_value=fake), \
                 patch.object(main.asyncio, 'sleep', side_effect=stop_after_poll):
                with self.assertRaises(asyncio.CancelledError):
                    await main.hazard_poll_loop()
        asyncio.run(run())
        return fake
    def test_valid_fallback_is_reported(self):
        self.run_one_poll(200)
        feed = main.hazard_snapshot['kmaTsunami']
        self.assertEqual(feed['state'], 'ok')
        self.assertEqual(feed['items'][0]['area'], '경보: 강원')
        self.assertEqual(feed['source'], 'KMA 지진해일 정보 조회')
    def test_failed_fallback_is_not_an_all_clear(self):
        self.run_one_poll(403)
        feed = main.hazard_snapshot['kmaTsunami']
        self.assertEqual(feed['state'], 'error')
        self.assertEqual(feed['reason'], 'api_99')
        self.assertEqual(feed['fallbackReason'], 'http_403')
        self.assertNotIn('test-secret', json.dumps(feed))

if __name__ == '__main__': unittest.main()

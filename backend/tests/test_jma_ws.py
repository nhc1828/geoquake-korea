"""Local upstream WebSocket integration test. No external API/network required."""
import asyncio
from contextlib import suppress
import json
import unittest
from unittest.mock import patch
import websockets
import main
from test_jma_feed import sample


class LiveWireTests(unittest.TestCase):
    def test_jma_stream_receives_551_and_ignores_556(self):
        main.snapshot = main.make_snapshot()
        main.jma_records.clear()
        main.usgs_records = []

        async def scenario():
            async def upstream(server):
                await server.send('{invalid JSON')
                await server.send(json.dumps({'code':556,'id':'fake-eew'}, ensure_ascii=False))
                await server.send(json.dumps(sample('wire-551'), ensure_ascii=False))
                await asyncio.sleep(1)

            async def no_backfill(_http):
                return 0

            async with websockets.serve(upstream, '127.0.0.1', 0) as server:
                port=server.sockets[0].getsockname()[1]
                with patch.object(main, 'JMA_WS_URL', f'ws://127.0.0.1:{port}'), \
                     patch.object(main, 'seed_jma_history', new=no_backfill):
                    task=asyncio.create_task(main.jma_ws_loop())
                    try:
                        for _ in range(80):
                            if 'JMA:wire-551' in main.jma_records:
                                break
                            await asyncio.sleep(0.025)
                        self.assertIn('JMA:wire-551',main.jma_records)
                        self.assertNotIn('JMA:fake-eew',main.jma_records)
                        self.assertEqual(main.snapshot['sources']['JMA']['state'],'ok')
                        self.assertTrue(main.snapshot['sources']['JMA']['connected'])
                    finally:
                        task.cancel()
                        with suppress(asyncio.CancelledError):
                            await task
        asyncio.run(scenario())

if __name__ == '__main__':
    unittest.main()

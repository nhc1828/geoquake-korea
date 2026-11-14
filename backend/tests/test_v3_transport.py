"""Version 3 transport tests -- no external network or API key required."""
import json
import os
import sys
import unittest
from pathlib import Path

os.environ['GEOQUAKE_DISABLE_POLL'] = '1'
os.environ['GEOQUAKE_DISABLE_JMA'] = '1'
os.environ['GEOQUAKE_DISABLE_KMA'] = '1'
sys.path.insert(0, str(Path(__file__).parents[1]))

from fastapi.testclient import TestClient
import main


class V3TransportTests(unittest.TestCase):
    def test_health_contract(self):
        r = TestClient(main.app).get('/health')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['version'], '3.0')
        self.assertIs(r.json()['wsHeartbeat'], True)

    def test_websocket_echo(self):
        with TestClient(main.app).websocket_connect('/ws', headers={'origin':'https://nhc1828.github.io'}) as ws:
            initial = ws.receive_json()
            self.assertEqual(initial['type'], 'snapshot')
            self.assertIn('serverSentAt', initial)
            ws.send_json({'type': 'ping', 'clientSent': 1740000000000})
            pong = ws.receive_json()
            self.assertEqual(pong['type'], 'pong')
            self.assertEqual(pong['clientSent'], 1740000000000)
            self.assertTrue(pong['serverAt'].endswith('Z'))

    def test_invalid_heartbeat_safe(self):
        with TestClient(main.app).websocket_connect('/ws', headers={'origin':'https://nhc1828.github.io'}) as ws:
            self.assertEqual(ws.receive_json()['type'], 'snapshot')
            ws.send_text('{broken json')
            ws.send_json({'type':'ping','clientSent':101})
            self.assertEqual(ws.receive_json()['clientSent'],101)

if __name__=='__main__':unittest.main()

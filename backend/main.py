"""GEOQUAKE KOREA 6B. USGS + JMA 551 + KMA official bulletins. NOT EEW."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, timedelta, timezone
import json
import logging
import math
import os
import random

import websockets
from jma_feed import parse_jma_551
from kma_feed import fetch_kma_bulletins

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('geoquake')
# httpx normally logs full query URLs at INFO level; authKey is a query param.
# NEVER permit that log line to expose KMA_API_KEY in Railway logs.
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)
USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
USGS_HISTORY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
JMA_WS_URL = 'wss://api.p2pquake.net/v2/ws'
JMA_HISTORY_URL = 'https://api.p2pquake.net/v2/history'
JMA_MAX_ITEMS = 300
JMA_BOOTSTRAP_LIMIT = 100
HISTORY_CACHE = {}  # bounded, in-memory public FDSN results (no personalized data)
POLL_SECONDS = max(60, int(os.getenv('USGS_POLL_SECONDS', '60')))
KMA_POLL_SECONDS = max(60, int(os.getenv('KMA_POLL_SECONDS', '120')))
KMA_CONFIGURED = bool(os.getenv('KMA_API_KEY', '').strip())
KMA_MAX_ITEMS = 500
ORIGINS = {'https://nhc1828.github.io', 'http://localhost:5500', 'http://127.0.0.1:5500'}
clients = set()
state_lock = asyncio.Lock()
usgs_records = []
jma_records = {}  # P2PQuake 551 bulletin id -> normalized record; 1 replica only
kma_records = {}  # KMA report id -> normalized official bulletin (in-memory)
kma_seeded = False


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def from_ms(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value) or not (0 < value < 1e15):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except (OverflowError, ValueError, OSError):
        return None


def num(value, low=-math.inf, high=math.inf):
    if value is None or isinstance(value, bool) or value == '':
        return None
    try:
        val = float(value)
        return val if math.isfinite(val) and low <= val <= high else None
    except (ValueError, TypeError, OverflowError):
        return None


def parse_usgs(data):
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection' or not isinstance(data.get('features'), list):
        raise ValueError('USGS GeoJSON 형식 오류')
    output = []
    for entry in data['features'][:4000]:
        if not isinstance(entry, dict):
            continue
        prop, geom = entry.get('properties'), entry.get('geometry')
        if not isinstance(prop, dict) or not isinstance(geom, dict) or prop.get('type') != 'earthquake':
            continue
        coords = geom.get('coordinates')
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        lon, lat = num(coords[0], -180, 180), num(coords[1], -90, 90)
        when = from_ms(prop.get('time'))
        eid = str(entry.get('id') or '')
        if lon is None or lat is None or when is None or not eid:
            continue
        url = str(prop.get('url') or '')
        if not url.startswith('https://earthquake.usgs.gov/'):
            url = 'https://earthquake.usgs.gov/earthquakes/map/'
        output.append({
            'id': f'USGS:{eid}', 'source': 'USGS', 'agencyEventId': eid,
            'occurredAt': when, 'reportedAt': None, 'updatedAt': from_ms(prop.get('updated')),
            'latitude': lat, 'longitude': lon,
            'depthKm': num(coords[2], 0, 750) if len(coords) > 2 else None,
            'magnitude': num(prop.get('mag'), -2, 10),
            'location': str(prop.get('place') or '위치 미상')[:160],
            'maxIntensity': None, 'intensityScale': None, 'bulletinType': '지진 발생정보',
            'url': url, 'cancelled': False,
        })
    output.sort(key=lambda v: v['occurredAt'], reverse=True)
    if data['features'] and not output:
        raise ValueError('유효한 USGS 지진 항목 없음 · 응답 형식 확인 필요')
    return output


def make_snapshot():
    return {
        'schemaVersion': '1.0', 'generatedAt': None, 'lookbackDays': 7,
        'sources': {
            'KMA': {'state': 'pending' if KMA_CONFIGURED else 'unconfigured',
                    'checkedAt': None, 'count': 0,
                    'message': '공식 KMA 발표 수신 대기' if KMA_CONFIGURED else 'Railway KMA_API_KEY 미설정'},
            'JMA': {'state': 'pending', 'checkedAt': None, 'count': 0, 'connected': False, 'lastMessageAt': None, 'message': 'JMA 수신기 시작 대기'},
            'USGS': {'state': 'pending', 'checkedAt': None, 'count': 0, 'message': '첫 수신 대기'},
        },
        'events': [],
        'notice': '지진 발생 후 공개된 발표정보입니다. 사전 예측·긴급지진조기경보가 아닙니다.'
    }


snapshot = make_snapshot()


async def broadcast():
    if not clients:
        return
    data = json.dumps({'type': 'snapshot', 'data': snapshot, 'serverSentAt': now()}, ensure_ascii=False)
    sockets = list(clients)
    results = await asyncio.gather(*(sock.send_text(data) for sock in sockets), return_exceptions=True)
    for sock, res in zip(sockets, results):
        if isinstance(res, Exception):
            clients.discard(sock)


def rebuild_snapshot_locked():
    """Called only under state_lock. Preserve independent USGS/JMA/KMA records."""
    global snapshot
    for key, event in list(jma_records.items()):
        if not recent_jma_record(event):
            jma_records.pop(key, None)
    for key, event in list(kma_records.items()):
        if not recent_kma_record(event):
            kma_records.pop(key, None)
    records = usgs_records + list(jma_records.values()) + list(kma_records.values())
    snapshot['sources']['KMA']['count'] = len(kma_records)
    snapshot['sources']['JMA']['count'] = len(jma_records)
    records.sort(key=lambda e: e.get('occurredAt') or '', reverse=True)
    snapshot = {**snapshot, 'generatedAt': now(), 'events': records}


async def collect_once(http):
    global snapshot, usgs_records
    checked = now()
    try:
        response = await http.get(USGS_URL)
        response.raise_for_status()
        if len(response.content) > 8_000_000:
            raise ValueError('자료 용량 제한 초과')
        events = parse_usgs(response.json())
        prior_seen = {e['id']:e.get('serverFirstSeenAt') for e in usgs_records}
        for e in events:
            e['serverFirstSeenAt'] = prior_seen.get(e['id']) or checked
        async with state_lock:
            usgs_records = events
            snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'USGS': {
                'state': 'ok', 'checkedAt': checked, 'count': len(events),
                'message': '최근 7일 M2.5 이상 (USGS GeoJSON)'
            }}}
            rebuild_snapshot_locked()
        logger.info('USGS: %s events', len(events))
    except (httpx.HTTPError, ValueError, TypeError) as error:
        async with state_lock:
            snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'USGS': {
                'state': 'error', 'checkedAt': checked, 'count': len(usgs_records),
                'message': f'수집 실패 ({type(error).__name__}) · 이전 자료 유지'
            }}}
            rebuild_snapshot_locked()
        logger.warning('USGS fetch failed: %s', type(error).__name__)
    await broadcast()


async def set_jma_status(state, message, *, connected=False, message_at=None):
    global snapshot
    async with state_lock:
        prev = snapshot['sources']['JMA']
        snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'JMA': {
            'state': state, 'checkedAt': now(), 'count': len(jma_records),
            'connected': connected,
            'lastMessageAt': message_at or prev.get('lastMessageAt'),
            'message': message[:140]
        }}}
        rebuild_snapshot_locked()
    await broadcast()


def recent_jma_record(event):
    """Do not load indefinite history into RAM. Use bulletin receive time."""
    value = event.get('updatedAt') or event.get('reportedAt') or event.get('occurredAt')
    if not value:
        return False
    try:
        updated = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - timedelta(days=7) <= updated <= datetime.now(timezone.utc) + timedelta(minutes=5)


async def ingest_jma_551(raw, *, mode='stream', notify=True):
    """One P2P 551 bulletin. No assumptions that bulletin IDs identify a quake."""
    global snapshot
    event = parse_jma_551(raw, ingest_mode=mode)
    if event:
        event['serverFirstSeenAt'] = now()
    if not event or not recent_jma_record(event):
        return False
    async with state_lock:
        if event['id'] in jma_records:
            return False  # P2P may send the same message multiple times
        jma_records[event['id']] = event
        if len(jma_records) > JMA_MAX_ITEMS:
            # Keep the latest bulletins by relay/official issue timestamp.
            ordered = sorted(jma_records.values(), key=lambda e: e.get('updatedAt') or '', reverse=True)
            jma_records.clear()
            jma_records.update((e['id'], e) for e in ordered[:JMA_MAX_ITEMS])
        prior = snapshot['sources']['JMA']
        message_at = now() if mode == 'stream' else prior.get('lastMessageAt')
        snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'JMA': {
            **prior, 'count': len(jma_records), 'checkedAt': now(),
            'lastMessageAt': message_at,
            'message': 'P2PQuake 551 실시간 수신' if mode == 'stream' else 'JMA 최근 발표 복구 · WebSocket 수신 대기'
        }}}
        rebuild_snapshot_locked()
    if notify:
        await broadcast()
    logger.info('JMA 551: %s · %d station regions (%s)', event['id'], len(event['observedRegions']), mode)
    return True


async def seed_jma_history(http):
    """Fetch up to 100 recent bulletins *after* WS connection to reduce gaps."""
    resp = await http.get(JMA_HISTORY_URL, params={'codes': '551', 'limit': JMA_BOOTSTRAP_LIMIT})
    resp.raise_for_status()
    if len(resp.content) > 3_000_000:
        raise ValueError('JMA history payload too large')
    rows = resp.json()
    if not isinstance(rows, list):
        raise ValueError('JMA history schema mismatch')
    added = 0
    # Ingest oldest first. Clients suppress alerts for mode=history.
    for item in reversed(rows):
        if isinstance(item, dict) and item.get('code') == 551:
            added += int(await ingest_jma_551(item, mode='history', notify=False))
    if added:
        await broadcast()
    logger.info('JMA: recovered %s historical bulletins (from %s)', added, len(rows))
    return added


async def jma_ws_loop():
    """ONE upstream WebSocket per Railway replica. Reconnect with backoff."""
    retry = 1.5
    await set_jma_status('pending', 'P2PQuake WebSocket 연결 중')
    while True:
        try:
            async with websockets.connect(
                JMA_WS_URL, open_timeout=18, ping_interval=25,
                ping_timeout=25, close_timeout=8, max_size=1_000_000
            ) as upstream:
                retry = 1.5
                await set_jma_status('ok', 'P2PQuake WebSocket 연결 · 새 551 발표 대기', connected=True)
                try:
                    async with httpx.AsyncClient(timeout=15, follow_redirects=False,
                            headers={'User-Agent': 'GEOQUAKE-KOREA/6A educational',
                                     'Accept': 'application/json'}) as http:
                        await seed_jma_history(http)
                except (httpx.HTTPError, ValueError, TypeError) as exc:
                    logger.warning('JMA backfill failed: %s', type(exc).__name__)
                    # The WS connection itself stays active even if history fails.
                    await set_jma_status('ok', 'WebSocket 수신 중 · 초기 기록 복구 실패', connected=True)
                async for message in upstream:
                    if not isinstance(message, str) or len(message) > 1_000_000:
                        continue
                    try:
                        payload = json.loads(message)
                    except (json.JSONDecodeError, ValueError):
                        logger.warning('JMA invalid JSON frame')
                        continue
                    if isinstance(payload, dict) and payload.get('code') == 551:
                        await ingest_jma_551(payload, mode='stream')
                    # 554/556/552 are NOT 551 and must never become event alerts here.
        except Exception as exc:
            logger.warning('JMA WebSocket disconnected: %s', type(exc).__name__)
        await set_jma_status('error', 'P2PQuake 연결 끊김 · 자동 재접속 중 (이전 발표 보존)')
        await asyncio.sleep(retry + random.uniform(0, 0.9))
        retry = min(60, retry * 1.8)



def recent_kma_record(event):
    """Prune in-memory bulletin history after 7 days; not a durable archive."""
    value = event.get('reportedAt')
    if not value:
        return False
    try:
        issued = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return False
    return datetime.now(timezone.utc) - timedelta(days=7) <= issued <= datetime.now(timezone.utc) + timedelta(minutes=5)


async def collect_kma_once(http, auth_key):
    """Fetch new KMA bulletins. Never expose the auth key or raw exception URL."""
    global snapshot, kma_seeded
    checked = now()
    try:
        items, raw_count = await fetch_kma_bulletins(http, auth_key)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning('KMA fetch failed: %s', type(exc).__name__)
        async with state_lock:
            snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'KMA': {
                'state': 'error', 'checkedAt': checked,
                'count': len(kma_records),
                'message': '기상청 API 조회 실패 (' + type(exc).__name__ + ') · 이전 기록 유지'
            }}}
            rebuild_snapshot_locked()
        await broadcast()
        return False

    imported = 0
    async with state_lock:
        for event in items:
            if not recent_kma_record(event):
                continue
            key = event['id']
            if key not in kma_records:
                # First successful API backfill is history even if recent, and
                # must never create an artificial emergency alarm on startup.
                issued = datetime.fromisoformat(event['reportedAt'].replace('Z', '+00:00'))
                is_new = kma_seeded and datetime.now(timezone.utc) - issued <= timedelta(minutes=20)
                is_correction = bool(event.get('correctionType') and
                                     any(word in event['correctionType'] for word in ('정정','취소','오보','수정')))
                event['ingestMode'] = 'stream' if is_new and not is_correction else 'history'
                event['serverFirstSeenAt'] = checked
                kma_records[key] = event
                imported += 1
        kma_seeded = True
        if len(kma_records) > KMA_MAX_ITEMS:
            ordered = sorted(kma_records.values(), key=lambda e: e['reportedAt'], reverse=True)
            kma_records.clear()
            kma_records.update((e['id'], e) for e in ordered[:KMA_MAX_ITEMS])
        snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'KMA': {
            'state': 'ok', 'checkedAt': checked, 'count': len(kma_records),
            'message': '공식 지진통보문 조회 정상 · 최근 조회 발표 ' + str(raw_count) + '건'
        }}}
        rebuild_snapshot_locked()
    logger.info('KMA: %d bulletins in query, %d newly recorded', raw_count, imported)
    await broadcast()
    return True


async def kma_poll_loop():
    """A single 120s (default) API polling task, never browser-side key access."""
    secret = os.getenv('KMA_API_KEY', '').strip()
    if not secret:
        return
    async with httpx.AsyncClient(timeout=25, follow_redirects=False,
                                 headers={'User-Agent': 'GEOQUAKE-KOREA/6B educational',
                                          'Accept': 'application/json'}) as http:
        while True:
            await collect_kma_once(http, secret)
            await asyncio.sleep(KMA_POLL_SECONDS)


async def poll_loop():
    async with httpx.AsyncClient(timeout=20, follow_redirects=False,
                                headers={'User-Agent': 'GEOQUAKE-KOREA/2.0', 'Accept': 'application/json'}) as http:
        while True:
            await collect_once(http)
            await asyncio.sleep(POLL_SECONDS)


@asynccontextmanager
async def lifespan(app):
    tasks = []
    if os.getenv('GEOQUAKE_DISABLE_POLL') != '1':
        tasks.append(asyncio.create_task(poll_loop(), name='usgs-poll'))
    if os.getenv('GEOQUAKE_DISABLE_JMA') != '1':
        tasks.append(asyncio.create_task(jma_ws_loop(), name='jma-relay'))
    if KMA_CONFIGURED and os.getenv('GEOQUAKE_DISABLE_KMA') != '1':
        tasks.append(asyncio.create_task(kma_poll_loop(), name='kma-poll'))
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title='GEOQUAKE KOREA observation API', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_credentials=False,
                   allow_methods=['GET'], allow_headers=['*'])


@app.get('/')
async def root():
    return {'service': 'GEOQUAKE KOREA backend', 'phase': 'USGS + JMA 551 + KMA getEqkMsg', 'urls': ['/health', '/api/events', '/api/history', '/ws']}


@app.get('/health')
async def health():
    return {'service': 'ok', 'version': '3.0', 'wsHeartbeat': True, 'usgs': snapshot['sources']['USGS']['state'],
            'kma': snapshot['sources']['KMA']['state'],
            'kmaConfigured': KMA_CONFIGURED,
            'kmaCount': len(kma_records),
            'kmaLastCheckedAt': snapshot['sources']['KMA'].get('checkedAt'),
            'jma': snapshot['sources']['JMA']['state'],
            'jmaConnected': snapshot['sources']['JMA'].get('connected', False),
            'jmaCount': len(jma_records),
            'jmaLastMessageAt': snapshot['sources']['JMA'].get('lastMessageAt'),
            'lastGeneratedAt': snapshot['generatedAt'], 'connections': len(clients)}


@app.get('/api/events')
async def events():
    return JSONResponse(snapshot, headers={'Cache-Control': 'no-store'})




def history_params(start_date: date, end_date: date, minmag: float, limit: int):
    """Validate dates before contacting USGS FDSN; avoid unbounded archive requests."""
    if start_date > end_date or (end_date - start_date).days > 30:
        raise ValueError('조회 날짜 차이는 0~30일이어야 합니다 (최대 31일 포함).')
    if end_date > datetime.now(timezone.utc).date():
        raise ValueError('미래의 날짜는 조회할 수 없습니다.')
    if minmag < 2.5 or minmag > 9.5 or limit < 1 or limit > 150:
        raise ValueError('규모 2.5~9.5, 조회 최대 150건을 지정해 주세요.')
    return {
        'format': 'geojson', 'starttime': start_date.isoformat(),
        'endtime': (end_date + timedelta(days=1)).isoformat(),
        'minmagnitude': str(minmag), 'limit': str(limit), 'orderby': 'time'
    }


@app.get('/api/history')
async def historical_events(
    start: date = Query(..., description='UTC start date YYYY-MM-DD'),
    end: date = Query(..., description='UTC end date YYYY-MM-DD, inclusive'),
    minmag: float = Query(4.0, ge=2.5, le=9.5),
    limit: int = Query(150, ge=1, le=150)
):
    """On-demand historical USGS earthquake *events*, not observed intensity or issued warnings."""
    try:
        params = history_params(start, end, minmag, limit)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    key = (start.isoformat(), end.isoformat(), minmag, limit)
    saved = HISTORY_CACHE.get(key)
    if saved and (datetime.now(timezone.utc).timestamp() - saved[0]) < 600:
        return JSONResponse(saved[1], headers={'Cache-Control': 'no-store'})
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=False,
                   headers={'User-Agent': 'GEOQUAKE-KOREA/2.0 (educational historical records)', 'Accept':'application/json'}) as http:
            res = await http.get(USGS_HISTORY_URL, params=params)
        if res.status_code == 204:
            events, total = [], 0
        else:
            res.raise_for_status()
            if len(res.content) > 8_000_000:
                raise ValueError('과거 지진 조회 결과가 용량 제한을 초과했습니다.')
            raw = res.json()
            events = parse_usgs(raw)
            total = raw.get('metadata',{}).get('count',len(events))
            if not isinstance(total,int):
                total = len(events)
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.warning('USGS historical query failed: %s', type(exc).__name__)
        raise HTTPException(status_code=502, detail='USGS 과거 발생정보 조회에 실패했습니다. 연결 상태를 확인해 주세요.') from exc
    payload = {
        'schemaVersion':'1.0', 'source':'USGS', 'start':start.isoformat(),
        'end':end.isoformat(), 'generatedAt':now(), 'events':events,
        'returnedCount':len(events), 'totalCount':total, 'truncated':total>len(events),
        'note':'발생정보입니다. 지역별 진도와 당시 실제 경보는 포함되지 않습니다.'
    }
    if len(HISTORY_CACHE)>100:
        HISTORY_CACHE.clear()
    HISTORY_CACHE[key]=(datetime.now(timezone.utc).timestamp(),payload)
    return JSONResponse(payload, headers={'Cache-Control':'no-store'})

@app.websocket('/ws')
async def websocket(ws: WebSocket):
    origin = ws.headers.get('origin')
    if origin is not None and origin not in ORIGINS:
        await ws.close(code=1008)
        return
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_json({'type': 'snapshot', 'data': snapshot, 'serverSentAt': now()})
        while True:
            message = await ws.receive_text()
            if len(message) > 2048:
                continue
            try:
                payload = json.loads(message)
            except (ValueError, TypeError):
                continue
            if isinstance(payload, dict) and payload.get('type') == 'ping':
                stamp = payload.get('clientSent')
                if isinstance(stamp, (int, float)) and not isinstance(stamp, bool) and 0 < stamp < 1e16:
                    await ws.send_json({'type': 'pong', 'clientSent': stamp, 'serverAt': now()})
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=int(os.getenv('PORT', '8000')))

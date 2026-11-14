"""GEOQUAKE KOREA 2단계. 발표 후 USGS 지진정보. 조기경보/예측이 아님."""
import asyncio
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime, timedelta, timezone
import json
import logging
import math
import os

import httpx
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('geoquake')
USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
USGS_HISTORY_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query'
HISTORY_CACHE = {}  # bounded, in-memory public FDSN results (no personalized data)
POLL_SECONDS = max(60, int(os.getenv('USGS_POLL_SECONDS', '60')))
ORIGINS = {'https://nhc1828.github.io', 'http://localhost:5500', 'http://127.0.0.1:5500'}
clients = set()


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
            'KMA': {'state': 'pending', 'checkedAt': None, 'count': 0, 'message': '다음 단계에서 KMA 연결'},
            'JMA': {'state': 'pending', 'checkedAt': None, 'count': 0, 'message': '다음 단계에서 JMA 연결'},
            'USGS': {'state': 'pending', 'checkedAt': None, 'count': 0, 'message': '첫 수신 대기'},
        },
        'events': [],
        'notice': '지진 발생 후 공개된 발표정보입니다. 사전 예측·긴급지진조기경보가 아닙니다.'
    }


snapshot = make_snapshot()


async def broadcast():
    if not clients:
        return
    data = json.dumps({'type': 'snapshot', 'data': snapshot}, ensure_ascii=False)
    sockets = list(clients)
    results = await asyncio.gather(*(sock.send_text(data) for sock in sockets), return_exceptions=True)
    for sock, res in zip(sockets, results):
        if isinstance(res, Exception):
            clients.discard(sock)


async def collect_once(http):
    global snapshot
    checked = now()
    try:
        response = await http.get(USGS_URL)
        response.raise_for_status()
        if len(response.content) > 8_000_000:
            raise ValueError('자료 용량 제한 초과')
        events = parse_usgs(response.json())
        snapshot = {**snapshot, 'generatedAt': checked, 'events': events, 'sources': {
            **snapshot['sources'], 'USGS': {'state': 'ok', 'checkedAt': checked, 'count': len(events), 'message': '최근 7일 M2.5 이상'}
        }}
        logger.info('USGS: %s events', len(events))
    except (httpx.HTTPError, ValueError, TypeError) as error:
        # Keep the last successful data. Distinguish failure from zero earthquakes.
        snapshot = {**snapshot, 'sources': {**snapshot['sources'], 'USGS': {
            'state': 'error', 'checkedAt': checked, 'count': len(snapshot['events']),
            'message': f'수집 실패 ({type(error).__name__}) · 이전 자료 유지'
        }}}
        logger.warning('USGS fetch failed: %s', type(error).__name__)
    await broadcast()


async def poll_loop():
    async with httpx.AsyncClient(timeout=20, follow_redirects=False,
                                headers={'User-Agent': 'GEOQUAKE-KOREA/2.0', 'Accept': 'application/json'}) as http:
        while True:
            await collect_once(http)
            await asyncio.sleep(POLL_SECONDS)


@asynccontextmanager
async def lifespan(app):
    task = None if os.getenv('GEOQUAKE_DISABLE_POLL') == '1' else asyncio.create_task(poll_loop())
    try:
        yield
    finally:
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


app = FastAPI(title='GEOQUAKE KOREA observation API', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=sorted(ORIGINS), allow_credentials=False,
                   allow_methods=['GET'], allow_headers=['*'])


@app.get('/')
async def root():
    return {'service': 'GEOQUAKE KOREA backend', 'phase': 'USGS pilot', 'urls': ['/health', '/api/events', '/api/history', '/ws']}


@app.get('/health')
async def health():
    return {'service': 'ok', 'usgs': snapshot['sources']['USGS']['state'],
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
        await ws.send_json({'type': 'snapshot', 'data': snapshot})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=int(os.getenv('PORT', '8000')))

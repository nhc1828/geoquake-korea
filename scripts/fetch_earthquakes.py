#!/usr/bin/env python3
"""GEOQUAKE KOREA 1.0 / GitHub Actions snapshot builder.

Only post-event earthquake BULLETINS are collected, NOT earthquake prediction
nor an authoritative EEW distribution channel. Credentials never reach output.
Dependencies: Python 3.11+ standard library.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

UTC = timezone.utc
KST = timezone(timedelta(hours=9))
LOOKBACK_DAYS = 7
KMA_URL = 'https://apihub.kma.go.kr/api/typ02/openApi/EqkInfoService/getEqkMsg'
JMA_URL = 'https://www.jma.go.jp/bosai/quake/data/list.json'
USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson'
KMA_INFO = 'https://apihub.kma.go.kr/apiList.do?seqApi=7'
JMA_INFO = 'https://www.jma.go.jp/bosai/quake/'
UA = 'GEOQUAKE-KOREA/1.0 (educational earthquake bulletin dashboard)'


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso(t: datetime | None) -> str | None:
    return t.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z') if t else None


def parse_time(raw: Any) -> datetime | None:
    """KMA yyyymmddHHMM[SS] = Asia/Seoul; ISO strings retain offsets."""
    if raw is None or raw == '':
        return None
    # KMA timestamps may arrive as JSON numbers rather than strings. Detect their
    # yyyymmddHHMM[SS] shape *before* treating numeric values as Unix epochs.
    s = str(raw).strip()
    if re.fullmatch(r'\d{12}(?:\d{2})?', s) and s.startswith(('19', '20')):
        fmt = '%Y%m%d%H%M%S' if len(s) == 14 else '%Y%m%d%H%M'
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=KST).astimezone(UTC)
        except ValueError:
            return None
    if isinstance(raw, (int, float)) and raw > 1_000_000_000_000:
        try:
            return datetime.fromtimestamp(raw / 1000, UTC)
        except (ValueError, OSError, OverflowError):
            return None
    if isinstance(raw, (int, float)) and 1_000_000_000 < raw < 100_000_000_000:
        try:
            return datetime.fromtimestamp(raw, UTC)
        except (ValueError, OSError, OverflowError):
            return None
    try:
        dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
        return (dt if dt.tzinfo else dt.replace(tzinfo=KST)).astimezone(UTC)
    except ValueError:
        return None


def number(raw: Any, *, low: float = float('-inf'), high: float = float('inf')) -> float | None:
    if raw is None or isinstance(raw, bool) or raw == '':
        return None
    try:
        result = float(str(raw).strip())
        return round(result, 3) if low <= result <= high and result == result else None
    except (TypeError, ValueError, OverflowError):
        return None


def clean_text(raw: Any, limit: int = 150) -> str:
    return re.sub(r'[\x00-\x1f\x7f]', ' ', str(raw or '')).strip()[:limit]


def get_json(url: str) -> Any:
    """Never expose requested URL in an error: KMA query contains a secret."""
    request = Request(url, headers={
        'User-Agent': UA,
        'Accept': 'application/json, text/json, */*',
        'Cache-Control': 'no-cache',
    })
    try:
        with urlopen(request, timeout=18) as response:
            payload = response.read(8_000_001)
            if len(payload) > 8_000_000:
                raise RuntimeError('응답 크기 제한 초과')
        return json.loads(payload.decode('utf-8-sig'))
    except HTTPError as exc:
        raise RuntimeError(f'HTTP {exc.code}') from None
    except (URLError, TimeoutError, ConnectionError):
        raise RuntimeError('네트워크 연결 실패') from None
    except (UnicodeError, json.JSONDecodeError):
        raise RuntimeError('응답 JSON 파싱 실패') from None


def jma_coordinate(raw: Any) -> tuple[float | None, float | None, float | None]:
    """ISO 6709: +36.7+140.7-10000/ OR +3606.2+13959.5-48000/."""
    value = str(raw or '')
    match = re.match(r'^([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/?$', value)
    if not match:
        return None, None, None
    fields = (match.group(1), match.group(2))
    result = []
    for s, deg_digits, maximum in zip(fields, (2, 3), (90, 180)):
        integer_part = s.lstrip('+-').split('.', 1)[0]
        if len(integer_part) > deg_digits:
            raw_abs = s.lstrip('+-')
            degrees = int(integer_part[:deg_digits])
            minutes = float(raw_abs[deg_digits:])
            if minutes >= 60:
                return None, None, None
            val = degrees + minutes / 60
            if s.startswith('-'):
                val = -val
        else:
            val = float(s)
        if abs(val) > maximum:
            return None, None, None
        result.append(round(val, 5))
    height_m = float(match.group(3))
    depth = round(-height_m / 1000, 3) if height_m <= 0 else None
    return result[0], result[1], depth


def event(**kw: Any) -> dict[str, Any]:
    """Fixed public schema. A null magnitude is NOT magnitude 0."""
    return {
        'id': kw['id'],
        'source': kw['source'],
        'agencyEventId': kw['agency_id'],
        'occurredAt': kw['occurred'],
        'reportedAt': kw.get('reported'),
        'latitude': kw.get('lat'),
        'longitude': kw.get('lon'),
        'depthKm': kw.get('depth'),
        'magnitude': kw.get('mag'),
        'location': kw.get('location') or '위치 미상',
        'maxIntensity': kw.get('max_intensity'),
        'intensityScale': kw.get('intensity_scale'),
        'bulletinType': kw.get('bulletin_type') or '지진 발생정보',
        'url': kw['url'],
        'cancelled': bool(kw.get('cancelled', False)),
    }


def parse_kma(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError('KMA 응답 객체 형식 오류')
    wrapper = payload.get('response', payload)
    header = wrapper.get('header', {}) if isinstance(wrapper, dict) else {}
    if header:
        code = str(header.get('resultCode', '00'))
        if code not in ('00', '0', 'NORMAL_SERVICE', 'NORMAL SERVICE.'):
            raise ValueError(f'KMA 결과코드 {clean_text(code, 20)}')
    body = wrapper.get('body', {}) if isinstance(wrapper, dict) else {}
    items = body.get('items', {}) if isinstance(body, dict) else {}
    rows = items.get('item', []) if isinstance(items, dict) else items
    if rows is None:
        rows = []
    if isinstance(rows, dict):
        rows = [rows]
    if not isinstance(rows, list):
        raise ValueError('KMA 항목 목록 형식 오류')
    results = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        occurred = iso(parse_time(row.get('tmEqk')))
        if not occurred:
            continue
        lat = number(row.get('lat'), low=-90, high=90)
        lon = number(row.get('lon'), low=-180, high=180)
        mag = number(row.get('mt'), low=-2, high=10)
        depth = number(row.get('dep'), low=0, high=750)
        issue = str(row.get('tmFc') or 'unknown')
        seq = str(row.get('tmSeq') or i)
        agency_id = f'{issue}-{seq}-{str(row.get("tmEqk"))}'
        corrected = clean_text(row.get('cor'), 120)
        results.append(event(
            id=f'KMA:{agency_id}', source='KMA', agency_id=agency_id,
            occurred=occurred, reported=iso(parse_time(row.get('tmFc'))),
            lat=lat, lon=lon, depth=depth, mag=mag,
            location=clean_text(row.get('loc')) or '국내·외 지진',
            max_intensity=clean_text(row.get('inT'), 24) or None,
            intensity_scale='기상청 발표진도' if row.get('inT') not in (None, '') else None,
            bulletin_type='지진통보문' + (' · 정정' if corrected else ''),
            url=KMA_INFO,
        ))
    if rows and not results:
        raise ValueError('KMA 데이터 항목은 있지만 유효한 지진 발생시각이 없습니다. 응답 형식 확인 필요')
    return results


def parse_jma(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        payload = payload.get('data') or payload.get('list') or []
    if not isinstance(payload, list):
        raise ValueError('JMA 목록 배열 형식 오류')
    grouped: dict[str, list[dict[str, Any]]] = {}
    for i, r in enumerate(payload):
        if not isinstance(r, dict):
            continue
        agency_id = str(r.get('eid') or r.get('json') or f'row-{i}')
        grouped.setdefault(agency_id, []).append(r)
    results = []
    for agency_id, records in grouped.items():
        records.sort(key=lambda r: iso(parse_time(r.get('rdt') or r.get('ctt'))) or '', reverse=True)
        def first_field(key: str) -> Any:
            for item in records:
                if item.get(key) not in (None, ''):
                    return item[key]
            return None
        occurred = iso(parse_time(first_field('at')))
        if not occurred:
            continue
        lat, lon, depth = (None, None, None)
        for item in records:
            lat, lon, depth = jma_coordinate(item.get('cod'))
            if lat is not None and lon is not None:
                break
        title = clean_text(first_field('ttl'), 80)
        max_intensity = clean_text(first_field('maxi'), 12) or None
        if max_intensity:
            max_intensity = (max_intensity.replace('5-', '5약').replace('5+', '5강')
                             .replace('6-', '6약').replace('6+', '6강'))
        location = clean_text(first_field('anm') or first_field('en_anm'))
        results.append(event(
            id=f'JMA:{agency_id}', source='JMA', agency_id=agency_id,
            occurred=occurred, reported=iso(parse_time(first_field('rdt'))),
            lat=lat, lon=lon, depth=depth,
            mag=number(first_field('mag'), low=-2, high=10),
            location=location or '일본 지진', max_intensity=max_intensity,
            intensity_scale='JMA' if max_intensity else None,
            bulletin_type=title or '지진정보', url=JMA_INFO,
            cancelled=('取消' in title or '취소' in title),
        ))
    if payload and not results:
        raise ValueError('JMA 항목은 있지만 유효한 지진 발생시각이 없습니다. 응답 형식 확인 필요')
    return results


def parse_usgs(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get('features'), list):
        raise ValueError('USGS FeatureCollection 형식 오류')
    results = []
    for f in payload['features']:
        if not isinstance(f, dict):
            continue
        p = f.get('properties') or {}
        if p.get('type') not in (None, 'earthquake'):
            continue
        coords = (f.get('geometry') or {}).get('coordinates') or []
        lon = number(coords[0], low=-180, high=180) if len(coords) > 0 else None
        lat = number(coords[1], low=-90, high=90) if len(coords) > 1 else None
        depth = number(coords[2], low=0, high=800) if len(coords) > 2 else None
        occurred = iso(parse_time(p.get('time')))
        if not occurred:
            continue
        agency_id = str(f.get('id') or '')
        if not agency_id:
            continue
        remote_url = str(p.get('url') or '')
        if not remote_url.startswith('https://earthquake.usgs.gov/'):
            remote_url = 'https://earthquake.usgs.gov/earthquakes/map/'
        results.append(event(
            id=f'USGS:{agency_id}', source='USGS', agency_id=agency_id,
            occurred=occurred, reported=iso(parse_time(p.get('updated'))),
            lat=lat, lon=lon, depth=depth,
            mag=number(p.get('mag'), low=-2, high=10),
            location=clean_text(p.get('place')) or '전 세계 지진',
            max_intensity=None, intensity_scale=None,
            bulletin_type='지진 발생정보', url=remote_url,
        ))
    return results


def validate_events(events: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    cutoff = now - timedelta(days=LOOKBACK_DAYS)
    unique = {}
    for e in events:
        t = parse_time(e.get('occurredAt'))
        if not t or t < cutoff or t > now + timedelta(minutes=5):
            continue
        if not isinstance(e.get('source'), str):
            continue
        unique[e['id']] = e
    return sorted(unique.values(), key=lambda e: (e['occurredAt'], e['id']), reverse=True)[:2000]


def retrieve_kma(api_key: str, now: datetime) -> list[dict[str, Any]]:
    if not api_key:
        return []
    start = (now.astimezone(KST) - timedelta(days=LOOKBACK_DAYS)).strftime('%Y%m%d')
    end = now.astimezone(KST).strftime('%Y%m%d')
    all_rows = []
    for page in range(1, 5):
        query = urlencode({
            'pageNo': page, 'numOfRows': 100, 'dataType': 'JSON',
            'fromTmFc': start, 'toTmFc': end, 'authKey': api_key,
        })
        raw = get_json(f'{KMA_URL}?{query}')
        rows = parse_kma(raw)
        all_rows.extend(rows)
        body = raw.get('response', {}).get('body', {})
        total = number(body.get('totalCount'), low=0, high=999999) if isinstance(body, dict) else None
        if total is not None and page * 100 >= total:
            break
        if len(rows) == 0:
            break
    return all_rows


def build_snapshot(now: datetime, fetchers: dict[str, Any], kma_key: str = '') -> dict[str, Any]:
    all_events: list[dict[str, Any]] = []
    states: dict[str, Any] = {}
    for source in ('KMA', 'JMA', 'USGS'):
        checked = iso(utc_now())
        if source == 'KMA' and not kma_key:
            states[source] = {
                'state': 'unconfigured', 'checkedAt': checked, 'count': 0,
                'message': '기상청 API 키가 GitHub Secrets에 설정되지 않았습니다.'
            }
            continue
        try:
            rows = fetchers[source]()
            if not isinstance(rows, list):
                raise ValueError('자료 구조 오류')
            rows = validate_events(rows, now)
            all_events.extend(rows)
            states[source] = {
                'state': 'ok', 'checkedAt': checked, 'count': len(rows),
                'latestEventAt': rows[0]['occurredAt'] if rows else None,
                'message': '정상 수신' if rows else '정상 수신 · 조회 기간 중 발표자료 없음'
            }
        except Exception as exc:
            # Keep a sanitized error only, never secrets or full URLs.
            message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else '알 수 없는 자료 수신 오류'
            if 'authKey' in message or kma_key and kma_key in message:
                message = 'API 요청 실패'
            states[source] = {
                'state': 'error', 'checkedAt': checked, 'count': 0,
                'message': clean_text(message, 100)
            }
    events = validate_events(all_events, now)
    return {
        'schemaVersion': '1.0',
        'generatedAt': iso(now),
        'lookbackDays': LOOKBACK_DAYS,
        'sources': states,
        'events': events,
        'notice': '공식 기관의 발표 후 자료를 재게시합니다. 조기경보·지진 발생 전 예측 서비스가 아닙니다.'
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='site/data/events.json')
    args = ap.parse_args()
    key = os.environ.get('KMA_API_KEY', '').strip()
    now = utc_now()
    fetchers = {
        'KMA': lambda: retrieve_kma(key, now),
        'JMA': lambda: parse_jma(get_json(JMA_URL)),
        'USGS': lambda: parse_usgs(get_json(USGS_URL)),
    }
    snapshot = build_snapshot(now, fetchers, key)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for source, status in snapshot['sources'].items():
        print(f'{source}: {status["state"]}, {status["count"]}건, {status["message"]}')
    print(f'전체 {len(snapshot["events"])}건 / 출력 {output}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

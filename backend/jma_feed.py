"""P2PQuake 551 -> GEOQUAKE normalized event.

Source: P2PQuake JSON API v2. This is a third-party relay of Japan
Meteorological Agency information, NOT an official EEW delivery channel.
Only `points[].isArea == False` is treated as an observed station reading.
Never infer a region's measurement from magnitude, an area bulletin, or code 46.
"""
from datetime import datetime, timedelta, timezone
import math

JST = timezone(timedelta(hours=9))

# IDs correspond to original GEOQUAKE v0.8 simulation regions (JP-01..JP-47).
PREFECTURES = (
    '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県',
    '群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県',
    '山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府',
    '兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県',
    '徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県',
    '大分県','宮崎県','鹿児島県','沖縄県',
)

JMA_SCALE = {10:'1',20:'2',30:'3',40:'4',45:'5약',50:'5강',55:'6약',60:'6강',70:'7'}
BULLETIN_TYPES = {
    'ScalePrompt': '진도속보',
    'Destination': '진원정보',
    'ScaleAndDestination': '진도·진원정보',
    'DetailScale': '각 지역 진도정보',
    'Foreign': '원거리 지진정보',
    'Other': '기타 지진정보',
}


def prefecture_id(name):
    """Match official Japanese prefecture names, including Hokkaido subregions."""
    if not isinstance(name, str):
        return None
    clean = name.strip().replace(' ', '').replace('　', '')
    for i, pref in enumerate(PREFECTURES, 1):
        if clean == pref or clean.startswith(pref):
            return f'JP-{i:02d}'
    return None


def jst_to_utc(value):
    """P2PQuake unzoned YYYY/MM/DD HH:MM:SS[.sss] strings are in JST."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.replace('/', '-').replace(' ', 'T'))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=JST)
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def finite_num(value, low, high):
    if value is None or isinstance(value, bool) or value == '':
        return None
    try:
        num = float(value)
    except (ValueError, TypeError, OverflowError):
        return None
    return num if math.isfinite(num) and low <= num <= high else None


def jma_scale(value):
    """Uncertain 46 ('at least 5-lower') and -1 are NOT exact observations."""
    if isinstance(value, bool):
        return None
    try:
        code = int(value)
        if float(value) != code:
            return None
    except (ValueError, TypeError, OverflowError):
        return None
    return JMA_SCALE.get(code)


def scale_code(value):
    label = jma_scale(value)
    if label is None:
        return None
    return int(value)


def parse_jma_551(message, *, ingest_mode='stream'):
    """Parse one 551 bulletin. Return None for invalid/unrelated payloads.

    A 551 message ID identifies a bulletin, not necessarily a unique earthquake.
    The UI retains separate releases; it never fabricates an official alert.
    """
    if not isinstance(message, dict) or message.get('code') != 551:
        return None
    bulletin_id = message.get('id')
    if not isinstance(bulletin_id, str) or not (1 <= len(bulletin_id) <= 100):
        return None
    earthquake = message.get('earthquake')
    issue = message.get('issue')
    if not isinstance(earthquake, dict) or not isinstance(issue, dict):
        return None
    occurred_at = jst_to_utc(earthquake.get('time'))
    if not occurred_at:
        return None
    hypo = earthquake.get('hypocenter')
    hypo = hypo if isinstance(hypo, dict) else {}
    lat = finite_num(hypo.get('latitude'), -90, 90)
    lon = finite_num(hypo.get('longitude'), -180, 180)
    if (lat is None) != (lon is None):
        lat, lon = None, None
    depth = finite_num(hypo.get('depth'), 0, 700)
    mag = finite_num(hypo.get('magnitude'), 0, 10)
    max_intensity = jma_scale(earthquake.get('maxScale'))

    # Collect MAXIMUM *station-measured* code per prefecture; area summary is
    # a different kind of announcement and is deliberately NOT promoted.
    region_max = {}
    region_counts = {}
    area_max = {}
    uncertain = set()
    points = message.get('points')
    points = points if isinstance(points, list) else []
    for point in points[:2500]:
        if not isinstance(point, dict):
            continue
        region = prefecture_id(point.get('pref'))
        if not region:
            continue
        code = scale_code(point.get('scale'))
        if code is None:
            if point.get('scale') == 46:
                uncertain.add(region)
            continue
        if point.get('isArea') is True:
            area_max[region] = max(code, area_max.get(region, 0))
        elif point.get('isArea') is False:
            region_max[region] = max(code, region_max.get(region, 0))
            region_counts[region] = region_counts.get(region, 0) + 1

    observed = {id: {
        'value': JMA_SCALE[code], 'scale': 'JMA', 'kind': 'station-max',
        'stationCount': region_counts[id],
    } for id, code in sorted(region_max.items())}
    areas = {id: {'value': JMA_SCALE[code], 'kind': 'reported-area'}
             for id, code in sorted(area_max.items())}

    itype = issue.get('type') if isinstance(issue.get('type'), str) else 'Other'
    name = hypo.get('name')
    when = jst_to_utc(issue.get('time'))
    relay_at = jst_to_utc(message.get('time'))
    corrected = issue.get('correct') if isinstance(issue.get('correct'), str) else None
    return {
        'id': 'JMA:' + bulletin_id,
        'source': 'JMA',
        'agencyEventId': bulletin_id,
        'relay': 'P2PQuake',
        'occurredAt': occurred_at,
        'reportedAt': when,
        'updatedAt': relay_at or when,
        'relayReceivedAt': relay_at,
        'latitude': lat, 'longitude': lon,
        'depthKm': depth, 'magnitude': mag,
        'location': (name.strip() if isinstance(name, str) and name.strip() else '진앙 미제공')[:160],
        'maxIntensity': max_intensity,
        'intensityScale': 'JMA',
        'bulletinType': BULLETIN_TYPES.get(itype, '지진 발생정보'),
        'bulletinTypeCode': itype,
        'correctionType': corrected,
        'url': 'https://www.jma.go.jp/bosai/quake/',
        'cancelled': False,
        'observationsVerified': bool(observed),
        'observedRegions': observed,
        'reportedAreas': areas,
        'uncertainRegions': sorted(uncertain),
        'observedStationCount': sum(region_counts.values()),
        'ingestMode': ingest_mode,
        'notice': 'P2PQuake 중계 JMA 551 · 도도부현 색은 관측점 최고진도(현 전체 진도 아님)'
    }

"""KMA API Hub getEqkMsg (published earthquake bulletins, NOT an EEW stream).

KMA fields from https://apihub.kma.go.kr/apiList.do?seqApi=7:
 tmFc/tmSeq/fcTp/stnId/cnt, tmEqk/tmMsc, lat/lon, loc/mt/dep/inT/rem/cor.
The endpoint returns KST-based bulletin/origin times and needs a secret authKey.

Do not infer regional observed intensities from inT. No 'alert issued' flag is
fabricated from historical earthquake bulletins. A correction is kept as its
own published bulletin, but not automatically treated as an earthquake alarm.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
import unicodedata

KST = timezone(timedelta(hours=9))
KMA_URL = 'https://apihub.kma.go.kr/api/typ02/openApi/EqkInfoService/getEqkMsg'
KMA_INFO_URL = 'https://apihub.kma.go.kr/apiList.do?seqApi=7'
PAGE_SIZE = 100
MAX_PAGES = 20
MAX_RESPONSE_BYTES = 2_000_000


class KMAResponseError(ValueError):
    """Provider schema or response error; never attach a secret URL to message."""


def finite_num(value, low=-math.inf, high=math.inf):
    if value is None or isinstance(value, bool) or str(value).strip() in ('', '-', 'null', 'None'):
        return None
    try:
        number = float(str(value).strip())
        return number if math.isfinite(number) and low <= number <= high else None
    except (ValueError, TypeError, OverflowError):
        return None


def kst_timestamp(value):
    """KMA tmFc is YYYYMMDD[HHMM]; tmEqk typically YYYYMMDDHHMMSS.

    Also accept hyphenated ISO forms for API format changes. Convert to UTC Z.
    A missing time remains None rather than using receipt time.
    """
    if value is None or isinstance(value, bool):
        return None
    raw = str(value).strip()
    if not raw:
        return None
    try:
        if re.fullmatch(r'\d{8}(\d{4})?(\d{2})?', raw):
            fmt = {8:'%Y%m%d', 12:'%Y%m%d%H%M', 14:'%Y%m%d%H%M%S'}[len(raw)]
            parsed = datetime.strptime(raw, fmt).replace(tzinfo=KST)
        else:
            parsed = datetime.fromisoformat(raw.replace(' ', 'T').replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=KST)
        return parsed.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00','Z')
    except ValueError:
        return None


def text_field(raw, limit=160):
    if raw is None or isinstance(raw, (list, dict)):
        return None
    value = str(raw).strip()
    return value[:limit] if value and value.lower() not in ('none', 'null', '-') else None


def _records_from_body(body):
    if not isinstance(body, dict):
        raise KMAResponseError('KMA response.body missing')
    items = body.get('items')
    if items is None:
        out = []
    elif isinstance(items, list):
        out = items
    elif isinstance(items, dict):
        data = items.get('item', [])
        if data is None:
            out = []
        elif isinstance(data, list):
            out = data
        elif isinstance(data, dict):
            out = [data]
        else:
            raise KMAResponseError('KMA items.item invalid')
    else:
        raise KMAResponseError('KMA items shape invalid')
    if 'totalCount' not in body:
        raise KMAResponseError('KMA totalCount absent')
    total = body['totalCount']
    try:
        if isinstance(total, bool):
            raise ValueError()
        total_int = int(total)
    except (ValueError, TypeError):
        raise KMAResponseError('KMA totalCount invalid') from None
    if total_int < 0 or total_int < len(out):
        raise KMAResponseError('KMA totalCount inconsistent')
    return out, total_int


def parse_kma_page(payload):
    """Return (rows, totalCount). Result code 03 means no announcements.

    A successful HTTP status does not guarantee a successful API response.
    """
    if not isinstance(payload, dict):
        raise KMAResponseError('KMA JSON root invalid')
    resp = payload.get('response')
    if not isinstance(resp, dict) or not isinstance(resp.get('header'), dict):
        raise KMAResponseError('KMA response/header absent')
    result_code = str(resp['header'].get('resultCode', '')).strip()
    if result_code == '03':
        return [], 0
    if result_code != '00':
        raise KMAResponseError('KMA API resultCode=' + result_code[:12])
    return _records_from_body(resp.get('body'))


# Only accept explicitly paired intensity/region groups. A bare maximum does
# not identify the province in which it was recorded.
KMA_REGIONS = {
    '서울':'KR-11', '부산':'KR-26', '대구':'KR-27', '인천':'KR-28',
    '광주':'KR-29', '대전':'KR-30', '울산':'KR-31', '세종':'KR-50',
    '경기':'KR-41', '강원':'KR-42', '충북':'KR-43', '충남':'KR-44',
    '전북':'KR-45', '전남':'KR-46', '경북':'KR-47', '경남':'KR-48', '제주':'KR-49',
}
ROMAN = {'I':1,'II':2,'III':3,'IV':4,'V':5,'VI':6,'VII':7,'VIII':8,'IX':9,'X':10,'XI':11,'XII':12}

def parse_kma_regions(value):
    if not isinstance(value, str):
        return {}
    text = unicodedata.normalize('NFKC', value).upper()
    # Restrict matching to bounded, explicit groups; do not infer from a place name.
    pattern = r'(?<![A-Z])(XII|XI|VIII|VII|III|IX|IV|VI|II|X|V|I)\s*(?:\(([^()]{1,120})\)|[:：]\s*([^()]+?)(?=\s*[,;，]?\s*(?:XII|XI|VIII|VII|III|IX|IV|VI|II|X|V|I)\s*[:：(]|$))'
    out = {}
    for match in re.finditer(pattern, text):
        level = ROMAN[match.group(1)]
        names = (match.group(2) or match.group(3)).strip()
        for name in re.split(r'[,，·ㆍ/\s]+', names):
            region = KMA_REGIONS.get(name)
            if region:
                out[region] = {'value': str(level), 'scale':'KMA', 'kind':'reported-area'}
    return out


def parse_kma_json(response):
    # Some providers omit or mislabel their charset. Never replace undecodable
    # bytes: that would silently corrupt place names and warning text.
    raw = response.content
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            return json.loads(raw.decode(encoding))
        except (UnicodeError, json.JSONDecodeError):
            continue
    raise KMAResponseError('KMA invalid JSON encoding')

def parse_kma_bulletin(row):
    """Normalize an official KMA announcement; keep unavailable values as null."""
    if not isinstance(row, dict):
        return None
    report_raw = text_field(row.get('tmFc'), 35)
    origin_raw = text_field(row.get('tmEqk'), 35)
    reported = kst_timestamp(report_raw)
    occurred = kst_timestamp(origin_raw)
    if not reported or not occurred:
        return None
    lat = finite_num(row.get('lat'), -90, 90)
    lon = finite_num(row.get('lon'), -180, 180)
    if (lat is None) != (lon is None):
        lat, lon = None, None
    depth = finite_num(row.get('dep'), 0, 700)
    magnitude = finite_num(row.get('mt'), -2, 10)
    correction = text_field(row.get('cor'), 320)
    # Separate a correction bulletin without claiming it is a new earthquake.
    key_fields = ['tmFc', 'tmSeq', 'stnId', 'fcTp', 'cnt', 'tmEqk', 'cor']
    parts = [text_field(row.get(k), 160) for k in key_fields]
    fingerprint = hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(',',':')).encode()).hexdigest()[:24]
    prefix = f'{report_raw}-{text_field(row.get("tmSeq"), 16) or "NA"}'
    report_id = f'{prefix}-{fingerprint}'
    # inT is sometimes a textual maximum-intensity summary, not a region/station grid.
    max_intensity = text_field(row.get('inT'), 160)
    kind = text_field(row.get('fcTp'), 32)
    ref_no = text_field(row.get('cnt'), 32)
    return {
        'id': 'KMA:' + fingerprint,
        'source': 'KMA', 'agencyEventId': report_id,
        'occurredAt': occurred, 'reportedAt': reported, 'updatedAt': reported,
        'latitude': lat, 'longitude': lon, 'depthKm': depth,
        'magnitude': magnitude, 'location': text_field(row.get('loc'),160) or '진앙 미제공',
        'maxIntensity': max_intensity, 'intensityScale': 'KMA',
        'bulletinType': '기상청 지진통보' + (f' ({kind})' if kind else ''),
        'bulletinTypeCode': kind, 'referenceNo': ref_no,
        'correctionType': correction, 'remarks': text_field(row.get('rem'), 320),
        'observationsVerified': False, 'observedRegions': {},
        'reportedAreas': parse_kma_regions(max_intensity), 'url': KMA_INFO_URL,
        'cancelled': False, 'ingestMode': 'history',
        'notice': '기상청 공식 발표 후 지진통보문 · inT가 있어도 개별 지역의 실제 관측진도는 별도 제공 필요',
    }


async def fetch_kma_bulletins(client, auth_key, *, current_time=None):
    """Retrieve KMA bulletin messages over a short KST window.

    Pagination is bounded; never silently present partial pages as success.
    The raw authKey is passed only as an HTTPS query parameter to KMA.
    """
    if not isinstance(auth_key, str) or not auth_key.strip():
        raise KMAResponseError('KMA key is not configured')
    current = (current_time or datetime.now(timezone.utc)).astimezone(KST)
    params = {
        'pageNo': 1, 'numOfRows': PAGE_SIZE, 'dataType': 'JSON',
        'fromTmFc': (current - timedelta(days=1)).strftime('%Y%m%d'),
        'toTmFc': current.strftime('%Y%m%d'), 'authKey': auth_key.strip()
    }
    all_rows, expected = [], None
    for page in range(1, MAX_PAGES + 1):
        params['pageNo'] = page
        response = await client.get(KMA_URL, params=params)
        response.raise_for_status()
        if len(response.content) > MAX_RESPONSE_BYTES:
            raise KMAResponseError('KMA response too large')
        try:
            rows, total = parse_kma_page(parse_kma_json(response))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise KMAResponseError('KMA invalid JSON') from exc
        if expected is None:
            expected = total
        if expected != total and total > len(all_rows):
            # Announcements can be issued mid-pagination. Restart next poll.
            raise KMAResponseError('KMA pagination changed while reading')
        if not rows and expected > len(all_rows):
            raise KMAResponseError('KMA pagination missing records')
        all_rows.extend(rows)
        if len(all_rows) >= expected:
            break
    if expected is None or len(all_rows) < expected:
        raise KMAResponseError('KMA results incomplete')
    results = {}
    for row in all_rows:
        event = parse_kma_bulletin(row)
        if event is not None:
            results[event['id']] = event
    if all_rows and not results:
        raise KMAResponseError('KMA items present but unparseable')
    return list(results.values()), len(all_rows)

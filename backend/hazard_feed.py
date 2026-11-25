"""Public disaster bulletins. An unavailable feed never means no warning."""
from datetime import datetime, timezone
from jma_feed import jst_to_utc
from kma_feed import parse_kma_page, kst_timestamp, text_field
import xml.etree.ElementTree as ET

VOLCANO_URL = 'https://www.jma.go.jp/bosai/volcano/data/warning.json'
TSUNAMI_URL = 'https://api.p2pquake.net/v2/history'

VOLCANO_NAMES = {'硫黄島':'이오섬','薩摩硫黄島':'사쓰마 이오지마','福徳岡ノ場':'후쿠토쿠오카노바','桜島':'사쿠라지마','諏訪之瀬島':'스와노세섬','須美寿島':'스미스섬','霧島山（新燃岳）':'기리시마산(신모에다케)','阿蘇山':'아소산','西之島':'니시노시마','北海道駒ヶ岳':'홋카이도 고마가타케','十勝岳':'도카치다케','雌阿寒岳':'메아칸다케'}
VOLCANO_CODES = {'11':'분화 예보 · 경계 레벨 1','12':'분화 경보 · 경계 레벨 2','13':'분화 경보 · 경계 레벨 3','14':'분화 경보 · 경계 레벨 4','15':'분화 경보 · 경계 레벨 5','22':'화구 주변 위험','23':'입산 위험','24':'산기슭 엄중 경계','25':'거주 지역 엄중 경계','35':'해저 화산에 유의','36':'주변 해역 경계'}
TSUNAMI_GRADES = {'MajorWarning':'대형 지진해일 경보','Warning':'지진해일 경보','Watch':'지진해일 주의보','Unknown':'발표 수준 미확인'}

def volcano_reports(payload):
    if not isinstance(payload, list):
        raise ValueError('volcano list invalid')
    out = []
    for row in payload[:300]:
        if not isinstance(row, dict) or not isinstance(row.get('volcanoInfos'), list):
            raise ValueError('volcano record invalid')
        target = next((i for i in row['volcanoInfos'] if isinstance(i, dict) and i.get('type') == '噴火警報・予報（対象火山）'), None)
        if not target or not isinstance(target.get('items'), list):
            raise ValueError('volcano target invalid')
        for item in target['items']:
            if not isinstance(item, dict) or not isinstance(item.get('areas'), list):
                raise ValueError('volcano area invalid')
            code = str(item.get('code', ''))
            for area in item['areas']:
                if not isinstance(area, dict) or not area.get('name'):
                    raise ValueError('volcano name invalid')
                raw = str(area['name'])[:100]
                out.append({'id': str(row.get('eventId','')), 'name': VOLCANO_NAMES.get(raw, raw+' (원문)'),
                    'level': VOLCANO_CODES.get(code, '수준 확인 필요 · 원문 '+str(item.get('name',''))[:100]),
                    'issuedAt': row.get('reportDatetime'), 'source':'JMA', 'url':'https://www.jma.go.jp/bosai/volcano/'})
    return out

def tsunami_reports(payload):
    if not isinstance(payload, list):
        raise ValueError('tsunami list invalid')
    out=[]
    for row in payload[:20]:
        if not isinstance(row, dict) or row.get('code') != 552 or not isinstance(row.get('issue'), dict) or not isinstance(row.get('cancelled'), bool):
            raise ValueError('tsunami record invalid')
        areas=row.get('areas', [])
        if not isinstance(areas, list): raise ValueError('tsunami areas invalid')
        out.append({'id':str(row.get('id',''))[:100], 'issuedAt':jst_to_utc(row['issue'].get('time')),
            'cancelled':row['cancelled'], 'areas':[{'name':str(a.get('name',''))[:100], 'level':TSUNAMI_GRADES.get(a.get('grade'),'발표 수준 미확인')} for a in areas if isinstance(a,dict)],
            'source':'JMA · P2PQuake 중계','url':'https://www.jma.go.jp/bosai/tsunami/'})
    return out

KMA_TSUNAMI_URL = 'https://apihub.kma.go.kr/api/typ02/openApi/EqkInfoService/getTsunamiMsg'
KMA_VOLCANO_URL = 'https://apihub.kma.go.kr/api/typ09/url/volc/selectVolcInfoList.do'

def kma_tsunami_reports(payload):
    rows,total=parse_kma_page(payload)
    if total>len(rows): raise ValueError('incomplete KMA tsunami page')
    out=[]
    for row in rows:
        if not isinstance(row,dict): raise ValueError('invalid KMA tsunami row')
        issued=kst_timestamp(row.get('tmFc'))
        if not issued: raise ValueError('missing tsunami issue time')
        out.append({'id':str(row.get('cnt') or '')+'-'+issued,'issuedAt':issued,
                    'title':text_field(row.get('fcTp'),80) or '지진해일 통보',
                    'area':text_field(row.get('reg'),500), 'body':text_field(row.get('ann'),2000),
                    'remarks':text_field(row.get('rem'),1000)})
    return out

def kma_volcano_reports(raw):
    if not isinstance(raw,bytes) or len(raw)>2_000_000 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
        raise ValueError('invalid volcano XML')
    root=ET.fromstring(raw)
    records=[]
    for parent in root.iter():
        fields={child.tag.split('}')[-1]: (child.text or '').strip() for child in parent}
        if 'volcName' not in fields: continue
        name=fields.get('volcName');issued=kst_timestamp(fields.get('tmIssue'))
        if not name or not issued: raise ValueError('invalid volcano record')
        records.append({'id':name+'-'+issued,'name':name[:160],'issuedAt':issued,
                        'title':(fields.get('msgCode') or '화산정보')[:120],
                        'area':fields.get('wrnLoc','')[:500], 'release':fields.get('release','')[:500]})
    # Without an independently documented empty XML envelope, unknown shapes
    # are an error rather than a false all-clear.
    if not records: raise ValueError('KMA volcano XML has no recognizable records')
    return records[:100]

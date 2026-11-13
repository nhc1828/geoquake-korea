# API 사용법과 인증키 발급 가이드

작성 기준일: 2026-11-13. 연결 조건과 이용약관은 기관 정책에 따라 변경될 수 있습니다.

## 1. 한국 기상청(KMA) — 인증키 필요

### 키 발급 순서

1. **[기상청 API허브](https://apihub.kma.go.kr/main.do)**에 접속해 회원가입 및 로그인합니다.
2. **[지진/화산 API](https://apihub.kma.go.kr/apiList.do?seqApi=7)**를 열고 **국내·외 지진정보 → 지진통보문 조회(3.2)** 서비스의 *API 활용신청*을 진행합니다. 사용 목적에는 학교 프로젝트의 지진 발생정보 모니터링 등을 명시할 수 있습니다.
3. 로그인 후 **마이페이지**에서 본인의 인증키(`authKey`)를 확인합니다. 키 사용권·서비스별 승인 여부는 API허브 화면에 표시된 내용을 따릅니다.
4. GitHub 저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 다음과 같이 저장합니다.

   - **Name:** `KMA_API_KEY`
   - **Secret:** 마이페이지에서 확인한 본인의 인증키 원문

5. GitHub Actions에서 **Run workflow**를 실행하고 KMA가 `ok`인지 확인합니다. 등록 후에도 `HTTP 401/403`, 인증 실패 등의 상태가 보인다면 API 활용신청과 승인 상태를 확인합니다.

**주의:** `site/index.html`, `site/assets/app.js`, `site/data/events.json`, README, Git 커밋 등에 실제 키를 붙여넣지 않습니다. GitHub Secrets에 들어간 키만 서버 측 GitHub Actions 실행 중에 환경변수로 사용합니다. KMA 키는 필요한 API요청의 URL 매개변수로 전송되며 출력 파일에는 저장하지 않습니다.

### 이번 프로젝트에서 사용하는 공식 API

- 경로: `https://apihub.kma.go.kr/api/typ02/openApi/EqkInfoService/getEqkMsg`
- 방식: `GET`
- 인증: 쿼리 매개변수 `authKey`
- 설정: `pageNo=1`, `numOfRows=100`, `dataType=JSON`, `fromTmFc`, `toTmFc`
- 결과: `response.header.resultCode`, `response.body.items.item` 구조의 응답을 처리하도록 구현했습니다. 실제 응답 구조가 서비스별 설정에 따라 다른 경우 파서 수정이 필요할 수 있습니다.

매개변수 예시(키는 **자리표시자**이며 실제로 넣지 않습니다):

```text
GET https://apihub.kma.go.kr/api/typ02/openApi/EqkInfoService/getEqkMsg
    ?pageNo=1
    &numOfRows=100
    &dataType=JSON
    &fromTmFc=20261107
    &toTmFc=20261113
    &authKey=<내-인증키>
```

주요 필드:

| 응답 필드 | 의미 | 웹앱 저장 필드 |
|---|---|---|
| `tmEqk` | 진앙시·지진 발생시각 (KST) | `occurredAt` (UTC ISO8601) |
| `tmFc` | 발표시각 (KST) | `reportedAt` (UTC ISO8601) |
| `tmSeq` | 발표 일련번호 | `agencyEventId` 일부 |
| `lat`, `lon` | 진앙 위도·경도 | `latitude`, `longitude` |
| `mt` | 규모 | `magnitude` |
| `dep` | 깊이(km) | `depthKm` |
| `loc` | 발생 위치 | `location` |
| `inT` | 발표 진도 | `maxIntensity` |
| `cor` | 수정사항 | 발표 종류 표시 |

**주의:** KMA가 최근 지진을 공개하는 것과 **초 단위로 전송되는 긴급지진속보를 직접 수신하는 것**은 다릅니다. 공식 API에는 `msgCode=111` 등 여러 발표코드를 제공하는 별도 조회도 있지만, 이 프로젝트는 우선 발표자료 조회에 한정합니다. 새로 수집된 정보는 실시간 공식 대피경보가 아닙니다.

참고 문서: [API 이용안내](https://apihub.kma.go.kr/apiInfo.do), [지진 API 상세](https://apihub.kma.go.kr/apiList.do?seqApi=7)

## 2. 일본 기상청(JMA) — 공개 JSON (키 불필요)

```text
GET https://www.jma.go.jp/bosai/quake/data/list.json
```

JMA 지진정보 웹사이트의 공개 JSON 목록을 읽습니다. 이것은 공식 웹사이트 데이터이지만 별도로 유지·보장을 약속한 개발자 API가 아니므로 URL/형식 변경 가능성이 있습니다. 이번 버전은 GitHub Actions의 서버에서 요청하므로 브라우저 CORS에 의존하지 않습니다.

중요 필드:

| 원본 필드 | 의미 | 참고 |
|---|---|---|
| `eid` | JMA 지진 사건 ID | 동일 사건의 복수 발표 그룹화 |
| `at` | 지진 발생시각 | 보통 ISO 8601, `+09:00` |
| `rdt` | 발표시각 | 최신 발표 판단 |
| `anm`, `en_anm` | 일본어/영어 진앙 지명 | 기본은 JMA 지명 그대로 |
| `cod` | ISO 6709 형식 진앙·고도 | 위경도 및 진원 깊이 파싱 |
| `mag` | 규모 | 숫자로 변환, 없으면 `null` |
| `maxi` | 최대 관측진도 | `5-`→`5약`, `5+`→`5강` |
| `ttl` | 발표종류 | 발생정보/진도정보 등 |

`cod`의 예시는 다음과 같습니다.

```text
+36.7+140.7-10000/       → 36.7°N, 140.7°E, 깊이 10km
+3606.2+13959.5-48000/  → 36° 6.2′N, 139° 59.5′E, 깊이 48km
```

JMA의 `maxi`는 일본 기상청의 진도 등급이고 KMA 계기진도·MMI와 임의 환산하지 않습니다. `eid`별 보고가 중복되면 최신 보고의 필드를 우선하되 부족한 좌표·규모는 기존 보고에서 보완합니다.

JMA 공개정보와 [콘텐츠 이용조건](https://www.jma.go.jp/jma/kishou/info/coment.html)에 따라 출처를 표기합니다. 지진속보·경보의 고신뢰·초저지연 원문 배신은 별도의 제공 방식과 이용조건을 확인해야 합니다.

## 3. 미국 지질조사국(USGS) — 공식 API (키 불필요)

이번 프로젝트:

```text
GET https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson
```

최근 7일 규모 2.5 이상 GeoJSON을 사용합니다. 수집 기간은 화면의 날짜 기준과 같지만 기관별 분석·발표 범위는 같지 않습니다.

```js
// 공식 GeoJSON 결과에서 주로 사용하는 구조
{
  "features": [
    {
      "id": "기관 고유 사건 ID",
      "properties": {
        "mag": 4.6,
        "place": "발생 지역",
        "time": 1609459200000,
        "updated": 1609459260000,
        "url": "https://earthquake.usgs.gov/..."
      },
      "geometry": {"type": "Point", "coordinates": [130.5, 35.5, 22]}
    }
  ]
}
```

이것은 필드 형식을 설명하는 **가상의 구조 예시**로 실제 지진 발표가 아닙니다. `coordinates` 순서는 반드시 **경도, 위도, 깊이(km)**입니다. `time`·`updated`는 Unix milliseconds를 UTC 시간으로 변환해야 합니다.

USGS 공식 피드는 대략 1분마다 갱신되지만, 이번 GitHub Pages 버전의 **표시 데이터**는 Actions가 가져와 재배포하는 시점에만 바뀝니다.

참고: [USGS GeoJSON 공식 문서](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)

## 4. 통합 데이터 형식

모든 기관 데이터는 아래 형태로 통합합니다.

```json
{
  "id": "JMA:<원본사건ID>",
  "source": "JMA",
  "agencyEventId": "<원본사건ID>",
  "occurredAt": "2026-11-13T00:00:00Z",
  "reportedAt": "2026-11-13T00:02:00Z",
  "latitude": 35.6,
  "longitude": 139.7,
  "depthKm": 20,
  "magnitude": 4.2,
  "location": "일본 발표 지명",
  "maxIntensity": "3",
  "intensityScale": "JMA",
  "bulletinType": "지진정보",
  "url": "https://www.jma.go.jp/bosai/quake/",
  "cancelled": false
}
```

**위 JSON은 설명용 임의 예시입니다. 실제 지진 기록으로 표시하지 않습니다.** `magnitude`, `depthKm`, `latitude`, `longitude`, `maxIntensity`는 자료가 제공되지 않을 때 `null`입니다. 값이 없다고 `0`으로 바꾸면 안 됩니다.

조회 상태는 각 기관별 `ok`, `unconfigured`, `error`, `pending`으로 구분하며, 프런트엔드는 발행 시간이 25분을 넘으면 `자료 오래됨` 상태를 표시합니다. KMA/JMA/USGS의 사건 ID는 서로 다른 체계이며, **기관 간 같은 지진을 자동으로 하나라고 단정하지 않습니다.**

# GEOQUAKE KOREA — 지진 관측정보 모니터링 웹앱

한국 기상청(KMA), 일본 기상청(JMA), 미국 지질조사국(USGS)의 **지진 발생 후 발표정보**를 통합하는 교육용 프로젝트입니다. 공식 재난경보 또는 지진 발생 전 예측 서비스가 아닙니다.

## 접속 주소

- **웹앱:** https://nhc1828.github.io/geoquake-korea/
- **시뮬레이션 실험실:** https://nhc1828.github.io/geoquake-korea/lab/
- **Railway 서버 상태:** https://geoquake-korea-server-production.up.railway.app/health
- **실제 지진 데이터 JSON:** https://geoquake-korea-server-production.up.railway.app/api/events

## 현재 구축 상태 (3단계)

| 부분 | 상태 |
|---|---|
| GitHub Pages | 메인 웹앱 및 원본 실험실 배포 |
| Railway | FastAPI 서버 상시 실행 |
| USGS | 최근 7일 M2.5 이상 자료를 약 60초마다 수집 |
| WebSocket | `/ws`로 서버 수신 자료를 브라우저에 전달 (연결 시) |
| HTTP 보완 | 연결 장애 대비 메인 화면에서 60초마다 `/api/events` 조회 |
| KMA 및 JMA | 아직 연결되지 않음 (추후 단계) |

## 저장소 폴더

```text
.github/workflows/geoquake-pages.yml   GitHub Pages 정적 배포
site/index.html                        메인 화면
site/assets/app.js                     Railway API/WebSocket 수신 및 지도·필터·알림
site/assets/style.css                  화면 스타일
site/data/base_geometry.json          지도 대체 데이터
site/lab/index.html                    기존 GEOQUAKE v0.8 실험실, 변경 없이 보존
backend/main.py                        Railway 서버 (USGS 수집, HTTP, WebSocket)
backend/requirements.txt               Python 의존성
scripts/                                이전 수집기 코드 (현재 배포에서 미사용)
```

## 배포 설명

1. `site/` 하위 파일이 수정되면 `.github/workflows/geoquake-pages.yml`가 GitHub Pages를 배포합니다.
2. `backend/`가 수정되면 Railway가 연결된 `main` 브랜치의 `/backend` 디렉터리를 빌드하도록 설정합니다.
3. Railway 앱은 `python main.py`로 실행하고, 서비스 도메인의 대상 포트가 Uvicorn의 실제 수신 포트와 일치해야 합니다.
4. GitHub Pages 화면이 1분마다 HTTP로 최신 자료를 확인하는 동시에 WebSocket을 통해 새로운 발표를 수신합니다.
5. 초 단위 **화면 전송**은 가능하더라도 원본 USGS 피드는 약 1분 단위로 갱신됩니다. 단독 대피경보로 사용하지 않습니다.

### 문제 확인

- `/health`의 `service: ok`: 서버 실행 성공
- `/health`의 `usgs: ok`: 외부 USGS 수신 성공
- `/api/events`의 `sources.USGS.state: ok`: 실제 자료가 수집된 상태
- 화면의 `연결 대기`: 자료원이 아직 연결되지 않았거나 상태를 확인하지 못한 경우
- `KMA`, `JMA`의 `pending`: 아직 수집기를 연결하지 않았으므로 정상

앞으로 **JMA 자료 → KMA 인증키 → 기관 간 지진 중복 식별 및 시각화** 순서로 기능을 추가합니다.

## 화산·지진해일 지도와 실험실

실시간 지도에 일본 기상청의 화산 발표를 삼각형으로 표시하며, 표식을 누르면 명칭·발표 수준·시각을 볼 수 있습니다. 기상청 발표에서 좌표가 제공되지 않으므로 일본 기상청 화산 목록의 코드와 일치하는 좌표를 사용합니다. 한국 기상청 발표는 위치를 확실히 확인한 경우에만 지도에 표시합니다. 킬라우에아 정상 좌표는 미국 지질조사국(USGS)의 자료를 사용합니다. 좌표를 확인하지 못한 화산은 발표 목록에서 확인해야 합니다.

일본 지진해일은 P2PQuake가 중계하는 최근 발표 이력 중 최신 발표가 해제가 아니고 24시간 이내이며 일본 기상청 예보구역과 이름이 정확히 일치하는 구역만 해안선에 표시합니다. 이 방식은 발효 상태를 확정하지 못하며, 데이터 오류·해제·오래된 발표·구역 불일치 시 지도가 비어 있을 수 있습니다. 빈 지도는 안전하거나 해제되었다는 뜻이 아닙니다. 한국 기상청 지진해일 자료는 발표 이력만 제공되어 현행 구역별 발효 상태를 확정할 수 없으므로 목록에 표시하며 지도에 임의 채색하지 않습니다. 현재 상태와 대피 정보는 각 기관의 원문을 확인해야 합니다.

실험실의 지진해일 모의 경보는 한반도·일본 주변 바다, M 6.5 이상, 깊이 100 km 이하를 **시연 시작 조건**으로 사용합니다. 이는 공식 발령 기준이 아닙니다. 간략 지도의 0.25도 격자에서 육지를 통과하지 않는 해상 경로를 구하고 지역별 가장 가까운 해상 경로를 기준으로 지역 전체 해안선을 색칠합니다. 격자보다 좁은 해협과 작은 섬은 누락될 수 있으며, 한국 연안은 동·남·서로 단순 구분합니다.

파고는 사용자가 정한 100 km 기준 가상 파고 또는 규모·깊이로 만든 임의의 가상값을 거리의 제곱근과 지수함수로 감소시킨 값입니다. 해저 단층·수심·지형·굴절·파랑 중첩·침수 등을 계산하지 않아 실제 파고나 도달시간이 아닙니다. 이 **가상 파고를 분류할 때만** 일본 기상청의 구분을 적용합니다: 0.2 m 이상~1 m 이하 주의보(노랑), 1 m 초과~3 m 이하 경보(빨강), 3 m 초과 대지진해일 경보(보라). [일본 기상청의 공식 구분](https://www.data.jma.go.jp/suishin/shiyou/pdf/no40301).

화산 분화 실험은 진앙 좌표와 VEI 0–8, 화산재가 향하는 가상 바람 방향을 사용합니다. 모의 화산 경보와 화산성 지진을 표시하고, 화구 주변의 임의 근거리 피해 원과 선택 방향의 임의 화산재 타원에 들어간 한국·일본 등록 대표지점을 나열합니다. VEI별 반경·가상 지진 규모와 타원은 시연을 위해 정한 값으로 실제 화산재 확산, 화쇄류, 용암류, 피해 또는 공식 특보를 예측하지 않습니다. 대표지점만 검사하므로 지역 전체의 영향 여부도 판단할 수 없습니다.

지도 자료: [일본 기상청 화산 목록](https://www.jma.go.jp/bosai/volcano/const/volcano_list.json), [일본 기상청 지진해일 예보구역 GIS](https://www.data.jma.go.jp/developer/gis.html) (축소·좌표 반올림·일부 작은 선 제거, 국토지리원 승인번호 평30정사 제401호 등), [USGS 킬라우에아 좌표](https://www.usgs.gov/volcanoes/kilauea), [Natural Earth 1:50m 국가 경계](https://www.naturalearthdata.com/) (실험용으로 동아시아 일부 추출·좌표 반올림). GIS와 지역명은 지도 표시를 위해 가공했으며 공식 지도가 아닙니다.

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

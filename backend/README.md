# GEOQUAKE KOREA — Railway 서버 (2단계)

기존 GitHub Pages 사이트와 원본 실험실은 변경하지 않습니다.

## 이번 단계에서 구현
- USGS 최근 7일 규모 2.5 이상 지진정보 약 60초마다 수신
- 수신 시 지진 발생정보 형식을 `schemaVersion: 1.0`으로 정규화
- `/health`: 서버 정상 실행 여부
- `/api/events`: JSON 형태 실제 지진 자료
- `/ws`: WebSocket 실시간 변경 전달 준비
- 기상청(KMA)·일본기상청(JMA): **연결 대기** 표시 (이후 단계에서 연결)

**주의**: USGS가 공개하는 자료 자체가 약 1분마다 갱신됩니다. WebSocket은 새 자료가 서버에 들어오는 즉시 브라우저로 보내는 기술이지, 지진 발생 전에 예측하거나 공공 초 단위 조기경보를 제공하는 기능이 아닙니다.

## GitHub에 업로드하기
1. ZIP 압축을 풀고 `backend` 폴더 전체를 기존 GitHub 저장소 `nhc1828/geoquake-korea` 최상위로 드래그해 올립니다.
2. `backend/main.py`, `backend/requirements.txt`가 정확히 보이는지 확인합니다.
3. `Commit changes`를 누릅니다.

## Railway에서 배포하기
1. https://railway.com/ 에서 GitHub로 로그인합니다.
2. New Project → Deploy from GitHub Repo → `nhc1828/geoquake-korea` 선택.
   이미 Empty Project가 있으면 **그 프로젝트에 새 Service를 추가**하고 GitHub Repo를 연결합니다.
3. 서비스 → Settings → **Root Directory**: `/backend` (슬래시 포함).
4. 서비스 → Settings → **Start Command**: `python main.py`.
5. 변경 시 Deploy/Redeploy를 실행합니다.
6. 서비스 → Settings → Networking / Public Networking → **Generate Domain**.
7. 새 도메인을 확인합니다.
   - `https://발급주소.up.railway.app/health` → `"service":"ok"`
   - `https://발급주소.up.railway.app/api/events` → `"sources":{"USGS":{"state":"ok"...` 와 `events` 데이터

`/health`의 service ok는 서버가 실행됐다는 뜻입니다. 실제 외부 수집은 `/api/events` 내 `sources.USGS.state`로 확인합니다. 수집 불가 시 `error`가 표시되며 `events: []`를 실제 지진 0건으로 해석해서는 안 됩니다.

## 테스트 (선택)
```bash
cd backend
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
python main.py
```

GitHub Pages 메인 웹앱은 현재 정적 `site/data/events.json`을 읽으므로 **아직 Railway 서버와 직접 연결되어 있지 않습니다**. `/health`와 `/api/events`를 검증한 뒤 다음 단계에서 `site/assets/app.js`를 실제 API/WebSocket으로 전환합니다.

# GEOQUAKE KOREA — 실시간 웹앱 구축 1단계

이 저장소는 **GitHub Pages에 웹 화면을 먼저 배포하는 단계**입니다. 아직 Railway 서버나 WebSocket 연결은 포함하지 않습니다. 현재 지진 목록은 `site/data/events.json`의 상태를 읽고, 데이터 수신 전에는 **연결 대기**로 표시됩니다. 절대 이 상태를 ‘지진 없음’으로 오해하지 마세요.

## 구조

```text
.github/workflows/geoquake-pages.yml  # 정적 웹 화면만 GitHub Pages에 배포
site/index.html                       # 모니터링 화면
site/assets/app.js                   # 지도/필터/알림/페이지 전환
site/assets/style.css                # 스타일
site/data/events.json                # 1단계: 실제 자료 연결 대기 (정적 파일)
site/data/base_geometry.json         # 내장 지도 형태
site/lab/index.html                  # 원본 GEOQUAKE v0.8 실험실 (수정하지 않음)
scripts/fetch_earthquakes.py         # 다음 단계 참고할 기존 데이터 수집기 (현재 미실행)
tests/test_fetch.py                  # 해당 수집기 단위 테스트
API_GUIDE.md                         # API 참고 설명
DEPLOY_GUIDE.md                      # 이 단계 따라하기
```

## 바로 시작하기

1. 이 ZIP을 풀고 안의 **파일과 폴더 전체**를 GitHub 공개 저장소 `geoquake-korea`의 **최상위**에 업로드합니다. ZIP 파일 자체는 올리지 않습니다.
2. `.github/workflows/geoquake-pages.yml`이 보이는지 확인합니다.
3. GitHub 저장소 → **Settings → Pages → Build and deployment → Source → GitHub Actions**를 선택합니다.
4. **Actions → Deploy GEOQUAKE frontend (GitHub Pages) → Run workflow**를 실행합니다. 이미 자동으로 성공했다면 생략할 수 있습니다.
5. **Settings → Pages**의 배포 주소에 접속해 화면과 `실험실` 탭을 확인합니다.

자세한 단계는 [DEPLOY_GUIDE.md](DEPLOY_GUIDE.md)를 확인하세요.

### 성공 기준

- 사이트 URL이 열리고 메뉴 및 지도 영역이 보인다.
- 실험실에서 원본 v0.8 시뮬레이션을 실행할 수 있다.
- 메인 지진 정보의 **연결 대기** 상태는 정상이다. Railway를 연결하기 전에는 실시간 지진정보가 보이지 않는다.
- GitHub Actions는 코드를 배포할 뿐 **주기적으로 지진 API를 호출하지 않는다**.

### 다음 단계

Railway에 서버를 만들고 세 기관의 데이터 수집 및 WebSocket을 연결한 후, `site/assets/app.js`가 `site/data/events.json` 대신 Railway의 공개 API/WebSocket을 사용하도록 변경합니다. GitHub Pages는 정적 웹 화면만 제공합니다.

주의: 실제 지진 이전 예측이나 공적 재난 경보를 제공하지 않습니다. 지진이 발생한 뒤 관측·발표된 공식/공개 정보를 보여 주는 개인 학습 프로젝트입니다.

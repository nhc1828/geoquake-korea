# GEOQUAKE KOREA — 1단계: GitHub Pages 배포 따라하기

## 준비

- GitHub 계정
- 압축 해제 프로그램(Windows 탐색기 기본 기능도 가능)
- 별도 기상청 API 키/결제수단은 **1단계에서는 불필요**

## 1. 새 저장소 생성

1. https://github.com/new 접속 후 로그인.
2. Repository name: `geoquake-korea`.
3. Visibility: `Public` (무료 GitHub Pages 배포 기준).
4. Initialize this repository with a README, .gitignore, license 옵션은 모두 **체크하지 않기**.
5. `Create repository` 클릭.

## 2. 파일 업로드 (GitHub 웹)

1. 내려받은 ZIP을 내 PC에서 압축 풉니다.
2. 압축 해제한 **내부의** `.github`, `site`, `scripts`, `tests`, `README.md` 등 전체를 확인합니다.
3. 새 저장소의 `uploading an existing file` 또는 `Add file → Upload files` 선택.
4. ZIP **파일 자체가 아닌** 내부 파일·폴더를 업로드 영역으로 끌어놓습니다. **`.github` 폴더가 반드시 포함**돼야 합니다.
5. `Commit changes` (또는 유사 문구)로 확정.

GitHub 웹에서 폴더가 누락되면 GitHub Desktop 또는 `git` 명령으로 업로드할 수 있습니다.

## 3. Pages 활성화

1. 저장소 `Settings → Pages`.
2. `Build and deployment`의 `Source`를 `GitHub Actions`로 설정.
3. 저장소 `Actions` 탭에서 `Deploy GEOQUAKE frontend (GitHub Pages)`를 선택.
4. 이미 녹색 성공(Success)이 표시되지 않았다면 `Run workflow` → `Run workflow` 클릭.
5. `Settings → Pages`에 나타난 사이트 주소로 접속.

주소 예시: `https://GITHUB_ID.github.io/geoquake-korea/`
실험실 예시: `https://GITHUB_ID.github.io/geoquake-korea/lab/`

## 4. 성공 여부 점검

- [ ] 저장소 최상위에 `site/index.html`이 보임
- [ ] `.github/workflows/geoquake-pages.yml`이 보임
- [ ] Actions에서 `Deploy GEOQUAKE frontend` 작업이 성공함
- [ ] 사이트 주소 접속 가능
- [ ] `실험실` 탭에서 원래 시뮬레이터가 작동함
- [ ] 메인 지진정보는 데이터 연결 전 상태로 보이며, 과거/가상 기록을 실제처럼 표시하지 않음

## 5. 실패할 때 확인

- `404`: Pages Source, 배포 완료 여부, 정확한 URL 확인.
- `No workflow runs`: `.github/workflows/geoquake-pages.yml` 경로와 `main` 브랜치 확인.
- `Workflow failed`: Actions 상세 실행의 실패 단계 및 권한 확인.
- 화면은 보이는데 지진이 없음: **정상**, 1단계에는 Railway 수집 서버가 없음.

## 이어서 진행할 2단계

Railway에 24시간 실행되는 서버를 배포하고 `/api/events`, `/health`, `/ws` 등의 경로를 만드는 단계로 진행합니다. KMA 키를 발급받은 뒤 Railway의 **Variables**에 `KMA_API_KEY`로 등록합니다. 이 키를 `site/` 또는 GitHub 공개 소스 코드에 작성하지 않습니다.

공식 문서:
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- https://docs.railway.com/quick-start

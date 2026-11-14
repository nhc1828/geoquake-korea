# GEOQUAKE KOREA Railway Backend — 6B

## 데이터 연결

- **USGS**: 7일 M2.5+ 지진자료 약 60초 폴링
- **JMA**: P2PQuake 551 일본 지진정보 WebSocket + 초기 최근 기록 복구
- **KMA**: API허브 `getEqkMsg` 지진통보문을 기본 120초 폴링 (기상청 인증키 필요)

KMA 키는 `KMA_API_KEY` 환경변수에서만 로드합니다. 로그나 공개 JSON, GitHub Pages에는 인증키를 넣지 않습니다. `httpx` 정보 로그에는 API URL이 포함될 수 있으므로 이번 버전에서 `httpx`/`httpcore` 로그 레벨을 WARNING으로 올렸습니다.

기존 API:
- `/health` 실행 상태, 기관별 연결 상태
- `/api/events` 합쳐진 최근 발표 기록
- `/api/history` USGS 과거 지진 기록 (지역별 실제 관측진도 아님)
- `/ws` 서버가 수신한 새 발표를 브라우저로 전달

KMA가 하루 동안 지진 발표를 하지 않았더라도 API가 정상 응답했다면 `kma:ok`가 됩니다. `kma:ok`와 `kmaCount:0`은 서로 모순되지 않습니다.

KMA의 `inT`는 원문 최대진도 표현일 수 있지만 17개 시도 관측치가 아닙니다. `observedRegions={}`로 설정하고 모형 진도를 측정값으로 표기하지 않습니다.

## Railway 환경변수

```text
KMA_API_KEY=기상청_API허브_인증키_원문
KMA_POLL_SECONDS=120     # 선택. 60초 미만 불가
```

Railway Settings: Root `/backend`, Start `python main.py`, Networking 포트 실제 `PORT` (이전 8080), Replicas 1.

## 로컬 테스트

```bash
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

README와 설치 안내는 **GitHub 소스코드로 공개해도 되는 정보**만 포함합니다. 인증키 실제 값은 포함하지 않습니다.

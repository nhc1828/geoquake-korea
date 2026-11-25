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

KMA의 `inT`에서 등급과 지역이 명시적으로 짝지어진 경우에만 `reportedAreas`에 지역별 발표진도를 담습니다. 이는 지역별 발표 요약이며, 광역구역 전체의 관측값이라고 단정하지 않습니다. 단일 최대진도나 결합 행정구역은 임의로 분해하지 않습니다.

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

## 지진해일·화산 발표 (시험 연동)

`/api/hazards`는 일본 기상청 화산 발표 목록과 P2PQuake가 중계하는 JMA 지진해일 발표 이력을 120초마다 조회합니다. 수신 오류는 `error`로 표시하고 빈 목록이나 해제와 구별합니다. 지진해일 목록은 과거 발표 이력으로서 현재 발효 여부를 판정하지 않습니다. 한국 기상청 지진해일 통보문과 화산정보 조회를 추가했으며 기존 키의 별도 API 활용 승인이 필요할 수 있습니다. 실제 인증 환경에서 응답 및 권한 검증은 아직 필요합니다. 이력은 현재 발효 여부를 판정하지 않습니다. 화산 지명과 낯선 지명은 일부만 한국어 표기를 제공하며 나머지는 원문으로 표시합니다.

통합 지도와 실험실의 최신 동작·모형 한계는 저장소 루트 README의 “화산·지진해일 지도와 실험실”을 참조하세요. 실험 결과는 공식 경보나 대피 판단에 사용할 수 없습니다.

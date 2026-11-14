# GEOQUAKE KOREA Backend — 6A

FastAPI + Railway. 세 데이터 원천 가운데 이번 단계에서 **USGS + JMA(551)**가 활성화됩니다. KMA는 다음 단계(6B)입니다.

- USGS 공식 GeoJSON: 약 60초 폴링
- P2PQuake JMA 551: 서버 1개 WebSocket, 지수 백오프 재접속, `/history` 초기 복구
- 47개 일본 도도부현 대표 코드 매핑, JMA 관측점 최고 진도 색칠용 데이터
- `GET /health`, `GET /api/events`, `GET /api/history`(USGS 과거 조회), `WS /ws`

실행:

```bash
python -m pip install -r requirements.txt
python main.py
```

선택 환경변수:

- `PORT` : Railway가 설정하는 수신 포트 (기본 8000). **Railway Public Networking Target Port는 실제 로그 포트와 일치시킵니다.**
- `USGS_POLL_SECONDS` : 최소 60초
- `GEOQUAKE_DISABLE_JMA=1` : JMA 연결 비활성화(테스트용)
- `GEOQUAKE_DISABLE_POLL=1` : USGS 폴링 비활성화(테스트용)

**주의**: `JMA`는 P2PQuake의 JMA 발표자료 중계이고 **공식 긴급지진속보(556)의 수신을 포함하지 않습니다.** `observedRegions`는 진도 관측점의 도도부현별 최고값이며 행정구역 전체 실제 진도가 아닙니다. 임시 메모리 보관이므로 배포 재시작 후 재수집되며, 발표 수정 이력의 영속 보관은 다음 단계에서 구현해야 합니다.

상세 내용: 저장소 최상위 `STEP6A_설치및검증.md`.

# 프로젝트 장기기억

## 고정 목표/제약
- 목표: UDP 141B 바이너리를 Node UDP Bridge에서 수신 → WebSocket으로 중계 → Next.js 웹앱에서 파싱/표시/3D 시각화
- 제약: 브라우저는 UDP 직접 수신 불가 → UDP Bridge 필수

## 현재 상태
- 구조: `udp-bridge` + `webapp` + 문서(`doc`) 형태의 모노레포.
- 브리지:
  - UDP 패킷 길이 `141B`만 처리.
  - 기본 포트: `UDP 5005`, `WS 9090`.
  - `--mock` 모드 지원.
  - 첫 유효 UDP 패킷 1회 파싱 로그 기능 추가(`LOG_FIRST_PACKET`, 기본 켜짐).
- 웹앱:
  - Next.js App Router 기반 대시보드.
  - 실행 포트: `9091`(`dev`, `start` 스크립트 모두).
  - 기본 WS 주소: `ws://innert.iptime.org:28080`.
  - 한글 UI 중심으로 정리.
- 3D 뷰어:
  - 8x8 값을 바닥에서 위로 쌓이는 타워 형태로 표시.
  - 바닥 평면 제거, 그리드 유지.
  - 그리드 크기를 `xyScale`에 연동해 데이터와 맞춤.
  - 시점 고정(탑-측면), 좌우 회전만 허용(상하/줌/팬 제한).

## 구동 방법
- 브리지(실데이터):
  - `cd udp-bridge`
  - `npm install`
  - `UDP_PORT=5005 WS_PORT=9090 npm run start`
- 브리지(모의데이터):
  - `cd udp-bridge`
  - `npm run mock`
- 웹앱:
  - `cd webapp`
  - `npm install`
  - `npm run dev` (9091)
  - 또는 `npm run build && npm run start` (9091)
- 서버 운영 권장:
  - `pm2`로 `tof-bridge`, `tof-web` 분리 운영
  - 수정 후 `pm2 restart <name>` 적용

## 주요 파일 경로
- 루트
  - `README.md`
  - `doc/work_instructions.md`
  - `doc/develop_plan.md`
- 브리지
  - `udp-bridge/bridge.js`
  - `udp-bridge/package.json`
  - `udp-bridge/README.md`
- 웹앱
  - `webapp/app/page.tsx`
  - `webapp/components/ToFDashboard.tsx`
  - `webapp/components/ToFViewer.tsx`
  - `webapp/components/useToFStream.ts`
  - `webapp/components/utils.ts`
  - `webapp/components/utils.test.ts`
  - `webapp/package.json`
  - `webapp/README.md`

## 남은 작업
- 운영/배포 문서의 포트·도메인 최신값(9091/9090/28080/DDNS) 최종 정합성 점검.
- 실환경 데이터 기준 엔디안/비트순서 고정값 확정 및 문서화.
- HTTPS 환경에서 `wss://` 경로(리버스 프록시 포함) 운영 가이드 보강.
- 대시보드 불필요 고급 항목 추가 축소 여부 최종 확정.

## 알려진 리스크
- 브라우저가 HTTPS일 때 `ws://` 혼합 콘텐츠 차단 가능성.
- DDNS/포트포워딩 변경 시 기본 WS 주소와 실제 경로 불일치 가능성.
- 송신 데이터 포맷 차이(엔디안, 비트 순서, 상태 코드 체계)로 시각화 왜곡 가능성.
- Windows 로컬 빌드 시 `.next/trace` 파일 잠금(EPERM) 재발 가능성.

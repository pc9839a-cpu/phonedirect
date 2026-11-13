# 폰다이렉트 상담 DB 연결 설정

소스 패치만으로 접수가 완료되지는 않습니다. 다음 두 서비스의 배포/비밀변수를 연결해야 합니다.

1. 구글시트 [폰다이렉트 상담 DB](https://docs.google.com/spreadsheets/d/1rZJryOyXkcCgRSXL4Dmfegul0I8ue-W65RUQxT3paXU/edit) > 확장 프로그램 > Apps Script.
   저장소의 google-apps-script/Code.gs 코드를 붙여넣고 프로젝트 설정 > 스크립트 속성에 INGEST_TOKEN (무작위 32자 이상)을 입력합니다.
   배포 > 새 배포 > 웹 앱, 실행 사용자 '나', 액세스 권한 '모든 사용자', 권한 승인. 배포 후 /exec URL 복사.
   웹 앱은 게시되지만 토큰을 검증하므로 무작위 외부 POST로 시트를 변경하지 않습니다.

2. Cloudflare Pages의 phonedirect 프로젝트 > Settings > Variables and Secrets (Production).
   SHEETS_WEB_APP_URL = 위 Apps Script의 /exec URL
   SHEETS_INGEST_TOKEN = Apps Script의 INGEST_TOKEN과 같은 값 (비밀값/Secret)
   비밀변수 설정 후 프로덕션 재배포. 인증 토큰을 GitHub 또는 방문자 브라우저에 넣지 않습니다.

3. 확인: GET https://phonedirect.pages.dev/api/lead 에서 405 + JSON이 반환되어야 Pages Function이 배포된 것입니다.
   본인이 동의한 테스트 번호로 상담폼 1건 제출, 상담DB의 A~L 열에 한국시간·전화번호 010 앞자리·접수ID까지 기록됐는지 확인.
   같은 접수ID는 중복 저장되지 않습니다. 오류/시간초과 때는 성공 안내를 표시하지 않습니다.

저장소의 index.html, assets 폴더는 기존과 동일한 웹 루트에 배포해야 합니다. functions/api/lead.js 는 프로젝트 루트의 Functions 경로이고 public/functions 경로가 아닙니다.

## 민감정보 없는 환경변수 확인

`curl -I https://phonedirect.pages.dev/api/lead` 실행 시 **204**이면 운영 Cloudflare의 두 환경변수가 설정된 상태입니다. **503**이면 비밀변수 누락(또는 잘못된 운영환경), **405**이면 새 HEAD 검사 라우트가 아직 배포되지 않은 상태입니다. 204만으로 Apps Script 배포·시트 쓰기까지 성공했다고 간주하지 않습니다. 실제 접수 확인은 본인 동의 번호 1건으로 별도 검증해야 합니다.

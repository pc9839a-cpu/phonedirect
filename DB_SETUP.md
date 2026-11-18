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

`GET https://phonedirect.pages.dev/api/lead`은 항상 HTTP 405로 응답합니다. 응답 헤더 `X-Lead-Bridge-Configured: yes`는 Cloudflare 운영 환경에 두 비밀변수가 모두 설정됐음을 뜻합니다. `no`는 누락 상태입니다. 이 검사는 키 값이나 고객 정보를 노출하지 않습니다. `yes`만으로 Apps Script 실제 배포·시트 쓰기 성공이라고 간주하지 마세요. 신청 1건의 실제 저장 검증이 별도로 필요합니다.

## 폰다이렉트 신청 메일 (Amazon SES, 서버 전송)

- 수신처: `jiyounicom@gmail.com` (서버 고정, 브라우저에 노출하지 않음)
- 메일 내용: `상담DB` 12열 순서와 동일한 신청정보 (접수일시·성함·연락처·통신사·희망기종·상태·메모·유입경로·UTM 출처·UTM 캠페인·개인정보 동의·접수ID). 접수일시는 Cloudflare의 접수 시각(한국시간)으로 구글시트 기록 시각과 수 초 차이가 날 수 있습니다.
- 전송: `functions/api/_ses.js`에 이식한 페이지로의 Amazon SES v2 API 방식, 리전 `ap-northeast-2`.
- `phonedirect` Cloudflare Pages **Production** 환경에 아래 secret을 설정해야 실제 발송 가능. 페이지로(별도 `inlet` 프로젝트)에 설정한 비밀변수는 **다른 Pages 프로젝트로 자동 공유되지 않습니다**.
  - `AWS_SES_ACCESS_KEY_ID` (페이지로에서 사용 중인 AWS SES IAM Access Key)
  - `AWS_SES_SECRET_ACCESS_KEY` (같은 Key의 Secret, Secret 유형)
  - `AWS_SES_REGION=ap-northeast-2` (선택; 기본 서울)
  - `PHONEDIRECT_SES_FROM_EMAIL=폰다이렉트 <support@pagero.kr>` (선택; `pagero.kr` SES 검증 도메인 기준)
- 비밀값을 GitHub 코드나 대화창에 붙여 넣지 않습니다. 변수 변경 후 Pages Production 재배포가 필요합니다.
- `GET /api/lead`는 405를 유지하며 `X-Lead-Email-Configured: yes/no` 헤더로 비밀변수 **존재**만 확인 가능합니다. `yes`도 실제 메일 발송을 보장하지 않습니다.
- 구글시트 저장 성공이고 신규 접수인 경우 메일도 발송 시도. 시트 저장 실패라도 SES 메일이 성공하면 `sheet_status=failed,email_status=sent`와 함께 메일 접수로 처리. 두 전송 모두 실패하면 오류 응답. 이미 시트에 있는 접수ID는 다시 메일을 보내지 않음.
- 메일 전송 실패 시 신청 정보·액세스 키·SES provider 오류 원문은 서버 로그에 남기지 않습니다. 메일 전송에 대한 영속 재시도 큐는 현재 없습니다.


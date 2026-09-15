# Assist

VS Code에 없는 이동 단축키를, VS Code가 쓰지 않는 키에 붙이는 익스텐션. VS +
Visual Assist 조합에서 VS Code로 옮겨오며 손이 헛도는 자리를 메우는 게 목적임.

**의존성 없음**(`dependencies`, `devDependencies` 둘 다 비어 있음). 번들러도 빌드
단계도 없음. 클론하고 `F5`면 끝임. 이 성질을 깨는 변경은 하지 않음.

**파서도 인덱스도 갖지 않음.** 코드 분석은 전부 사용자가 이미 깐 언어 서버(clangd,
cpptools, rust-analyzer, tsserver) 몫임. 이 성질도 깨지 않음 — 깨는 순간 유지 비용이
취미 범위를 벗어남.

## 구조

| 파일 | 역할 |
|---|---|
| `extension.js` | 진입점. `features/` 목록을 돌며 명령을 등록함. 그 외 로직 없음 |
| `features/round-trip.js` | `Alt+G`. provider를 전부 물어보고, 커서가 이미 있는 자리를 뺀 뒤, 하나면 점프하고 여럿이면 목록을 냄 |
| `features/function-step.js` | `Ctrl+Shift+↑/↓`. 언어 서버의 문서 심볼에서 함수·메서드·생성자 이름 줄만 골라 이전·다음으로 이동 |
| `features/symbol-search.js` | `Shift+Alt+S`. 자체 심볼 검색 창. 서버에서 빈 검색어 결과와 입력 결과를 받아 이 확장이 직접 fuzzy로 거름. 창의 버튼으로 fuzzy를 켜고 끔 |
| `features/process-attach.js` | `Ctrl+Alt+P`·`Shift+Alt+P`. C/C++ 확장의 프로세스 선택기(`extension.pickNativeProcess`)와 `cppvsdbg` 디버거로 연결·다시 연결. 다시 연결은 마지막 실행 파일 이름을 `tasklist`로 찾음. Windows 전용 |
| `tools/check-keys.js` | 키 충돌 검사기. 런타임 아님 — 바인딩을 **추가하기 전에** 돌림 |
| `tools/release.js` | 태그를 `package.json` 버전에서 만듦. 인자 없이 돌리면 점검만 하고, `--push`면 태그를 만들어 밈. neon-glow에서 가져옴 |
| `tools/make-icon.js` | `icon.png` 생성기. 의존성 없음. neon-glow 렌더러를 모양 하나로 줄인 것 |
| `.github/workflows/` | `v*` 태그에서 `release.yml`은 GitHub 릴리스를, `marketplace.yml`은 마켓 게시를 함. 마켓 쪽은 `VSCE_PAT` secret이 있어야 함 |
| `.cache/` | `check-keys`가 받아두는 기본 키맵 세 플랫폼분. gitignore 대상 |
| `fixtures/round-trip/` | `Alt+G`가 답해야 하는 자리를 한 화면에 모은 C++ 세 파일. 손으로 돌리는 인수 테스트임 — 자체 `README.md`에 다섯 자리와 기대 결과가 있음. VSIX에는 안 들어감 |
| `l10n/bundle.l10n.ko.json` | 화면 문구의 한국어 번역. 키는 영어 원문 그대로임. VS Code 표시 언어가 한국어면 쓰이고, 아니면 원문이 나옴 |
| `package.nls.json` / `package.nls.ko.json` | 명령 제목과 설정 설명의 영어 원문과 한국어. `package.json`에는 `%키%`만 있음 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `assist.roundTrip` `assist.roundTrip.explain` `assist.nextFunction` `assist.previousFunction` `assist.searchSymbols` `assist.attachToProcess` `assist.reattachToProcess`
설정: `assist.keymap.enabled` `assist.roundTrip.providers` `assist.roundTrip.searchByName` `assist.roundTrip.pickWhenAmbiguous` `assist.symbolSearch.fuzzy`

## 기능을 더하는 비용은 두 갈래임

- **코드가 필요한 기능** — `features/` 파일 하나 + `extension.js` 목록에 한 줄 +
  `contributes` 항목
- **키만 필요한 기능** — `contributes` 항목 하나

**두 번째가 기본임.** VS Code에 이미 명령이 있으면 코드를 쓰지 않음. 지금 실린 것 중
코드가 든 건 `Alt+G`(`Alt+D`), `Ctrl+Shift+↑/↓`, `Shift+Alt+S`, `Ctrl+Alt+P`·`Shift+Alt+P`이고, `Shift+Alt+O`·`Alt+M`은
기존 명령에 키만 더 단 것임. **`Shift+Alt+S`는 원래 `Ctrl+T`에 키만 단 것이었음.** 기본 심볼
검색 창은 서버가 준 결과를 자기 fuzzy로 다시 거를 뿐이라, 서버가 0건을 주면 보여줄 게 없음.
clangd는 이름 앞부분과 단어 머리글자만 맞춰서 `ce`(→ `Circle`) 같은 중간 건너뛰기에 0건을 줌
(9/15 직접 LSP로 잼). 그래서 자체 창으로 바꿨음. `Ctrl+T`는 그대로 남음.

## 키 정책 — 이 프로젝트의 중심

**확장은 한번 잡은 키를 놓을 수단이 없음.** 우선순위는 `기본 < 확장 < 사용자`라
사용자는 항상 이기지만, 확장 쪽에는 `-command` 같은 해제 규칙도 낮은 우선순위도
없음(microsoft/vscode#10004, 아직 열린 요청). **`when` 절이 유일한 지렛대임.**

그래서 네 가지를 지킴.

1. **키를 더하지, 뺏지 않음.** `Ctrl+Shift+O`는 그대로 두고 `Alt+M`을 더 붙이는 식.
   밀려나는 게 없으면 충돌도 구조적으로 없음. **예외는 별칭임** — 같은 플랫폼에서 같은
   명령이 같은 `when`으로 다른 키에도 걸려 있으면, 그 키를 가져가도 잃는 게 없음.
   `Ctrl+Shift+↑/↓`가 그 경우(Windows에서 `Shift+↑/↓`와 같은 선택 확장)고 `check-keys`는
   `alias`로 표시함. **플랫폼마다 따로 볼 것** — 같은 키가 Linux에선 다중 커서라 `!isLinux`로
   뺐음. 플랫폼 키는 VS Code 창이 떠 있는 컴퓨터 기준으로 골라짐(`bindToCurrentPlatform`이
   workbench의 `OS`를 봄). Windows 창에서 SSH로 Linux에 붙으면 Windows 키가 적용됨.
   **그래서 `check-keys`는 `Ctrl+Shift+↑/↓`를 계속 `TAKEN`으로 보여줌** — 같은 키에 터미널·채팅
   입력창·노트북 출력용 규칙이 따로 걸려 있어서임. 우리 `when`은 `editorTextFocus &&
   editorHasDocumentSymbolProvider`라 실제로는 안 겹치지만, 도구는 `when`끼리 겹치는지 판단
   못 함. 이 둘의 빨간 줄은 검토 끝난 것임. Linux 줄에도 `alias`가 붙는데(다중 커서가
   `Shift+Alt+↑/↓`에도 있음) 거기선 이 키가 다중 커서의 대표 키라 `!isLinux`는 그대로 둠.
2. **기본 키맵과 먼저 대조함.** `node tools/check-keys.js <키>`. 이걸로
   `Shift+Alt+O`가 `organizeImports`에 이미 잡혀 있는 걸 붙이기 전에 알았음.
   **임자가 있어도 그 규칙이 조건부면 돌려주면서 붙일 수 있음** — 우리 키를 먼저 넣고,
   그 뒤에 기본 명령을 기본과 똑같은 `when`으로 한 번 더 넣음. 뒤 규칙이 이기므로 기본이
   동작하던 자리는 그대로임. `Shift+Alt+O`가 이렇게 들어갔고, `check-keys`는 이걸
   `yields`로 보여줌. `when` 없는(항상 켜진) 기본 규칙에는 못 씀 — 돌려줄 자리가 전부라
   우리 키가 동작할 자리가 안 남음. 기본 키맵엔 `!( )` 부정 문법이 한 번도 안 쓰여서,
   "반대 조건"을 식으로 쓰는 방법은 검증 안 된 채로 두고 이 방식을 씀.
3. **`when`을 가능한 한 좁게 검.** `Alt+G`는 `editorHasDefinitionProvider`를 달아서,
   언어 서버가 없는 자리에서는 **애초에 그 키를 주장하지 않음.**
4. **모든 바인딩이 `config.assist.keymap.enabled`를 달고 있음.** 스위치 하나로 전부
   돌려줄 수 있어야 함. 새 바인딩을 넣을 때 이걸 빠뜨리면 스위치에 구멍이 남.

**새 키를 붙일 때 순서** — `check-keys`로 빈 키인지 확인 → `when`을 어디까지 좁힐 수
있는지 → 마스터 스위치를 달았는지. 셋 다 통과 못 하면 기본 바인딩으로 넣지 말고
README에 붙여 넣을 블록으로만 실을 것.

## 글쓰기 규칙

- **`README.md`가 영어이고 기본**임. GitHub 첫 화면과 마켓플레이스 설명이 이걸 씀.
  `README.ko.md`가 한국어판이고, 둘은 서로 링크함.
- **`README.ko.md`와 이 파일은 음슴체(`-음`/`-함`)로 씀.** 해라체(`-한다`, `-이다`,
  `-없다`)로 쓰지 않음. neon-glow와 같은 규칙임.
- 두 README는 문단이 서로 대응하도록 유지함. 한쪽만 고치면 대응이 흐트러짐.
- **화면에 나오는 문구는 `vscode.l10n.t()`로 감싸고, 같은 커밋에서 `l10n/bundle.l10n.ko.json`에
  한국어를 넣음.** 키는 영어 원문과 글자까지 같아야 함 — 다르면 조용히 영어가 나옴. 방향이나
  수량을 끼워 넣는 대신 문장을 통째로 따로 둠(어순이 언어마다 달라서). 아이콘 표기(`$(...)`)는
  번역문 밖에 둠. **용어는 VS Code 한국어 언어팩을 따름** — 정의·선언·구현·형식 정의, symbol은
  기호, workspace는 작업 영역, fuzzy는 유사 항목 일치, provider는 공급자.
- **명령 제목과 설정 설명은 `package.json`에 `%키%`로만 있음.** 영어 원문은 `package.nls.json`,
  한국어는 `package.nls.ko.json`. 둘 중 하나만 고치면 한쪽 언어만 낡음 — 같은 커밋에서 같이
  고칠 것. 설정 설명은 VS Code 한국어 설정 화면처럼 합니다체로 씀. 이 파일들을 스크립트로 쓸
  때 줄바꿈을 `\n` 글자로 넣지 않게 조심 — v0.1.0의 `searchByName` 설명이 그렇게 `\n\n`을
  글자 그대로 보여주고 있었음.
- **기능을 더하거나 빼면 문서가 같은 커밋에서 따라감.** 설정이나 키 하나에 딸린 자리가
  넷임:
  1. 설정 스키마 — `package.json`의 항목과, `package.nls.json`·`package.nls.ko.json`의 설명
  2. 두 README의 **표** 한 줄씩
  3. 두 README의 **산문** — 그게 무엇이고 왜 그 모양인지
  4. 이 파일 위쪽의 명령·설정 목록
  - **표만 채우고 끝내지 않음.** 표 한 줄은 그게 무엇을 하는지만 말하고, 왜 있는지도 왜
    그 모양인지도 말하지 않음. 소스를 봐야만 알 수 있는 결정(왜 `Shift+Alt+O`는 안
    붙였는지 같은 것)은 산문에 남김.

## 관례

- 커밋 메시지는 **무엇을 왜 바꿨는지 서술하는 영어 문장**. 접두사(`feat:`) 안 씀.
- **릴리스 노트는 전역 규칙(`~/.claude/CLAUDE.md`)을 따름** — 태그마다 변경 내역을 적음.
  `release.yml`이 직전 태그부터의 커밋 제목을 뽑아 붙임. GitHub 자동 노트
  (`--generate-notes`)만으로는 머지된 PR 목록이라, main에 직접 커밋하는 여기선 비어 버림.
  **그래서 커밋 제목이 곧 변경 내역임.** 버전만 올리는 커밋은 제목을 `Bump to `로 시작해야
  목록에서 빠짐.
- **커밋 메시지와 PR 본문에 AI 흔적(`Co-Authored-By` 등)을 붙이지 않음.**
- **마켓 게시 워크플로가 토큰 검사(`verify-pat`)에서 `securityroles` 시간 초과로 멈추면**, 게시자
  페이지에서 확장 옆 `⋮` → Update로 **GitHub 릴리스에 붙은** VSIX를 올림. 다시 빌드한 파일은 바이트가
  달라지니 쓰지 않음(`gh release download v<버전> -p "*.vsix"`로 받음). 올린 뒤 공개 목록 반영까지 몇
  분 걸림. **토큰 탓으로 단정하지 않음** — 9/16엔 몇 시간 전 통과한 같은 토큰이 3/3 실패했고, 그 사이
  다른 게시자는 정상 게시 중이었음. 직접 올린 뒤 워크플로가 늦게 통과해 게시 단계로 가도 "already
  exists"를 성공으로 처리하니 충돌 걱정은 없음.
- **취미 프로젝트임. 주말 단위로 굴러가는 범위를 넘기지 않음.** 이 프로젝트는 특히
  이걸 조심할 것 — "`Alt+G` 하나"에서 우산 확장으로 번지는 데 커밋 두 개밖에 안 걸렸음.
  기능을 더하기 전에 그게 **이번 주말 안에 끝나는지** 먼저 물을 것.
- **VS Code로의 이주가 이 확장의 완성을 기다리게 두지 않음.** 여기 실린 건 전부
  `keybindings.json`에 손으로 적어도 되는 것들임. 확장은 굳히는 도구지 관문이 아님.
- **Windows에서만 검증됨.** macOS/Linux는 코드로만 있고 아무도 안 돌려봤음 — 그렇게
  말해야 함.
- **`displayName`은 `"Assist — Navigation Keys"`임.** ID `vscode-assist`, 그리고 명령과
  설정의 `assist.` 접두사에 맞춘 이름임 — 마켓에 안 겹치는 고유명(`Beeline`,
  `Boomerang`, `Round Trip`)도 비어 있었지만, 설치한 사람이 명령 팔레트에서 이름과
  다른 접두사를 만나지 않는 쪽을 골랐음. 검색은 `keywords`가 받음 — 마켓 검색은
  displayName만 읽지 않음. **`"VS Assist"`나 `"VSCode Assist"`는 쓰지 않음** —
  Whole Tomato 제품의 공식 포팅처럼 읽힐 여지와 Microsoft 브랜드 가이드라인 양쪽에
  걸림. 그 제품은 실제로 VS Code 마켓에 올라와 있음.

## 저작권·상표 점검 — 작업을 끝낼 때마다

Visual Assist를 쓰던 손버릇을 옮기려고 만든 확장이라, 무료 배포라도 **베낀 것처럼 보이면
안 됨.** 그래서 이 프로젝트에서는 세션에서 작업을 끝낼 때마다 아래를 점검하고, 결과를
사용자에게 짧게 보고함. 문제가 없어도 "점검함, 걸린 것 없음"이라고 말함.

1. **배포 파일에 VA 이름이 없는지.** `Visual Assist`, `Whole Tomato`, `VAssistX`. 꼭
   써야 하면 호환을 설명하는 용도로만 쓰고 "Whole Tomato와 무관함"을 같이 적음. 이름·
   아이콘·설명 어디서도 공식 포팅처럼 읽히면 안 됨.
2. **VA의 기능 이름과 메뉴 문구를 그대로 쓰지 않는지.** `Open File in Solution`,
   `Find Symbol in Solution` 같은 것. 명령 제목·설정 설명·README 문장은 이 확장이
   실제로 하는 일을 우리 말로 새로 씀. VA 문서를 옮겨 적지 않음.
3. **VA의 코드·아이콘·스크린샷·문서가 저장소에 없는지.** 외부 코드를 가져오면 출처와
   라이선스를 주석에 남김(`tools/make-icon.js`처럼). **cpptools는 확장 코드(MIT)와 디버거·언어
   서버 바이너리(Microsoft 독점, `RuntimeLicenses`)가 섞여 있음.** 바이너리는 번들하지 않고 VS Code
   안에서 명령으로 부르기만 함. 동작을 확인할 땐 `microsoft/vscode-cpptools`의 공개 소스를 보고,
   근거를 주석에 그 경로로 남김(`features/process-attach.js`처럼).
4. **`dependencies`가 비어 있는지.** 생기면 그 라이선스를 확인함.

점검 명령 — 배포 파일은 `npx @vscode/vsce ls`가 보여주는 것들임:

```bash
grep -n -i -E "visual ?assist|whole ?tomato|vassistx" extension.js package.json README.md README.ko.md features/*.js
grep -n -i -E "in solution|goto related|go to related" extension.js package.json README.md README.ko.md features/*.js
```

**배경 — 무엇이 위험하고 무엇이 아닌지.** 단축키 배치나 "선언부↔정의부 왕복" 같은
기능 아이디어는 저작권 보호 대상이 아님(저작권법 제101조의2는 프로그램의 규약·해법을
보호에서 뺌. 미국은 Lotus v. Borland가 메뉴 명령 체계를 조작 방법으로 봄). 위험은
**표현을 베끼는 것**(코드·문서 문장·아이콘)과 **상표를 제휴처럼 쓰는 것**에 있음. 이 점검은
그 둘만 봄. 법률 자문이 아님 — 판단이 애매하면 사용자에게 그렇다고 말할 것.

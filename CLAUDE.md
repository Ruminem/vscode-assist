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
| `tools/check-keys.js` | 키 충돌 검사기. 런타임 아님 — 바인딩을 **추가하기 전에** 돌림 |
| `tools/release.js` | 태그를 `package.json` 버전에서 만듦. 인자 없이 돌리면 점검만 하고, `--push`면 태그를 만들어 밈. neon-glow에서 가져옴 |
| `tools/make-icon.js` | `icon.png` 생성기. 의존성 없음. neon-glow 렌더러를 모양 하나로 줄인 것 |
| `.github/workflows/` | `v*` 태그에서 `release.yml`은 GitHub 릴리스를, `marketplace.yml`은 마켓 게시를 함. 마켓 쪽은 `VSCE_PAT` secret이 있어야 함 |
| `.cache/` | `check-keys`가 받아두는 기본 키맵 세 플랫폼분. gitignore 대상 |
| `fixtures/round-trip/` | `Alt+G`가 답해야 하는 자리를 한 화면에 모은 C++ 세 파일. 손으로 돌리는 인수 테스트임 — 자체 `README.md`에 다섯 자리와 기대 결과가 있음. VSIX에는 안 들어감 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `assist.roundTrip` `assist.roundTrip.explain`
설정: `assist.keymap.enabled` `assist.roundTrip.providers` `assist.roundTrip.searchByName` `assist.roundTrip.pickWhenAmbiguous`

## 기능을 더하는 비용은 두 갈래임

- **코드가 필요한 기능** — `features/` 파일 하나 + `extension.js` 목록에 한 줄 +
  `contributes` 항목
- **키만 필요한 기능** — `contributes` 항목 하나

**두 번째가 기본임.** VS Code에 이미 명령이 있으면 코드를 쓰지 않음. 지금 실린 것 중
코드가 든 건 `Alt+G`(`Alt+D`)뿐이고, `Shift+Alt+O`·`Shift+Alt+S`·`Alt+M`은 기존 명령에
키만 더 단 것임.

## 키 정책 — 이 프로젝트의 중심

**확장은 한번 잡은 키를 놓을 수단이 없음.** 우선순위는 `기본 < 확장 < 사용자`라
사용자는 항상 이기지만, 확장 쪽에는 `-command` 같은 해제 규칙도 낮은 우선순위도
없음(microsoft/vscode#10004, 아직 열린 요청). **`when` 절이 유일한 지렛대임.**

그래서 네 가지를 지킴.

1. **키를 더하지, 뺏지 않음.** `Ctrl+T`는 그대로 두고 `Shift+Alt+S`를 더 붙이는 식.
   밀려나는 게 없으면 충돌도 구조적으로 없음.
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
- **기능을 더하거나 빼면 문서가 같은 커밋에서 따라감.** 설정이나 키 하나에 딸린 자리가
  넷임:
  1. `package.json`의 설정 스키마(`markdownDescription`)
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

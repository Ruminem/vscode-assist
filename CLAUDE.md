# Assist

VS Code에 없는 이동 단축키를, VS Code가 쓰지 않는 키에 붙이는 익스텐션. VS +
Visual Assist 조합에서 VS Code로 옮겨오며 손이 헛도는 자리를 메우는 게 목적임.

**의존성 없음**(`dependencies`, `devDependencies` 둘 다 비어 있음). 번들러도 빌드
단계도 없음. 클론하고 `F5`면 끝임. 이 성질을 깨는 변경은 하지 않음.

**파서도 인덱스도 갖지 않음.** 코드 분석은 전부 사용자가 이미 깐 언어 서버(clangd,
cpptools, rust-analyzer, tsserver) 몫임. 이 성질도 깨지 않음 — 깨는 순간 유지 비용이
취미 범위를 벗어남.

## 클라우드 세션에서 작업할 때

이 파일이 "전역 규칙"이라고 가리키는 `~/.claude/CLAUDE.md` 는 클라우드 컨테이너에 없음 — 홈
폴더가 안 따라옴. 그대로 시작하면 전역 규칙(응답 방식·git·음슴체·라이선스 등)이 한 글자도 안
실린 채 일하게 됨. 그래서 **첫 작업 전에** 규칙 저장소 `Ruminem/rules` 를 확인함.

- **세션을 열 때 그 저장소도 소스로 줬으면 할 일 없음.** 그 루트 `CLAUDE.md` 가 규칙을 이미
  실어 둠. 시스템 쪽에 `rules/src/core.md` 내용이 보이면 이 경우임
- **안 보이면 `add_repo` 로 붙이고 클론한 뒤, 그 루트 `CLAUDE.md` 의 `@` 줄이 가리키는
  `src/*.md` 를 직접 읽음.** 도중에 붙인 저장소의 `CLAUDE.md` 는 자동으로 안 실림
  (`register_repo_root` 를 불러도 안 됨, 2026-09-19 규칙 저장소 쪽에서 잼). 읽은 규칙은 대화
  기록이라 compaction 때 사라질 수 있으니, compaction 뒤에는 한 번 더 읽음
- 규칙 저장소의 `turn-usage.py`(답장 끝 사용량 줄)도 거기서 부름

## 구조

| 파일 | 역할 |
|---|---|
| `extension.js` | 진입점. `features/` 목록을 돌며 `activate(context)`를 내보낸 기능을 부르고 명령을 등록하며, `deactivate`를 내보낸 기능은 창이 닫힐 때 부름. 셋 다 선택임 — `trace.js`는 `commands`와 `deactivate`, `dot-arrow.js`는 `activate`와 `commands`만 있음. 그 외 로직 없음. `onStartupFinished`로 켜지는 건 `trace.js`가 강제 종료로 남은 임시 파일을 지우기 위해서임 |
| `features/round-trip.js` | `Alt+G`. provider를 전부 물어보고, 커서가 이미 있는 자리를 뺀 뒤, 하나면 점프하고 여럿이면 목록을 냄 |
| `features/text-guess.js` | `Alt+G`의 보조. clangd 인덱스 진행률(`.cache/clangd/index` 파일 수 ÷ `compile_commands.json` 항목 수)과, 인덱스가 덜 됐을 때만 도는 텍스트 추측(VS Code 내장 ripgrep). clangd가 없거나 `clangd.enable: false`면 둘 다 안 함 — cpptools 답을 끝까지 기다림. DB 는 clangd 22 로 잰 순서대로 찾음: `clangd.arguments` 의 `--compile-commands-dir` > 가장 가까운 `.clangd` 의 `CompilationDatabase` > 위로 올라가며 `compile_commands.json`·`build/compile_commands.json`. **앞의 둘은 인덱스가 DB 폴더 자체에, 셋째는 `build/` 의 부모에 생김.** 처음엔 셋째만 봐서 DB 를 옮긴 프로젝트가 "없음"으로 떴고 `Alt+G` 가 매번 인덱싱 대기로 끊겼음. 추측 검색은 파일의 폴더부터 부모로 한 단계씩 넓히며(단계마다 ripgrep 한 번, `cwd` 를 그 폴더로 — ripgrep 은 glob 을 작업 폴더 기준으로 맞춤) 방금 본 하위 폴더를 뺌. 정렬은 유사도 → 거리(같은 파일 −1) — **가까움은 동점만 가름.** spdlog·googletest 에서 부른 파일 자체에 후보가 있는 이름이 7할이 넘었는데 옛 코드는 같은 파일에 가산점이 없었음. 명령 없음 — `round-trip.js`가 부름. 결과를 저장하지 않으므로 "인덱스를 갖지 않음"은 그대로임 |
| `features/function-step.js` | `Ctrl+Shift+↑/↓`. 언어 서버의 문서 심볼에서 함수·메서드·생성자 이름 줄만 골라 이전·다음으로 이동 |
| `features/symbol-search.js` | `Shift+Alt+S`. 자체 심볼 검색 창. 서버에서 빈 검색어 결과와 입력 결과를 받아 이 확장이 직접 fuzzy로 거름. 창의 버튼으로 fuzzy를 켜고 끔 |
| `features/fuzzy.js` | 질의와 이름을 맞추고 맞은 글자를 굵게 그리는 순수 함수 넷. **원래 `symbol-search.js` 안에 있었는데 파일 검색이 같은 걸 원해서 뺐음** — 문자열만 다루므로 심볼 이름과 파일 경로가 같은 점수 로직을 지남. `startsWord` 의 단어 경계에 `/`·`\`·`-`·`.` 를 더했음(경로 조각과 확장자). 심볼 이름엔 그 글자가 거의 없어 기존 점수는 사실상 안 변함 |
| `features/hangul.js` | 한글 → 그 자모를 낸 두벌식 키. `뮻ㅇ` → `abcd`. 완성형은 초·중·종성으로 쪼개고 낱자는 바로 찾음. 겹모음·겹받침은 키 두 개(`ㅘ`→`hk`). 영문·숫자·기호는 그대로 지나감. **언어를 판별하지 않음** — `readings()` 가 원문과 키 읽기 둘을 내놓고 점수가 높은 쪽이 이김. 그래서 한국어로 된 파일 이름도 그대로 찾힘 |
| `features/file-search.js` | `Alt+E`. 자체 파일 검색 창. `findFiles('**/*', undefined, 20000)` 로 목록을 한 번 긁고(두 번째 인자가 `undefined` 라야 `files.exclude`·`search.exclude` 가 적용됨. `null` 이면 전부 포함) 입력마다 `fuzzy.js` 로 점수를 매김. **`Shift+Alt+O` 의 Quick Open 은 그대로 둠** — 확장이 그 창의 입력을 읽거나 매처를 바꿀 API 가 없어서 한글 변환을 넣을 수 없음. 대신 키를 하나 더한 것(`키를 더하지, 뺏지 않음`). Quick Open 의 `:42`·`@심볼`·최근 연 파일 순서는 여기 없음 |
| `features/process-attach.js` | `Ctrl+Alt+P`·`Shift+Alt+P`. C/C++ 확장의 프로세스 선택기(`extension.pickNativeProcess`)와 `cppvsdbg` 디버거로 연결·다시 연결. 다시 연결은 마지막 실행 파일 이름을 `tasklist`로 찾음. Windows 전용 |
| `features/dot-arrow.js` | `assist.dotArrow.enabled`(기본 켜짐, 0.5.1부터). C·C++·CUDA에서 `.` 한 글자를 입력하면 그 뒤 자리에 자동 완성을 물어, **그 목록에서 점으로 닿을 수 있는 것이 하나도 없을 때만** 점을 `->`로 바꿈(= 모든 항목이 점을 덮는 화살표 편집을 달고 옴). **화살표가 하나라도 있으면 바꾸는 첫 판은 틀렸음** — `operator->`가 있는 클래스도 화살표를 답해서 `unique_ptr.reset()`이 `->reset()`이 됐음. 점 그대로인 항목이 0개일 것까지 요구해야 스마트 포인터·반복자가 남음(clangd 18 실측: 날 포인터 2+0, `unique_ptr` 2+5, `shared_ptr` 2+10, `vector::iterator` 2+1). **`)`·`]` 뒤도 이름 뒤처럼 물음**(0.5.2) — 포인터를 돌려주는 호출·첨자·캐스트 뒤가 그 자리임. clangd 22 로 37자리를 쟀고 틀리게 바꾼 곳은 없었음. 놓친 것은 템플릿 안 `static_cast` 하나(화살표 3+점 1이라 점 그대로). 판정은 같은 규칙 그대로라 따로 두지 않았음. 완성 항목의 멤버 이름은 넣지 않고 점만 바꿈. 늦게 온 답은 `document.version`으로 버리고, `WorkspaceEdit`로 적용해 `Ctrl+Z` 한 번에 점이 돌아옴. **키로 부르는 기능이 아님** — `activate`에서 `onDidChangeTextDocument`를 걺. 변환 직후에는 컨텍스트 키 `assist.dotArrow.arrowAtCursor`를 켜고 커서가 움직이면 꺼서, **그 순간에만 `Backspace`가 `assist.dotArrow.deleteArrow`로 가 `->` 두 글자를 지움.** 명령은 지우기 전에 커서 왼쪽이 정말 `->`인지 다시 보고 아니면 `deleteLeft`로 넘김 — 컨텍스트 키는 커서가 어디 있는지의 힌트지 그 밑에 뭐가 있는지의 증거가 아님. `contributes.commands`에는 안 넣었음(팔레트에서 부를 일이 없고 nls가 안 늘어남). 돌다가 멈추는 자리마다 `trace()` 한 줄을 남김 — 조용히 아무것도 안 하면 꺼진 것과 구분이 안 돼서임 |
| `features/enum-values.js` | `assist.enumValues.enabled`(기본 켜짐). C·C++·CUDA 열거형 멤버 줄 끝에 `= 2 (0x2)` 인레이 힌트. **값을 계산하지 않음** — 멤버마다 hover 를 물어 서버가 적은 값을 꺼냄. clangd 는 `Value = \`2\`` 줄, cpptools 는 코드 블록의 `enum class Flags::Write = 2U`(접미사 `U`·`Ui64`). clangd 22 의 자체 인레이 힌트엔 이게 없음(답이 `[]`). 멤버는 Enum 의 자식이나 EnumMember 로 찾고 **이름 위치로 중복을 거름** — clangd 와 cpptools 가 둘 다 돌면 VS Code 가 두 서버의 문서 심볼을 합쳐 줘서 힌트가 전부 두 번 나왔음. **hover 는 하나씩 물음** — 한꺼번에 보내면 cpptools 가 17개 중 3개만 답했음. 초기값이 그 숫자 리터럴 그대로면(`C = 10`) 안 닮. 16진수 리터럴이면(`0x9999`) 10진수만(`= 39321`), 2·8진수는 둘 다 붙임. **두 서버 다 멤버 범위를 쉼표 앞에서 끝내서** 힌트가 `1u << 0 = 1 (0x1),` 처럼 식에 이어 붙어 읽혔음 — 쉼표 뒤가 줄 끝이나 주석뿐이면 쉼표 뒤에 둠(`afterComma`), 같은 줄에 멤버가 더 있으면 제자리. 음수는 기본 형식 폭을 몰라 16진수 없음. 답은 `document.version` 별로 캐시, 빈 답은 안 남김(서버가 아직 파싱 중일 때의 답이라서) |
| `features/trace.js` | 디버깅용 추적. 기본 꺼짐 — `assist.toggleTrace`로 켜면 키 한 번당 한 줄씩 단계별 시간을 **임시 파일**(`%TEMP%/assist-trace-<pid>-*.txt`)에 남기고 상태 표시줄에 표시(누르면 꺼짐). 끌 때 저장 위치를 묻고 임시 파일은 항상 지움. 창이 닫히면 `deactivate`가 지우고, 강제 종료로 남은 건 다음 시작 때 pid가 죽은 파일만 지움. 출력 채널은 안 씀 — VS Code가 세션 로그에 옮겨 적어서. 최근 200줄은 메모용으로 메모리에 둠. 기록 문장은 영어 그대로 |
| `features/note.js` | `assist.saveNote`. 사용자 한 줄 + 언어 서버 버전·설정 + 커서 위치에서 단계별로 하나씩 잰 시간(`round-trip.js`의 `measure`) + 최근 기록을 저장 안 된 마크다운으로 엶. 회사 PC에서 겪은 걸 집에서 고칠 때 넘기는 용도. 키 없음 |
| `tools/check-keys.js` | 키 충돌 검사기. 런타임 아님 — 바인딩을 **추가하기 전에** 돌림 |
| `tools/check-nls.js` | 번역 누락 검사기. 런타임 아님 — `npm run check-nls`, 내면서 돌림. `package.json`의 `%키%`와 두 nls 파일을 양방향으로 맞춰 보고, `vscode.l10n.t()` 원문과 `l10n/bundle.l10n.ko.json` 키를 양방향으로 맞춰 봄. `{0}` 자리 개수 어긋남, 줄바꿈 대신 들어간 역슬래시와 n(v0.1.0 버그), 번역문 안의 `$(...)` 아이콘도 잡음. **번역이 빠져도 영어로 나올 뿐 실패하지 않으므로 이게 유일한 그물임.** `l10n.t()`를 변수로 부르면 잡을 수 없으니 그것도 문제로 보고함 |
| `tools/check-fuzzy.js` | `hangul.js` 의 변환 표와 `fuzzy.js` 의 경로 점수 검사. `npm run check-fuzzy`. 에디터 없이 돎. **표 한 칸을 틀리면 5건, 단어 경계를 옛것으로 되돌리면 5건이 실패하는 것을 확인했음** |
| `tools/check-dot-arrow.js` | `dot-arrow.js`가 서버 없이 스스로 내리는 두 판정(`leftOfDot`·`countEdits`) 검사. `npm run check-dot-arrow`. 에디터도 언어 서버도 안 띄우고 `vscode` 모듈을 최소한으로 흉내 냄. **옛 규칙(화살표 하나면 변환)으로 되돌리면 2건이 실패하도록 박아 뒀음** |
| `tools/check-text-guess.js` | `text-guess.js` 가 에디터 없이 내리는 판정 검사. `npm run check-text-guess`. ① `locateDatabase` — 임시 폴더에 프로젝트를 만들어 세 자리와 우선순위를 봄. **플래그 무시 + `.clangd` 를 옛 탐색 뒤로 돌리면 7건이 실패하는 것을 확인했음** ② 추측 검색 순서(`rings`)와 정렬(`distance`·`byLikeness`). **가까움을 유사도 앞에 두거나 같은 파일 −1 을 0 으로 바꾸면 실패하는 것을 확인했음** |
| `tools/check-enum-values.js` | `enum-values.js` 의 글자 판정(`valueOf`·`label`·`literalBase`·`afterComma`) 검사. `npm run check-enum-values`. hover 문자열은 clangd 22·cpptools 1.34 실측을 옮긴 것임. **16진수 소문자·8진수 처리 빼기·음수 hex·`=` 앞 고정 빼기·cpptools 형식 빼기, 변이 다섯이 전부 실패하는 것을 확인했음** |
| `tools/probe-clangd.js` | clangd 탐침. `npm run probe-clangd`. LSP 로 clangd 에 직접 붙어 픽스처 자리마다 `.` 을 넣고 **화살표 편집을 단 항목 수와 점 그대로인 항목 수**를 찍음. 판정 칸은 `dot-arrow.js` 의 `countEdits` 를 그대로 불러서 내므로 **진짜 서버 답에 진짜 규칙을 먹인 결과**임 — 규칙을 여기 베껴 두지 않았음. 기대값은 픽스처 README 한 곳에만 있고 이 도구는 재기만 함. `--clangd=<경로>` 나 `CLANGD` 로 지정, 없으면 PATH 에서 찾음. **못 재면 종료 코드 2** — 1 이 아닌 이유는 "못 쟀다"가 "쟀는데 틀렸다"로 읽히면 안 되기 때문임. `unique_ptr` 버그를 잡은 게 이 도구임. **파일 URI 는 `pathToFileURL` 로 만듦** — `file://C:\...` 을 붙여 쓰면 clangd 22 가 말없이 버려 매번 시간 초과가 남 |
| `tools/release.js` | 태그를 `package.json` 버전에서 만듦. 인자 없이 돌리면 점검만 하고, `--push`면 태그를 만들어 밈. neon-glow에서 가져옴 |
| `tools/make-icon.js` | `icon.png` 생성기. 의존성 없음. neon-glow 렌더러를 모양 하나로 줄인 것 |
| `.github/workflows/` | `v*` 태그에서 `release.yml`은 GitHub 릴리스를, `marketplace.yml`은 마켓 게시를 함. 마켓 쪽은 `VSCE_PAT` secret이 있어야 함 |
| `.cache/` | `check-keys`가 받아두는 기본 키맵 세 플랫폼분. gitignore 대상 |
| `fixtures/round-trip/` | `Alt+G`가 답해야 하는 자리를 한 화면에 모은 C++ 세 파일. 손으로 돌리는 인수 테스트임 — 자체 `README.md`에 다섯 자리와 기대 결과가 있음. VSIX에는 안 들어감 |
| `fixtures/dot-arrow/` | `.`→`->`가 발동해야 하는 자리와 발동하면 안 되는 자리를 모은 C++ 한 파일. **커서를 `;` 앞에 두고 `.`을 침** — 자체 `README.md`에 열세 자리와 기대 결과가 있음. 경고 없이 컴파일되게 써 둠(경고 물결선이 뜨면 실패가 무엇 탓인지 흐려짐). VSIX에는 안 들어감 |
| `fixtures/enum-values/` | 열거형 모양을 모은 C++ 한 파일. 줄 끝 주석이 그 줄에 나와야 할 힌트임. **서버가 그 주석을 멤버의 문서 주석으로 읽어 hover 에 넣으므로** 주석이 `expect` 로 시작함 — 안 그러면 hover 에 힌트와 똑같은 글자가 떠서 서버가 쓴 것처럼 보임(실제로 한 번 속았음). compile DB 없이 clangd 기본 플래그로 파싱됨. VSIX에는 안 들어감 |
| `l10n/bundle.l10n.ko.json` | 화면 문구의 한국어 번역. 키는 영어 원문 그대로임. VS Code 표시 언어가 한국어면 쓰이고, 아니면 원문이 나옴 |
| `package.nls.json` / `package.nls.ko.json` | 명령 제목과 설정 설명의 영어 원문과 한국어. `package.json`에는 `%키%`만 있음 |
| `NEXT.md` | 세션 인수인계 노트. VSIX에는 안 들어감 |

명령: `assist.roundTrip` `assist.roundTrip.explain` `assist.nextFunction` `assist.previousFunction` `assist.searchSymbols` `assist.attachToProcess` `assist.reattachToProcess` `assist.saveNote` `assist.toggleTrace` `assist.searchFiles` `assist.dotArrow.deleteArrow`(키 전용, 팔레트에 없음)
설정: `assist.keymap.enabled` `assist.roundTrip.providers` `assist.roundTrip.searchByName` `assist.roundTrip.pickWhenAmbiguous` `assist.roundTrip.textSearch` `assist.symbolSearch.fuzzy` `assist.dotArrow.enabled` `assist.enumValues.enabled`

## 기능을 더하는 비용은 두 갈래임

- **코드가 필요한 기능** — `features/` 파일 하나 + `extension.js` 목록에 한 줄 +
  `contributes` 항목
- **키만 필요한 기능** — `contributes` 항목 하나

**두 번째가 기본임.** VS Code에 이미 명령이 있으면 코드를 쓰지 않음. 지금 실린 것 중
코드가 든 건 `Alt+G`(`Alt+D`), `Ctrl+Shift+↑/↓`, `Shift+Alt+S`, `Alt+E`, `Ctrl+Alt+P`·`Shift+Alt+P`이고, `Shift+Alt+O`·`Alt+M`·`Alt+F`는
기존 명령에 키만 더 단 것임. **`Alt+F`는 처음에 정의/선언/호출로 나눠 보여 주는 자체 창으로 만들려 했음** — clangd 22 로 재 보니 참조 답에는 위치만 있고 종류가 없으며, 정의·선언 답은 커서가 어느 쪽에 있느냐에 따라 서로 뒤바뀌어 나누는 근거로 못 썼음. 그래서 `Shift+Alt+F12`(`references-view.findReferences`)에 키만 달았음. 참조 패널(`focusedView == 'references-view.tree'`)에서 다시 누르면 `focusActiveEditorGroup`으로 편집기에 돌아옴 — 이 줄이 없으면 `editorTextFocus`가 꺼진 그 자리에서 메뉴바 `파일(F)`이 열렸음. **`Shift+Alt+S`는 원래 `Ctrl+T`에 키만 단 것이었음.** 기본 심볼
검색 창은 서버가 준 결과를 자기 fuzzy로 다시 거를 뿐이라, 서버가 0건을 주면 보여줄 게 없음.
clangd는 이름 앞부분과 단어 머리글자만 맞춰서 `ce`(→ `Circle`) 같은 중간 건너뛰기에 0건을 줌
(9/15 직접 LSP로 잼). 그래서 자체 창으로 바꿨음. `Ctrl+T`는 그대로 남음.

**`Alt+E`(파일 검색)도 같은 벽에서 나왔음.** 한글 IME 를 켠 채 `abcd` 를 치면 화면에는 `뮻ㅇ`
이 남는데, `Shift+Alt+O` 의 Quick Open 은 **입력을 읽는 이벤트도 매처를 바꾸는 API 도 없음**
(`registerFileSearchProvider` 는 proposed 이고 가상 파일 시스템용이라 이 일에 안 맞음). 확장이
그 창에 할 수 있는 건 여는 것뿐임. 그래서 자체 창을 새 키에 붙였고 **Quick Open 은 그대로 뒀음**
— 손버릇을 안 뺏는 쪽이 이 저장소의 1번 원칙이고, 그 창의 `:42`·`@심볼`·최근 연 파일 순서를
다시 만들 값어치는 없음.

**세 번째 갈래가 하나 생겼음 — 키로 시작하지 않는 기능**(`dot-arrow.js`). 입력에 반응하므로
`contributes.keybindings`가 아니라 `contributes.configuration` 항목 하나로 들어가고,
`extension.js`가 `activate(context)`를 불러 주면 거기서 이벤트를 걺. **이 갈래는 값이 비쌈** —
끌 수단이 설정뿐이고, 사용자가 부르지 않았는데 도는 것이라 잘못 돌면 키가 안 먹는 것과 달리
**입력한 내용이 바뀜.** 그래서 여기에 더 넣기 전에 정말 키로는 안 되는지 먼저 물을 것.
0.5.0은 기본 꺼짐이었음 — setup 이 팀원 PC 에 이 확장을 `--force`로 깔고 있어서였음. 0.5.1에서
켜 달라는 요청으로 기본 켜짐이 됐음. 판정을 서버에 맡겨 스마트 포인터가 안 깨지는 것을 확인한 뒤임.
`enum-values.js` 도 이 갈래지만(인레이 힌트 제공자를 `activate` 에서 걺) **화면에 그리기만 하고
입력은 안 바꿈** — 잘못 돌아도 틀린 숫자가 보일 뿐이라 처음부터 기본 켜짐으로 냈음.

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
- **`README.ko.md`와 이 파일은 음슴체로 씀.** 상세는 전역 규칙(`~/.claude/CLAUDE.md`)의 음슴체 절.
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
  - **고치고 나서 `npm run check-nls`를 돌릴 것.** 위 1번의 두 nls 파일과 `l10n` 번역이
    실제로 짝이 맞는지 보는 유일한 그물임 — 번역이 빠지면 영어가 나올 뿐 아무것도 안 깨져서
    한국어로 띄워 한 줄씩 읽기 전에는 모름. 내기 전에도 돌림.
  - **표만 채우고 끝내지 않음.** 표 한 줄은 그게 무엇을 하는지만 말하고, 왜 있는지도 왜
    그 모양인지도 말하지 않음. 소스를 봐야만 알 수 있는 결정(왜 `Shift+Alt+O`는 안
    붙였는지 같은 것)은 산문에 남김.

## 관례

- 커밋 메시지는 영어로 씀 (형식은 전역 규칙).
- **릴리스 노트는 전역 규칙(`~/.claude/CLAUDE.md`)을 따름** — 태그마다 변경 내역을 적음.
  `release.yml`이 직전 태그부터의 커밋 제목을 뽑아 붙임. GitHub 자동 노트
  (`--generate-notes`)만으로는 머지된 PR 목록이라, main에 직접 커밋하는 여기선 비어 버림.
  **그래서 커밋 제목이 곧 변경 내역임.** 버전만 올리는 커밋은 제목을 `Bump to `로 시작해야
  목록에서 빠짐.
- **마켓 게시 워크플로가 토큰 검사(`verify-pat`)에서 `securityroles` 시간 초과로 멈추면**, 게시자
  페이지에서 확장 옆 `⋮` → Update로 **GitHub 릴리스에 붙은** VSIX를 올림. 다시 빌드한 파일은 바이트가
  달라지니 쓰지 않음(`gh release download v<버전> -p "*.vsix"`로 받음). 올린 뒤 공개 목록 반영까지 몇
  분 걸림. **토큰 탓으로 단정하지 않음** — 9/16엔 몇 시간 전 통과한 같은 토큰이 3/3 실패했고, 그 사이
  다른 게시자는 정상 게시 중이었음. 직접 올린 뒤 워크플로가 늦게 통과해 게시 단계로 가도 "already
  exists"를 성공으로 처리하니 충돌 걱정은 없음.
- **이 프로젝트는 범위가 특히 잘 번짐** — "`Alt+G` 하나"에서 우산 확장으로 번지는 데 커밋 두 개밖에 안 걸렸음.
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

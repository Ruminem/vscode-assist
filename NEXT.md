# NEXT

**끝났다의 정의** — `Alt+G` 한 번으로 선언부↔정의부를 왕복할 수 있고, 내 C++
프로젝트에서 하루 써봐도 안 거슬린다.

**여기까지 됨 — 실기에서 다섯 자리 전부 통과했다.** 호출부 / 헤더 선언 / `.cpp`
정의 / 멤버 함수 본체 / 가상 함수. 호출부와 멤버 본체에서는 목록이 뜨고 구현부가
기본값으로 올라오며, 나머지는 목록 없이 바로 점프한다.

**동작 원리가 바뀌었다.** 전에는 provider를 순서대로 물어보다 처음 답하는 놈이
이기는 chain이었는데, 지금은 **전부 동시에 물어보고 → 커서가 이미 있는 자리를
가리키는 답은 버리고 → 하나 남으면 점프, 여럿이면 목록**이다. 짧게 끊고 나가는
방식으로는 "갈 데가 여기뿐"과 "여럿 중 첫째"를 구분할 수 없는데, 그 구분이 기능
자체다. 설정 이름도 `chain`에서 `providers`로 바꿨다 — 더 이상 chain이 아니라
한꺼번에 물어볼 집합이고, 순서는 동점일 때 tie-breaker로만 쓴다.

**기본값 판정은 규칙 하나다 — 헤더가 아닌 파일에 있는 답을 위로.** 구현부는
정의상 헤더에 없는 쪽이니까. 이 한 줄이 자유 함수(`.cpp` 정의 > `.h` 선언)와
가상 함수(`.cpp` 오버라이드 > 기반 선언)를 동시에 맞힌다. 헤더 온리 코드는
이 판정을 다 같이 통과 못 하니 provider 순서로 자연히 흘러간다.

**이번 세션의 제일 큰 소득은 `explain` 명령이다.** `Assist: Explain what the round
trip sees here`. 각 source가 뭘 답했는지, 뭐가 "지금 자리"라 버려졌는지, 인덱스가
필터 전에 뭘 돌려줬는지를 다 보여준다. **이게 이번에 내 가설을 세 번 잡았다:**
① `Circle::area` 본체에서 `shape.h:17`로 갈 거라 했는데 실제로는 아무 데도 못 갔다
② `.cpp` 정의에서 헤더로 가는 게 "definition이 둘 다 답해서"라 했는데 실제로는
헤더 하나만 답한다 ③ 이름 검색이 0건인 게 인덱스 탓인 줄 알았는데 내 필터 탓이었다.
**이 프로젝트에서 provider 동작을 추측하지 말 것. 재고 짤 것.**

**cpptools 실측표 (VS Code 1.136 / ms-vscode.cpptools):**

| 커서 자리 | Definition | Declaration | Implementation | TypeDef |
|---|---|---|---|---|
| 호출부 | `.cpp` 정의 | – | – | Definition과 동일 |
| 헤더 선언 | `.cpp` 정의 | – | – | 〃 |
| `.cpp` 정의 | **헤더 선언** | – | – | 〃 |
| 멤버 함수 본체 | **자기 자신** | – | – | 〃 |

읽을 것 셋. **① `Declaration` provider는 cpptools에 아예 없다** (4/4 무응답).
그래도 기본값에서 빼지 않았다 — 동시에 물어보니 침묵하는 provider는 시간을 안
먹고, clangd·tsserver는 구현하고 있다. **② `TypeDefinition`은 Definition과 늘
같은 답**이라 켜봐야 중복만 는다(위치로 dedupe하니 목록이 더러워지진 않는다).
**③ definition이 "반대편"을 답한다** — cpptools가 이미 자기 나름의 왕복을 한다.
단 멤버 함수 본체만 예외로 자기를 답해서, 거기서는 provider만으로 갈 데가 없다.

**그래서 워크스페이스 심볼 검색을 상시 보강으로 넣었다**(`searchByName`, 기본 켬).
최후 수단이 아니라 매번 도는 이유는, cpptools가 답을 **정확히 하나** 주는 일이
많은데 **하나짜리 답은 선택지로 내놓을 수가 없기** 때문이다. 호출부에서 목록이
뜨려면 두 번째 후보를 인덱스가 대줘야 한다. 덤으로 멤버 본체의 막힌 길도 뚫린다.
**인덱스 항목은 맨 이름이 아니다** — cpptools는 `totalArea(const Shape **, int)`
처럼 시그니처를 붙이고 선언 쪽엔 `(선언)`까지 붙인다. 첫 괄호에서 잘라 비교한다.

**키 충돌은 층이 셋이고, `tools/check-keys.js`는 맨 아래 한 층만 본다.**
① 다른 앱의 전역 핫키 ② Windows 메뉴 니모닉 ③ VS Code 기본 키맵. 도구는 ③만
안다. 실제로 `Alt+G`가 **Chrome의 Gemini 런처(`glic`) 전역 핫키**에 먹히고 있었다
— `RegisterHotKey` 계열이라 포커스와 무관하게 OS가 먼저 가로채서 VS Code까지 오지도
않는다. 이 기능은 2026-06-25에 조용히 들어왔고 안내 배지가 한 번도 안 떴다.
Chrome 설정에서 그 단축키를 지워서 해결했다. **①②는 눌러봐야만 안다.**
`Developer: Toggle Keyboard Shortcuts Troubleshooting`을 켜면 키가 VS Code까지
왔는지 아닌지가 보인다 — 아무것도 안 찍히면 ①에 먹힌 것이다.
그리고 `check-keys`에 `--refresh`는 처음부터 있었는데, **받아와도 1.134가 온다** —
업스트림(`codebling/vs-code-default-keybindings`)이 VS Code보다 두 버전 뒤처져 있다.
다운로드로 고칠 수 있는 종류가 아니고, **새 버전에서 막 생긴 기본 바인딩은 이 도구가
영영 모른다**는 뜻이다. 층 ③마저 완전하지 않다.

**이번에 같이 끝낸 것 넷.** ① 목록 라벨을 `By name · Shape::area` 꼴로 바꿔서 provider
줄과 짝을 맞췄다 — 인덱스에서 온 줄은 어느 클래스 것인지가 유일한 구분이라 이름이
꼭 필요하다. ② `Alt+D`를 같은 명령에 하나 더 달았다(`check-keys` 통과). ③ 픽스처를
`fixtures/round-trip/`으로 옮기고 다섯 자리 인수 테스트를 자체 `README.md`에 적었다
— `vsce ls`로 VSIX에 안 들어가는 것 확인했다. ④ `check-keys --refresh`는 만들 게
없었다(위 참조).

**9/15에 한 것.** ① `Alt+D` 실기 확인 — 된다. ② 목록을 QuickPick 대신 **코드 액션
메뉴**로 띄워서 커서 자리에 뜨게 했다. QuickPick은 위치를 못 정해서 늘 창 위쪽에 뜨고,
VS Code가 커서에 여는 목록은 코드 액션 메뉴뿐이다. 대신 타이핑 필터가 없고 "추가 작업..."
제목이 붙는다. ③ 릴리스 경로를 neon-glow에서 가져왔다 — `tools/release.js`, `release.yml`
(더블클릭 설치 번들은 뺌), `marketplace.yml`. ④ `icon.png`와 생성기 `tools/make-icon.js`.
⑤ **로컬에 VSIX로 설치했다.** 그 전엔 F5 창 밖에서 설치된 적이 없어서 평소 창에서
`Alt+G`가 안 먹었다.

⑥ `Shift+Alt+O`를 Quick Open에 붙였다 — import 정리를 지원하는 파일에서는 기본의
Organize Imports를 똑같은 `when`으로 한 번 더 넣어 돌려준다. ⑦ 명령 제목이 VA의
"GoTo Related"와 겹쳐서 바꿨고, **작업 끝날 때마다 하는 저작권·상표 점검**을 CLAUDE.md에
넣었다. ⑧ README를 지금 동작에 맞췄다(없어진 `chain` 설정이 남아 있었다). ⑨ **저장소를
Public으로 돌리고 v0.1.0을 GitHub 릴리스와 마켓에 냈다.** 첫 릴리스 노트는 루트 커밋이
빠져서(`루트..태그` 범위가 루트를 뺀다) 손으로 한 줄 넣었다 — 태그가 생긴 뒤로는 안 생기는
문제라 워크플로는 안 고쳤다.

같은 날 **neon-glow와 cmake-link-explorer 이력에서 회사 메일을 지웠다**(이 저장소엔 원래
없었다). 옛 커밋이 해시로는 아직 GitHub에 남아 Support 티켓 #4759839로 삭제를 요청했다.
그 커밋을 만든 회사 PC의 옛 clone은 지우고 새로 받아야 한다.

**다음 할 것**
- **내 C++ 프로젝트에서 하루 쓰기.** 릴리스가 먼저 나갔지만 "끝났다"의 뒷절반은 아직이다.
  거슬리는 게 나오면 고쳐서 0.1.1로 낸다. 설치본을 고치려면 `npx @vscode/vsce package` 후
  `code --install-extension <vsix> --force`, 그리고 **창 리로드** — 9/15에 리로드를 안 해서
  새 키가 안 먹는 줄 알고 한참 헤맸다.
- **가상 함수 표시(virtual/override)를 심볼 검색 결과에 붙일지.** VS Code 기본 검색 창엔
  끼어들 수 없어서 자체 검색 창이 필요하고, 선언 줄에서 키워드를 골라내는 건 "파서를 갖지
  않음" 원칙과 부딪힌다. 헤더 선언 줄에만 표시하는 가벼운 버전이면 해볼 만하다. 미뤄둠.
- **한 저장소에 Claude 세션 하나만 붙일 것.** 9/7에 다른 세션이 커밋하면서 여기서 편집
  중이던 파일 둘을 자기 커밋에 쓸어담았다.

**`displayName`을 `"Assist — Navigation Keys"`로 정했다.** 마켓을 훑어보니 **설명형
이름은 죄다 임자가 있다** — `Code Navigation`은 다른 익스텐션의 이름 전체고, `Waypoint`는
하필 심볼 검색 익스텐션이 쓰고 있고, `Symbol Navigation`과 `Counterpart`도 비슷한 게
여럿이다. 반면 `Beeline`·`Boomerang`·`Round Trip`은 비어 있었다. **그런데도 고유명을 안
고른 이유는 검색이 아니라 일관성이다** — 명령이 `assist.roundTrip`, 설정이 `assist.*`,
ID가 `vscode-assist`라, 이름만 딴 걸로 바꾸면 설치한 사람이 명령 팔레트에서 엉뚱한
접두사를 만난다. **검색은 `keywords`가 이미 받고 있다**(`goto definition` `declaration`
`navigation` `shortcuts` `c++`) — 마켓 검색은 displayName만 읽지 않는다. "이름에
검색어를 넣어야 한다"는 압력은 생각보다 작다.

`"VS Assist"`나 `"VSCode Assist"`를 안 쓰기로 한 판단은 그대로다 — Whole Tomato의
Visual Assist는 **실제로 VS Code 마켓에 올라와 있어서**, 공식 포팅으로 읽힐 여지가
가정이 아니라 실재였다.

**막힌 것 — neon-glow의 토큰 검사 원인이 확정이 안 됐다.** vsce 4.0.0(9/14)이 나온 다음 날
두 저장소 모두 `verify-pat`이 `securityroles` 타임아웃을 냈고, 두 워크플로를 vsce 3으로
고정하자 **이 저장소는 통과해서 v0.1.0이 게시됐지만 neon-glow는 3에서도 실패했다.** 그러니
"원인은 vsce 4"라고 쓴 두 커밋 메시지는 절반만 맞다. neon-glow 토큰 자체가 죽었을 수
있다(cmake-link-explorer에도 "token died early" 기록이 있다). 이 저장소를 막는 문제는 아님.

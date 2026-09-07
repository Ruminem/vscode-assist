# NEXT

**끝났다의 정의** — `Alt+G` 한 번으로 선언부↔정의부를 왕복할 수 있고, 내 C++
프로젝트에서 하루 써봐도 안 거슬린다.

**여기까지 됨** — 하나짜리에서 **우산 확장으로 방향을 틀었다.** ID는
`vscode-assist`, 명령·설정 모두 `assist.` 아래로 모았다. 구조는 "코드가 필요한
기능은 `features/` 파일 하나 + `extension.js` 목록에 한 줄, 키만 필요한 기능은
`package.json` 한 항목"이다. 지금 실린 셋 중 코드가 든 건 `Alt+G`뿐이고 나머지
둘은 기존 명령에 키만 더 달았다. 문법 통과, `vsce ls` 통과, **실기에서는 아직
한 번도 안 눌러봤다.**

**이번 세션의 제일 큰 소득은 충돌 처리 원칙을 먼저 세운 것이다.** 확인한 사실 셋:
① 우선순위는 `기본 < 확장 < 사용자`라 사용자는 항상 이긴다. ② **확장에는 키를
해제할 수단도 낮은 우선순위도 없다** — `-command`는 `keybindings.json` 전용이고
낮은 우선순위는 microsoft/vscode#10004로 아직 열린 요청이다. ③ 그래서 **`when`이
확장이 가진 유일한 지렛대**인데, `config.<불리언설정>`과 `editorHasDefinitionProvider`
같은 provider 컨텍스트 키를 쓸 수 있어서 생각보다 세다. **다음에 키를 붙일 때도
이 순서로 판단할 것 — 빈 키인가 → `when`을 얼마나 좁힐 수 있나 → 마스터 스위치를
달았나.**

**`tools/check-keys.js`를 만들었다.** 기본 키맵 세 플랫폼분을 받아서 후보 키가
이미 임자가 있는지 알려준다. 의존성 없이 노드 내장 `fetch`만 쓰고, `.cache/`에
받아두며 gitignore 대상이다. 이걸로 **`Shift+Alt+O`가 `organizeImports`에 이미
잡혀 있다**는 걸 붙이기 전에 알았다 — VA의 "파일 열기" 키라 안 그랬으면 그냥
붙였을 자리다. 키를 추가할 때마다 먼저 돌릴 것.

**다음 할 것 — `F5`로 띄워서 실기 확인.** 두 가지가 미검증이다.
① **`Alt+G`가 메뉴 니모닉과 부딪히는지.** 기본 키맵에는 비어 있지만 Windows에서
`Alt+G`는 **Go 메뉴의 니모닉**이다. 바인딩이 이기는지, 메뉴가 번쩍이는지, 아니면
메뉴가 이기는지 눈으로 봐야 한다. 지면 `window.disableMenuBarAltBehavior`를
안내하거나 키를 옮기는 두 갈래인데, **남의 설정을 요구하는 쪽은 피하고 싶으니
키를 옮기는 쪽이 우선이다.** 대체 후보는 `alt+b d e f i j q u v x y`가 비어 있다.
② **왕복 자체.** 호출부 / `.cpp` 정의부 / 헤더 선언부 / 가상 함수 네 자리.
특히 **헤더 선언부에서 `.cpp`로 가는지**가 핵심이고, 깨지면 `isHere`의 range 판정
(`targetSelectionRange` 대 `targetRange`)부터 의심할 것.

**막힌 것 — `displayName`이 아직 미정이다.** 지금 `"Assist"`는 자리만 채운 값이다.
ID `vscode-assist`는 확정이고 문제없지만, **`displayName`에 "VS Assist"나
"VSCode Assist"는 쓰지 않기로 했다** — Whole Tomato 제품의 공식 VS Code 포팅처럼
읽힐 여지와 Microsoft 브랜드 가이드라인 양쪽에 걸린다. `"Assist"` 단독은 안전하지만
마켓 검색에서 묻힌다. **게시 전에 결정할 것.** 지금 바꾸면 `package.json` 한 줄이다.

**아직 없는 것** — 아이콘(`icon.png`), 릴리스 워크플로, `.github/`. neon-glow의
`tools/release.js`와 `.github/workflows/`를 그대로 가져다 쓸 수 있는지 볼 것.

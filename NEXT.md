# NEXT

**끝났다의 정의** — `Alt+G` 한 번으로 선언부↔정의부를 왕복할 수 있고, 내 C++
프로젝트에서 하루 써봐도 안 거슬린다.

**여기까지 됨** — 스캐폴드와 `roundTrip.go` 구현까지. 체인(definition →
declaration → implementation)을 순서대로 물어보고 **커서가 선 자리가 아닌 첫 답**을
택하는 게 전부다. 언어 서버에 다 위임하므로 파서가 없다. 문법은 통과했지만
**실기에서 한 번도 안 눌러봤다.**

**다음 할 것** — `F5`로 띄워서 clangd나 cpptools가 깔린 C++ 프로젝트에서 네 가지
자리를 확인할 것: 호출부, `.cpp`의 정의부, 헤더의 선언부, 가상 함수. 특히
**헤더 선언부에서 눌렀을 때 `.cpp`로 가는지**가 핵심이고, 여기가 깨지면 `isHere`의
range 판정(`targetSelectionRange` 대 `targetRange`)부터 의심할 것.

**막힌 것** — 없음. 다만 게시 전에 확장 이름을 확정해야 한다. `vscode-round-trip`은
가안이고, 지금 바꾸면 `package.json`·폴더명·리포지토리 URL 세 군데다.
그리고 아이콘(`icon.png`)과 릴리스 워크플로는 아직 없다 — neon-glow의
`tools/release.js`와 `.github/workflows/`를 가져다 쓸 수 있는지 볼 것.

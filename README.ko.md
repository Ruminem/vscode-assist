# Round Trip

`Alt+G`로 정의부에 간다. 정의부에서 한 번 더 누르면 선언부로 돌아온다.
키 하나로 왕복.

VS Code에는 `Go to Definition`, `Go to Declaration`, `Go to Implementation`이
서로 다른 키에 따로 걸려 있다. 하루에 백 번 하는 동작치고는 키가 두 개 많다 —
어차피 커서가 놓인 자리마다 셋 중 쓸모 있는 답을 내는 건 하나뿐이기 때문이다.
Round Trip은 이 셋을 순서대로 물어보고, **지금 서 있는 자리가 아닌 첫 번째 답**을
택한다.

Visual Assist를 쓰던 사람이면 익숙한 동작이다. 그 제품과 무관한 별개의 확장이며,
코드를 가져다 쓴 부분은 없다.

## 판단 방식

누를 때마다 설정된 체인을 순서대로 훑는다.

| 커서 위치 | 답하는 provider | 도착지 |
| --- | --- | --- |
| 호출부 | `definition` | 정의부 |
| `.cpp`의 정의부 | `declaration` | 헤더의 선언부 |
| 헤더의 선언부 | `definition` | `.cpp`의 정의부 |
| 가상 함수의 기반 선언 | `implementation` | 오버라이드들 |

**커서가 놓인 자리밖에 못 가리키는 provider는 "답이 없다"로 취급하고** 다음
링크로 넘어간다. 이 규칙 하나가 단방향 명령 셋을 왕복으로 바꾼다.

분석은 전부 언어 서버 몫이다 — clangd, cpptools, rust-analyzer, tsserver.
이 확장은 파서도 인덱스도 갖지 않는다. 그래서 서버가 있는 언어라면 다 되고,
정확도는 그 서버의 정확도와 정확히 같다.

## 설정

| 설정 | 기본값 | |
| --- | --- | --- |
| `roundTrip.chain` | `["definition", "declaration", "implementation"]` | 물어볼 provider와 그 순서. |
| `roundTrip.pickWhenAmbiguous` | `true` | 여러 곳이 답하면 목록을 띄운다. 끄면 첫 결과로 바로 간다. |

## 키 바꾸기

기본은 `Alt+G`. 바꾸려면 키보드 단축키에서 `Round Trip`을 찾거나
`keybindings.json`에 직접 적는다.

```json
{ "key": "alt+g", "command": "roundTrip.go", "when": "editorTextFocus" }
```

되돌아오는 건 VS Code의 `Go Back`(`Alt+Left`)이 그대로 해준다 — 이 확장의
점프도 같은 탐색 기록에 남는다.

## 개발

빌드 단계도 의존성도 없다. 클론하고 열어서 `F5`를 누르면 확장이 올라간 VS Code
창이 하나 더 뜬다.

## 라이선스

MIT

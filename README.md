# 닮은꼴 찾기 (Look-alike Finder)

송년회 부스용 프로그램입니다. 왼쪽에 기준 사진이, 오른쪽에 내 카메라 화면이 나란히 표시됩니다.

## 바로 실행

https://blackbean0.github.io/lookalike-finder-web/

- PC 브라우저(Chrome/Edge)에서 열면 오른쪽에 웹캠이 잡힙니다.
- 휴대폰에서 열려면 카메라 권한을 허용해 주세요. HTTPS 링크라 그대로 동작합니다.
- 휴대폰을 PC 카메라로 쓰려면 DroidCam/Iriun 같은 앱을 PC에 설치한 뒤 PC 브라우저로 열면 됩니다.

## 조작

| 키 | 동작 |
|---|---|
| Space | 다음 사진 |
| ← | 이전 사진 |
| C | 카메라 전환 |
| 휠 / 버튼 | 카메라 확대·축소 |

## 사진 바꾸기

`photos` 폴더의 이미지를 교체하고 `photos.json` 목록을 갱신하면 됩니다.
(원본 작업 폴더에서는 `start.bat` 이 `make_list.py` 로 목록을 자동 생성합니다.)

(() => {
  'use strict';

  const PHOTO_DIR = 'photos/';
  const EMPTY_MESSAGE = '사진이 없습니다. photos 폴더에 이미지를 넣고 start.bat을 다시 실행해주세요.';

  // v1.1: 핸드폰 카메라를 1순위로 고른다 (v1.0은 반대로 피했다)
  const PHONE_CAMERA_PATTERN = /DroidCam|Iriun|Camo|EpocCam|가상 카메라|Virtual Camera|Connected Camera|연결 카메라/i;
  const OTHER_VIRTUAL_CAMERA_PATTERN = /Virtual|OBS|ManyCam|XSplit/i;

  const RECONNECT_DELAY_MS = 3000;
  const RETRY_INTERVAL_MS = 5000;
  const DEVICE_CHANGE_DELAY_MS = 1000;
  const CAMERA_STATUS_MS = 3000;

  const DISCONNECTED_MESSAGE = '카메라 연결이 끊겼습니다. 핸드폰 연결을 확인해주세요.';

  const photoEl = document.getElementById('photo');
  const photoMsg = document.getElementById('photoMessage');
  const videoEl = document.getElementById('camera');
  const cameraMsg = document.getElementById('cameraMessage');
  const cameraStatusEl = document.getElementById('cameraStatus');
  const counterEl = document.getElementById('counter');

  /** @type {string[]} */
  let photos = [];
  let index = 0;

  /* ---------------- 사진 ---------------- */

  function photoUrl(name) {
    return PHOTO_DIR + encodeURIComponent(name);
  }

  function showPhotoMessage(text) {
    photoEl.hidden = true;
    photoMsg.textContent = text;
    photoMsg.hidden = false;
  }

  function render() {
    if (photos.length === 0) {
      counterEl.textContent = '0 / 0';
      return;
    }
    photoEl.src = photoUrl(photos[index]);
    photoEl.hidden = false;
    photoMsg.hidden = true;
    counterEl.textContent = `${index + 1} / ${photos.length}`;
  }

  function move(step) {
    if (photos.length === 0) return;
    if (photos.length === 1) {
      render();
      return;
    }
    index = (index + step + photos.length) % photos.length;
    render();
  }

  async function loadPhotos() {
    try {
      const res = await fetch('photos.json', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`photos.json 요청 실패 (HTTP ${res.status})`);
      }
      const list = await res.json();
      photos = Array.isArray(list) ? list.filter((name) => typeof name === 'string') : [];
    } catch (err) {
      console.error(err);
      photos = [];
    }

    if (photos.length === 0) {
      showPhotoMessage(EMPTY_MESSAGE);
      counterEl.textContent = '0 / 0';
      return;
    }

    // 30장 사전 로드 — 전환 시 지연 제거
    for (const name of photos) {
      const img = new Image();
      img.src = photoUrl(name);
    }

    index = 0;
    render();
  }

  /* ---------------- 키 입력 ---------------- */

  window.addEventListener('keydown', (event) => {
    // 키를 누르고 있어도 1회만 처리
    if (event.repeat) {
      event.preventDefault();
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      move(1);
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      move(-1);
    } else if (event.code === 'KeyC') {
      event.preventDefault();
      cycleCamera();
    }
  });

  /* ---------------- 카메라 ---------------- */

  let currentStream = null;
  let currentDeviceId = null;
  /** @type {MediaDeviceInfo[]} */
  let deviceList = [];
  let reconnectTimer = null;
  let statusTimer = null;
  let switching = false;

  function normalizeLabel(label) {
    return (label || '').normalize('NFC');
  }

  function showCameraMessage(text) {
    videoEl.hidden = true;
    cameraMsg.textContent = text;
    cameraMsg.hidden = false;
  }

  function showCameraStatus(text) {
    if (!cameraStatusEl) return;
    cameraStatusEl.textContent = text;
    cameraStatusEl.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      cameraStatusEl.hidden = true;
    }, CAMERA_STATUS_MS);
  }

  function openStream(deviceId) {
    const video = {
      width: { ideal: 1280 },
      height: { ideal: 720 },
    };
    if (deviceId) {
      video.deviceId = { exact: deviceId };
    }
    return navigator.mediaDevices.getUserMedia({ audio: false, video });
  }

  function rankDevices(devices) {
    return devices
      .map((device, order) => {
        const label = normalizeLabel(device.label);
        let score = 2;
        if (PHONE_CAMERA_PATTERN.test(label)) {
          score = 0;
        } else if (!OTHER_VIRTUAL_CAMERA_PATTERN.test(label)) {
          score = 1;
        }
        return { device, order, score };
      })
      .sort((a, b) => a.score - b.score || a.order - b.order)
      .map((entry) => entry.device);
  }

  async function refreshDeviceList() {
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const inputs = devices.filter((device) => device.kind === 'videoinput' && device.deviceId);
    deviceList = rankDevices(inputs);
    return deviceList;
  }

  function stopStream() {
    if (!currentStream) return;
    currentStream.getTracks().forEach((track) => {
      // 의도적으로 끊는 것이므로 끊김 이벤트가 발생하지 않게 한다
      track.onended = null;
      track.stop();
    });
    currentStream = null;
  }

  function attachStream(stream) {
    currentStream = stream;
    const track = stream.getVideoTracks()[0] || null;

    if (track) {
      const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
      if (settings.deviceId) {
        currentDeviceId = settings.deviceId;
      }
      track.onended = handleTrackEnded;
    }

    videoEl.srcObject = stream;
    videoEl.hidden = false;
    cameraMsg.hidden = true;
    videoEl.play().catch(() => {});

    const label = track ? normalizeLabel(track.label) : '';
    showCameraStatus(`카메라: ${label || '알 수 없는 장치'}`);
  }

  function reportCameraError(err) {
    const name = err && err.name ? err.name : '';
    let text = `카메라를 시작할 수 없습니다. (${name || '알 수 없는 오류'})`;

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      text = '카메라 권한이 거부되었습니다. 주소창 옆 카메라 아이콘에서 허용해주세요.';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      text = '카메라를 찾을 수 없습니다.';
    } else if (name === 'NotReadableError') {
      text = '카메라를 사용할 수 없습니다. 다른 프로그램이 사용 중인지 확인해주세요.';
    }

    console.error(err);
    showCameraMessage(text);
  }

  function clearReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(delay) {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnect();
    }, delay);
  }

  function handleTrackEnded() {
    // 장치 전환 중 발생한 이벤트는 끊김으로 취급하지 않는다
    if (switching) return;
    currentStream = null;
    showCameraMessage(DISCONNECTED_MESSAGE);
    scheduleReconnect(RECONNECT_DELAY_MS);
  }

  async function openBestStream() {
    await refreshDeviceList();

    const candidates = [];
    if (currentDeviceId) {
      candidates.push(currentDeviceId);
    }
    for (const device of deviceList) {
      if (!candidates.includes(device.deviceId)) {
        candidates.push(device.deviceId);
      }
    }

    let lastError = null;
    for (const deviceId of candidates) {
      try {
        return await openStream(deviceId);
      } catch (err) {
        lastError = err;
        console.warn('camera open failed:', deviceId, err);
      }
    }

    // 장치 목록을 얻지 못한 경우에만 기본 카메라로 시도한다
    if (candidates.length === 0) {
      return openStream();
    }
    throw lastError || new Error('카메라를 열 수 없습니다.');
  }

  async function reconnect() {
    if (switching) {
      scheduleReconnect(RETRY_INTERVAL_MS);
      return;
    }

    switching = true;
    try {
      const stream = await openBestStream();
      stopStream();
      attachStream(stream);
    } catch (err) {
      console.warn('camera reconnect failed:', err);
      showCameraMessage(DISCONNECTED_MESSAGE);
      scheduleReconnect(RETRY_INTERVAL_MS);
    } finally {
      switching = false;
    }
  }

  async function switchTo(deviceId) {
    if (switching) return;

    switching = true;
    try {
      // 새 스트림을 먼저 연 뒤 기존 스트림을 닫아 화면이 검게 비지 않게 한다
      const stream = await openStream(deviceId);
      stopStream();
      attachStream(stream);
    } catch (err) {
      console.warn('camera switch failed:', err);
      showCameraStatus('카메라를 전환하지 못했습니다');
    } finally {
      switching = false;
    }
  }

  async function cycleCamera() {
    if (switching) return;

    if (deviceList.length === 0) {
      await refreshDeviceList();
    }
    if (deviceList.length === 0) {
      showCameraStatus('전환할 카메라가 없습니다');
      return;
    }
    if (deviceList.length === 1) {
      showCameraStatus('카메라 장치가 하나뿐입니다');
      return;
    }

    const currentIndex = deviceList.findIndex((device) => device.deviceId === currentDeviceId);
    const nextIndex = (currentIndex + 1) % deviceList.length;
    await switchTo(deviceList[nextIndex].deviceId);
  }

  async function connect() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraMessage('이 브라우저에서는 카메라를 사용할 수 없습니다. Chrome 또는 Edge로 열어주세요.');
      return;
    }

    let settled = false;
    const watchdog = setTimeout(() => {
      if (!settled) {
        showCameraMessage('카메라 응답이 없습니다. 주소창의 카메라 권한을 확인해주세요.');
      }
    }, 10000);

    try {
      // 1) 권한을 먼저 얻어야 장치 레이블이 노출된다
      const first = await openStream();
      settled = true;
      clearTimeout(watchdog);
      attachStream(first);

      // 2) 레이블이 채워진 목록에서 핸드폰을 1순위로 다시 고른다
      await refreshDeviceList();
      const top = deviceList[0];
      if (top && top.deviceId && top.deviceId !== currentDeviceId) {
        try {
          const preferred = await openStream(top.deviceId);
          stopStream();
          attachStream(preferred);
        } catch (err) {
          console.warn('preferred camera failed:', err);
        }
      }
    } catch (err) {
      settled = true;
      clearTimeout(watchdog);
      reportCameraError(err);
    }
  }

  if (navigator.mediaDevices) {
    navigator.mediaDevices.ondevicechange = () => {
      refreshDeviceList();
      if (!currentStream || !currentStream.active) {
        scheduleReconnect(DEVICE_CHANGE_DELAY_MS);
      }
    };
  }

  /* ---------------- 시작 ---------------- */

  clearReconnect();
  loadPhotos();
  connect();
})();
// 카메라 화면 확대·축소
(() => {
  const video = document.getElementById("camera");
  const panel = document.querySelector(".panel-camera");

  if (!video || !panel) return;
  if (panel.querySelector(".camera-zoom-controls")) return;

  let zoom = 1;
  const minZoom = 1;
  const maxZoom = 3;
  const step = 0.1;

  const controls = document.createElement("div");
  controls.className = "camera-zoom-controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "카메라 확대 및 축소");

  controls.innerHTML = `
    <button type="button" class="zoom-out"
            aria-label="카메라 축소">−</button>
    <output aria-live="polite">1.0×</output>
    <button type="button" class="zoom-in"
            aria-label="카메라 확대">+</button>
  `;

  panel.appendChild(controls);

  const minus = controls.querySelector(".zoom-out");
  const plus = controls.querySelector(".zoom-in");
  const label = controls.querySelector("output");

  function setZoom(nextZoom) {
    zoom = Math.round(
      Math.max(minZoom, Math.min(maxZoom, nextZoom)) * 10
    ) / 10;

    video.style.setProperty("--camera-zoom", zoom);
    label.textContent = `${zoom.toFixed(1)}×`;

    minus.disabled = zoom <= minZoom;
    plus.disabled = zoom >= maxZoom;
  }

  minus.addEventListener("click", () => setZoom(zoom - step));
  plus.addEventListener("click", () => setZoom(zoom + step));

  panel.addEventListener("wheel", (event) => {
    // 브라우저 자체 확대·축소 단축키는 유지
    if (event.ctrlKey || event.metaKey) return;
    if (event.deltaY === 0) return;

    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? step : -step));
  }, { passive: false });

  // 버튼에 포커스가 있어도 기존 Space 사진 넘기기와 충돌 방지
  controls.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
      event.stopPropagation();
    }
  });

  setZoom(1);
})();
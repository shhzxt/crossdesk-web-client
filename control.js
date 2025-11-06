// 控制模块：处理键鼠、协议封装与 DataChannel 交互
// 依赖：页面已有的 DOM 元素（video、日志与输入区域）

(function () {
  const dataChannelStateSpan = document.getElementById('datachannel-state');
  const dataChannelLog = document.getElementById('data-channel');
  const dcInput = document.getElementById('dc-input');
  const dcSendBtn = document.getElementById('dc-send');
  const audioCaptureChk = document.getElementById('audio-capture');
  const displayIdInput = document.getElementById('display-id');

  let dc = null;

  // Pointer/mouse 状态
  let lastPointerPos = null;
  let isPointerLocked = false;
  let videoRect = null;
  let normalizedPos = { x: 0.5, y: 0.5 };
  let _pointerlock_toast_timeout = null;

  // 协议枚举
  const ControlType = { mouse: 0, keyboard: 1, audio_capture: 2, host_infomation: 3, display_id: 4 };
  const MouseFlag = { move: 0, left_down: 1, left_up: 2, right_down: 3, right_up: 4, middle_down: 5, middle_up: 6, wheel_vertical: 7, wheel_horizontal: 8 };

  function showPointerLockToast(text, duration = 2500) {
    let el = document.getElementById('pointerlock-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pointerlock-toast';
      Object.assign(el.style, {
        position: 'fixed', left: '50%', bottom: '24px', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 12px', borderRadius: '6px',
        fontSize: '13px', zIndex: '9999', pointerEvents: 'none', opacity: '1', transition: 'opacity 0.2s'
      });
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.style.opacity = '1';
    if (_pointerlock_toast_timeout) clearTimeout(_pointerlock_toast_timeout);
    _pointerlock_toast_timeout = setTimeout(() => { el.style.opacity = '0'; _pointerlock_toast_timeout = null; }, duration);
  }

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }

  function logSent(obj) {
    if (dataChannelLog) {
      dataChannelLog.textContent += '> ' + JSON.stringify(obj) + '\n';
      dataChannelLog.scrollTop = dataChannelLog.scrollHeight;
    }
  }

  // 对外：设置显示器 ID 的入口（按钮调用）
  function setDisplayId() {
    if (!displayIdInput) return;
    let id = '';
    if (displayIdInput.tagName === 'SELECT') {
      id = displayIdInput.value || '';
    } else {
      id = (displayIdInput.value && displayIdInput.value.trim()) ? displayIdInput.value.trim() : '';
    }
    if (!id) id = (window.CROSSDESK_TRACK_ID || '');
    if (!id) { alert('暂无可用 track id'); return; }
    // 同步标题显示
    const trackIdEl = document.getElementById('track-id');
    if (trackIdEl) trackIdEl.textContent = id;
    sendDisplayId(id);
  }

  // 发送：鼠标/键盘/音频/显示器
  function sendRemoteActionAt(normX, normY, flag, s = 0) {
    const numericFlag = (typeof flag === 'string') ? (MouseFlag[flag] ?? MouseFlag.move) : (flag | 0);
    const remote_action = { type: ControlType.mouse, mouse: { x: clamp01(normX), y: clamp01(normY), s: (s | 0), flag: numericFlag } };
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(remote_action));
    logSent(remote_action);
  }

  function sendKeyboardAction(keyValue, isDown) {
    const remote_action = { type: ControlType.keyboard, keyboard: { key_value: keyValue | 0, flag: isDown ? 0 : 1 } };
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(remote_action));
    logSent(remote_action);
  }

  function sendAudioCapture(enabled) {
    const remote_action = { type: ControlType.audio_capture, audio_capture: !!enabled };
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(remote_action));
    logSent(remote_action);
  }

  function sendDisplayId(id) {
    // 约定：显示器ID即 track id（字符串）
    const remote_action = { type: ControlType.display_id, display_id: id };
    if (dc && dc.readyState === 'open') dc.send(JSON.stringify(remote_action));
    logSent(remote_action);
  }

  // 发送自由文本（仅限协议 JSON）
  function sendDataChannelMessage() {
    const msg = (dcInput && dcInput.value) ? dcInput.value.trim() : '';
    if (!msg) return;
    if (!dc || dc.readyState !== 'open') { alert('数据通道未打开，无法发送消息。'); return; }
    try {
      const obj = JSON.parse(msg);
      const isObject = obj && typeof obj === 'object' && !Array.isArray(obj);
      const hasNumericType = isObject && typeof obj.type === 'number';
      const hasValidPayload = (('mouse' in obj) || ('keyboard' in obj) || ('audio_capture' in obj) || ('display_id' in obj));
      if (!hasNumericType || !hasValidPayload) { alert('仅支持发送 RemoteAction 协议 JSON。'); return; }
      dc.send(JSON.stringify(obj));
      logSent(obj);
      if (dcInput) dcInput.value = '';
    } catch (e) { alert('请输入合法的 JSON。'); }
  }

  // 鼠标与键盘监听
  function setupKeyboardListeners() {
    const onKeyDown = (e) => { const keyValue = (typeof e.keyCode === 'number') ? e.keyCode : 0; sendKeyboardAction(keyValue, true); };
    const onKeyUp = (e) => { const keyValue = (typeof e.keyCode === 'number') ? e.keyCode : 0; sendKeyboardAction(keyValue, false); };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
  }

  function sendMouseEvent(event) {
    const video = document.getElementById('video');
    if (!video) return;
    if (!videoRect) videoRect = video.getBoundingClientRect();

    if (event.type === 'mousedown') {
      if (event.clientX >= videoRect.left && event.clientX <= videoRect.right && event.clientY >= videoRect.top && event.clientY <= videoRect.bottom) {
        normalizedPos.x = (event.clientX - videoRect.left) / videoRect.width;
        normalizedPos.y = (event.clientY - videoRect.top) / videoRect.height;
        try { video.requestPointerLock && video.requestPointerLock(); } catch (e) { }
        const flag = event.button === 0 ? 'left_down' : (event.button === 2 ? 'right_down' : 'middle_down');
        sendRemoteActionAt(normalizedPos.x, normalizedPos.y, flag);
      }
      return;
    }

    if (event.type === 'mouseup') {
      if (isPointerLocked) {
        const flag = event.button === 0 ? 'left_up' : (event.button === 2 ? 'right_up' : 'middle_up');
        sendRemoteActionAt(normalizedPos.x, normalizedPos.y, flag);
      } else if (event.clientX >= videoRect.left && event.clientX <= videoRect.right && event.clientY >= videoRect.top && event.clientY <= videoRect.bottom) {
        const x = (event.clientX - videoRect.left) / videoRect.width;
        const y = (event.clientY - videoRect.top) / videoRect.height;
        const flag = event.button === 0 ? 'left_up' : (event.button === 2 ? 'right_up' : 'middle_up');
        sendRemoteActionAt(x, y, flag);
      }
      return;
    }

    if (event.type === 'mousemove') {
      if (isPointerLocked) {
        videoRect = video.getBoundingClientRect();
        normalizedPos.x = clamp01(normalizedPos.x + (event.movementX / videoRect.width));
        normalizedPos.y = clamp01(normalizedPos.y + (event.movementY / videoRect.height));
        sendRemoteActionAt(normalizedPos.x, normalizedPos.y, 'move');
      } else {
        if (event.clientX >= videoRect.left && event.clientX <= videoRect.right && event.clientY >= videoRect.top && event.clientY <= videoRect.bottom) {
          const x = (event.clientX - videoRect.left) / videoRect.width;
          const y = (event.clientY - videoRect.top) / videoRect.height;
          sendRemoteActionAt(x, y, 'move');
        }
      }
      return;
    }

    if (event.type === 'wheel') {
      let x, y;
      if (isPointerLocked) { x = normalizedPos.x; y = normalizedPos.y; }
      else {
        videoRect = video.getBoundingClientRect();
        if (!(event.clientX >= videoRect.left && event.clientX <= videoRect.right && event.clientY >= videoRect.top && event.clientY <= videoRect.bottom)) return;
        x = (event.clientX - videoRect.left) / videoRect.width;
        y = (event.clientY - videoRect.top) / videoRect.height;
      }
      const flag = event.deltaY === 0 ? 'wheel_horizontal' : 'wheel_vertical';
      sendRemoteActionAt(x, y, flag, event.deltaY || event.deltaX);
      return;
    }
  }

  function setupMouseListeners() {
    const video = document.getElementById('video');
    if (!video) return;

    try { video.style.touchAction = 'none'; } catch (e) { }

    document.addEventListener('pointerlockchange', () => {
      isPointerLocked = (document.pointerLockElement === video);
      if (dataChannelLog) { dataChannelLog.textContent += `[pointerlock ${isPointerLocked ? 'entered' : 'exited'}]\n`; dataChannelLog.scrollTop = dataChannelLog.scrollHeight; }
      if (isPointerLocked) { videoRect = video.getBoundingClientRect(); }
      else { videoRect = null; showPointerLockToast('已退出鼠标锁定，按 Esc 或点击视频重新锁定（释放可按 Ctrl+Esc）', 3000); }
    });
    document.addEventListener('pointerlockerror', () => { showPointerLockToast('鼠标锁定失败', 2500); });
    document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 'Escape') { if (document.exitPointerLock) document.exitPointerLock(); } });

    // Pointer Events
    video.addEventListener('pointerdown', (e) => {
      if (e.button < 0) return; e.preventDefault();
      lastPointerPos = { x: e.clientX, y: e.clientY };
      try { video.setPointerCapture && video.setPointerCapture(e.pointerId); } catch (err) { }
      sendMouseEvent({ type: 'mousedown', clientX: e.clientX, clientY: e.clientY, button: (typeof e.button === 'number') ? e.button : 0 });
    }, { passive: false });

    document.addEventListener('pointermove', (e) => {
      const movementX = (lastPointerPos ? (e.clientX - lastPointerPos.x) : 0);
      const movementY = (lastPointerPos ? (e.clientY - lastPointerPos.y) : 0);
      lastPointerPos = { x: e.clientX, y: e.clientY };
      sendMouseEvent({ type: 'mousemove', clientX: e.clientX, clientY: e.clientY, movementX, movementY });
    }, { passive: false });

    document.addEventListener('pointerup', (e) => {
      try { video.releasePointerCapture && video.releasePointerCapture(e.pointerId); } catch (err) { }
      sendMouseEvent({ type: 'mouseup', clientX: e.clientX, clientY: e.clientY, button: (typeof e.button === 'number') ? e.button : 0 });
      lastPointerPos = null;
    });
    document.addEventListener('pointercancel', () => { lastPointerPos = null; });

    if (!window.PointerEvent) {
      video.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        const t = e.touches[0]; lastPointerPos = { x: t.clientX, y: t.clientY };
        e.preventDefault(); sendMouseEvent({ type: 'mousedown', clientX: t.clientX, clientY: t.clientY, button: 0 });
      }, { passive: false });
      document.addEventListener('touchmove', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        const t = e.touches[0]; const movementX = (lastPointerPos ? (t.clientX - lastPointerPos.x) : 0); const movementY = (lastPointerPos ? (t.clientY - lastPointerPos.y) : 0);
        lastPointerPos = { x: t.clientX, y: t.clientY };
        e.preventDefault(); sendMouseEvent({ type: 'mousemove', clientX: t.clientX, clientY: t.clientY, movementX, movementY });
      }, { passive: false });
      document.addEventListener('touchend', (e) => {
        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (t) { sendMouseEvent({ type: 'mouseup', clientX: t.clientX, clientY: t.clientY, button: 0 }); }
        else { sendMouseEvent({ type: 'mouseup', clientX: 0, clientY: 0, button: 0 }); }
        lastPointerPos = null;
      }, { passive: false });
    }

    document.addEventListener('wheel', sendMouseEvent, { passive: true });
  }

  // DataChannel 生命周期钩子（供 WebRTC 调用）
  function onDataChannelOpen(dataChannel) {
    dc = dataChannel;
    if (dataChannelStateSpan) dataChannelStateSpan.textContent = 'open';
    if (dataChannelLog) { dataChannelLog.textContent += '[datachannel open]\n'; dataChannelLog.scrollTop = dataChannelLog.scrollHeight; }
    setupMouseListeners();
    setupKeyboardListeners();
    if (dcInput) dcInput.disabled = false;
    if (dcSendBtn) dcSendBtn.disabled = false;
    if (audioCaptureChk) { audioCaptureChk.disabled = true; audioCaptureChk.checked = false; audioCaptureChk.disabled = false; audioCaptureChk.onchange = (e) => sendAudioCapture(!!e.target.checked); }
    if (displayIdInput) displayIdInput.disabled = false;
    const setDisplayBtn = document.getElementById('set-display');
    if (setDisplayBtn) setDisplayBtn.disabled = false;
  }

  function onDataChannelClose() {
    if (dataChannelStateSpan) dataChannelStateSpan.textContent = 'closed';
    if (dataChannelLog) { dataChannelLog.textContent += '[datachannel closed]\n'; dataChannelLog.scrollTop = dataChannelLog.scrollHeight; }
    if (dcInput) { dcInput.disabled = true; dcInput.value = ''; }
    if (dcSendBtn) dcSendBtn.disabled = true;
    if (audioCaptureChk) { audioCaptureChk.disabled = true; audioCaptureChk.checked = false; audioCaptureChk.onchange = null; }
    if (displayIdInput) displayIdInput.disabled = true;
    const setDisplayBtn = document.getElementById('set-display');
    if (setDisplayBtn) setDisplayBtn.disabled = true;
    dc = null;
  }

  // 暴露到全局
  window.CrossDeskControl = {
    onDataChannelOpen,
    onDataChannelClose,
    sendDataChannelMessage,
    setDisplayId,
  };
})();



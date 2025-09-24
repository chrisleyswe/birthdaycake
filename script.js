document.addEventListener("DOMContentLoaded", () => {
  const onlyCandle = document.getElementById("onlyCandle");

  let audioContext, analyser, mic, rafId;
  let baselineRMS = 0, baselineHF = 0, calibrated = false, started = false;
  let overlay = null;

  function computeRMS(uint8) {
    let sumSq = 0;
    for (let i = 0; i < uint8.length; i++) {
      const v = (uint8[i] - 128) / 128;
      sumSq += v * v;
    }
    return Math.sqrt(sumSq / uint8.length) * 100; 
  }

  function computeHighFreqAvg(freqData) {
    const start = Math.floor(freqData.length * 0.35);
    const end   = Math.floor(freqData.length * 0.9);
    let sum = 0, n = 0;
    for (let i = start; i < end; i++) { sum += freqData[i]; n++; }
    return n ? sum / n : 0;
  }

  function createGestureGate() {
    overlay = document.createElement("div");
    overlay.className = "gesture-gate";
    const start = async () => {
      if (started) return;
      started = true;
      await initMic(true);    
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
      overlay = null;
    };
    overlay.addEventListener("touchend", start, { passive: true });
    overlay.addEventListener("click", start);
    document.body.appendChild(overlay);
  }

  function startAnalyser(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;

    mic = audioContext.createMediaStreamSource(stream);
    mic.connect(analyser);

    calibrate().then(loopDetect);
  }

  function calibrate() {
    calibrated = false;
    const rmsBuf = [], hfBuf = [];
    const td = new Uint8Array(analyser.fftSize);
    const fd = new Uint8Array(analyser.frequencyBinCount);

    return new Promise(resolve => {
      const t0 = performance.now();
      function step() {
        analyser.getByteTimeDomainData(td);
        analyser.getByteFrequencyData(fd);
        rmsBuf.push(computeRMS(td));
        hfBuf.push(computeHighFreqAvg(fd));

        if (performance.now() - t0 < 1200) {
          requestAnimationFrame(step);
        } else {
          rmsBuf.sort((a,b)=>a-b); hfBuf.sort((a,b)=>a-b);
          baselineRMS = rmsBuf[Math.floor(rmsBuf.length/2)] || 0;
          baselineHF  = hfBuf[Math.floor(hfBuf.length/2)] || 0;
          calibrated = true;
          resolve();
        }
      }
      step();
    });
  }

  function isBlowing() {
    const td = new Uint8Array(analyser.fftSize);
    const fd = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(td);
    analyser.getByteFrequencyData(fd);

    const rms = computeRMS(td);
    const hf  = computeHighFreqAvg(fd);

    const rmsThresh = Math.max(baselineRMS + 5, 10);
    const hfThresh  = Math.max(baselineHF  + 6, 14);
    const hissStrong = hf > (baselineHF + 18);     
    const combined   = (hf > hfThresh) && (rms > rmsThresh || rms > baselineRMS + 12);

    return hissStrong || combined;
  }

  function loopDetect() {
    cancelAnimationFrame(rafId);
    const tick = () => {
      if (!onlyCandle.classList.contains("out") && calibrated) {
        if (isBlowing()) {
          onlyCandle.classList.add("out"); 
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    tick();
  }

  async function initMic(fromGesture = false) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        }
      });

      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContext.state === "suspended") {
        try { await audioContext.resume(); } catch (_) {}
      }

      startAnalyser(stream);
    } catch (err) {
      if (!fromGesture) {
        createGestureGate(); 
      }
    }
  }

  initMic(false);

  const tryResume = async () => {
    if (audioContext && audioContext.state === "suspended") {
      try { await audioContext.resume(); } catch (_) {}
    }
  };
  document.body.addEventListener("touchend", tryResume, { passive: true });
  document.body.addEventListener("click", tryResume);
});

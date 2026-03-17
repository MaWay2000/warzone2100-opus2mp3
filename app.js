(function () {
  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const convertBtn = document.getElementById("convertBtn");
  const fileBox = document.getElementById("fileBox");
  const statusBox = document.getElementById("status");
  const statusText = document.getElementById("statusText");
  const progressBar = document.getElementById("progress");
  const resultBox = document.getElementById("result");
  const resultText = document.getElementById("resultText");
  const downloadBtn = document.getElementById("downloadBtn");
  const audioPreview = document.getElementById("audioPreview");

  const MP3_BITRATE = 192;
  const MP3_BLOCK_SIZE = 1152;

  let selectedFile = null;
  let activeUrl = null;
  let converting = false;

  function prettyBytes(bytes) {
    const units = ["B", "KB", "MB", "GB"];
    let unitIndex = 0;
    let value = bytes || 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    const digits = value >= 10 || unitIndex === 0 ? 0 : 1;
    return value.toFixed(digits) + " " + units[unitIndex];
  }

  function formatDuration(seconds) {
    const wholeSeconds = Math.max(0, Math.round(seconds || 0));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainingSeconds = wholeSeconds % 60;
    return String(minutes) + ":" + String(remainingSeconds).padStart(2, "0");
  }

  function buildOutputFileName(fileName) {
    if (!fileName) {
      return "converted.mp3";
    }

    if (/\.[^.]+$/.test(fileName)) {
      return fileName.replace(/\.[^.]+$/, "") + ".mp3";
    }

    return fileName + ".mp3";
  }

  function setStatus(type, text, progress) {
    statusBox.className = "panel " + type;
    statusText.textContent = text;

    if (typeof progress === "number") {
      progressBar.hidden = false;
      progressBar.value = Math.max(0, Math.min(100, progress));
      return;
    }

    progressBar.hidden = true;
  }

  function resetResult() {
    resultBox.hidden = true;
    audioPreview.removeAttribute("src");
    audioPreview.load();

    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
      activeUrl = null;
    }
  }

  function updateActionState() {
    convertBtn.disabled = !selectedFile || converting;
    convertBtn.textContent = converting ? "Converting..." : "Convert to MP3";
  }

  function setFile(file) {
    selectedFile = file || null;
    resetResult();

    if (!selectedFile) {
      fileBox.hidden = true;
      setStatus("warn", "Waiting for file.");
      updateActionState();
      return;
    }

    fileBox.hidden = false;
    fileBox.innerHTML =
      "<strong>Selected file</strong>" +
      '<div class="small mono status-text">' +
      selectedFile.name +
      " (" +
      prettyBytes(selectedFile.size) +
      ")</div>";

    setStatus("warn", "File ready. Click convert.");
    updateActionState();
  }

  function getAudioContext() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextCtor) {
      throw new Error("This browser does not support Web Audio decoding.");
    }

    return new AudioContextCtor();
  }

  function floatToInt16(float32Array) {
    const pcm = new Int16Array(float32Array.length);

    for (let index = 0; index < float32Array.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, float32Array[index]));
      pcm[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    return pcm;
  }

  function pickChannels(audioBuffer) {
    if (audioBuffer.numberOfChannels <= 1) {
      return {
        channels: 1,
        left: audioBuffer.getChannelData(0),
        right: null
      };
    }

    return {
      channels: 2,
      left: audioBuffer.getChannelData(0),
      right: audioBuffer.getChannelData(1)
    };
  }

  function yieldToUi() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  async function encodeMp3(audioBuffer) {
    if (!window.lamejs || typeof window.lamejs.Mp3Encoder !== "function") {
      throw new Error("MP3 encoder library failed to load.");
    }

    const channelData = pickChannels(audioBuffer);
    const leftPcm = floatToInt16(channelData.left);
    const rightPcm = channelData.right ? floatToInt16(channelData.right) : null;
    const encoder = new window.lamejs.Mp3Encoder(
      channelData.channels,
      audioBuffer.sampleRate,
      MP3_BITRATE
    );
    const chunks = [];
    const totalSamples = leftPcm.length;
    const totalBlocks = Math.max(1, Math.ceil(totalSamples / MP3_BLOCK_SIZE));

    for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
      const start = blockIndex * MP3_BLOCK_SIZE;
      const end = Math.min(start + MP3_BLOCK_SIZE, totalSamples);
      const leftChunk = leftPcm.subarray(start, end);
      let encodedChunk;

      if (rightPcm) {
        const rightChunk = rightPcm.subarray(start, end);
        encodedChunk = encoder.encodeBuffer(leftChunk, rightChunk);
      } else {
        encodedChunk = encoder.encodeBuffer(leftChunk);
      }

      if (encodedChunk.length > 0) {
        chunks.push(new Uint8Array(encodedChunk));
      }

      if (blockIndex % 20 === 0 || blockIndex === totalBlocks - 1) {
        const progress = 45 + Math.round(((blockIndex + 1) / totalBlocks) * 50);
        setStatus("warn", "Encoding MP3...", progress);
        await yieldToUi();
      }
    }

    const finalChunk = encoder.flush();
    if (finalChunk.length > 0) {
      chunks.push(new Uint8Array(finalChunk));
    }

    return new Blob(chunks, { type: "audio/mpeg" });
  }

  async function decodeAudio(file) {
    const audioContext = getAudioContext();

    try {
      setStatus("warn", "Reading file...", 10);
      const arrayBuffer = await file.arrayBuffer();

      setStatus("warn", "Decoding audio...", 25);
      return await audioContext.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      if (audioContext.state !== "closed") {
        await audioContext.close();
      }
    }
  }

  async function convertSelectedFile() {
    if (!selectedFile || converting) {
      return;
    }

    converting = true;
    updateActionState();
    resetResult();

    try {
      const audioBuffer = await decodeAudio(selectedFile);
      const mp3Blob = await encodeMp3(audioBuffer);
      const outputFileName = buildOutputFileName(selectedFile.name);

      activeUrl = URL.createObjectURL(mp3Blob);
      downloadBtn.href = activeUrl;
      downloadBtn.download = outputFileName;
      audioPreview.src = activeUrl;
      resultText.textContent =
        outputFileName +
        " is ready. Size: " +
        prettyBytes(mp3Blob.size) +
        ". Duration: " +
        formatDuration(audioBuffer.duration);
      resultBox.hidden = false;

      setStatus("ok", "Conversion finished.", 100);
    } catch (error) {
      console.error(error);
      setStatus(
        "bad",
        "Error: " +
          (error && error.message
            ? error.message
            : "Could not decode or encode this file in the current browser.")
      );
    } finally {
      converting = false;
      updateActionState();
    }
  }

  ["dragenter", "dragover"].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.add("drag");
    });
  });

  ["dragleave", "drop"].forEach(function (eventName) {
    dropzone.addEventListener(eventName, function (event) {
      event.preventDefault();
      dropzone.classList.remove("drag");
    });
  });

  dropzone.addEventListener("drop", function (event) {
    const files = event.dataTransfer && event.dataTransfer.files;
    setFile(files && files[0] ? files[0] : null);
  });

  fileInput.addEventListener("change", function (event) {
    const files = event.target.files;
    setFile(files && files[0] ? files[0] : null);
  });

  convertBtn.addEventListener("click", convertSelectedFile);

  window.addEventListener("beforeunload", function () {
    if (activeUrl) {
      URL.revokeObjectURL(activeUrl);
    }
  });

  updateActionState();
})();

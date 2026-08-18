    function getParallelism() {
      return clamp(Number(parallelismEl?.value || DEFAULT_PARALLELISM), 1, MAX_PARALLELISM);
    }

    function clamp(value, min, max) {
      if (!Number.isFinite(value)) return min;
      return Math.min(Math.max(Math.floor(value), min), max);
    }

    function setStatus(text, type) {
      statusEl.textContent = text || '';
      statusEl.className = 'xi-status' + (type ? ' ' + type : '');
    }


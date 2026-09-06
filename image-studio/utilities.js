    function getParallelism() {
      return Number.POSITIVE_INFINITY;
    }

    function clamp(value, min, max) {
      if (!Number.isFinite(value)) return min;
      return Math.min(Math.max(Math.floor(value), min), max);
    }

    function setStatus(text, type) {
      statusEl.textContent = text || '';
      statusEl.className = 'xi-status' + (type ? ' ' + type : '');
    }

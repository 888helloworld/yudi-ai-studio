    function handleAuthExpired(message) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      document.getElementById('loginPrompt').classList.add('show');
      document.body.classList.add('login-locked');
      generateBtn.disabled = true;
      if (polishPromptBtn) polishPromptBtn.disabled = true;
      if (detailSuiteBtn) detailSuiteBtn.disabled = true;
      setStatus(message || '登录已过期，请重新登录。', 'error');
    }
    async function initUser() {
      try {
        const res = await fetch('/api/user/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            handleAuthExpired(data.error || '登录已过期，请重新登录。');
            return;
          }
          throw new Error(data.error || '登录已失效');
        }
        const user = await res.json();
        document.getElementById('navUsername').textContent = user.username || '';
        updateNavPoints(user.points);
        await loadServerJobs();
        await loadSavedTasks();
      } catch (err) {
        setStatus(err.message || '用户信息读取失败，请刷新后再试。', 'error');
      }
    }

    function updateNavPoints(points) {
      if (typeof points !== 'number' || Number.isNaN(points)) return;
      document.getElementById('navPoints').textContent = points + ' 积分';
    }

    function appendSavedHistoryItems(history) {
      history
        .filter((item) => {
          if (item.sub_type !== 'xi-generate' && item.sub_type !== 'xi-edit') return false;
          const meta = parseJson(item.content) || {};
          return parseSavedImageUrls(item.image_url).length > 0 || meta.status === 'failed';
        })
        .slice()
        .reverse()
        .forEach((item) => {
          if (state.tasks.some((task) => task.saved && Number(task.historyId) === Number(item.id))) return;
          const imageUrls = parseSavedImageUrls(item.image_url);
          const meta = parseJson(item.content) || {};
          if (imageUrls.length === 0 && meta.status !== 'failed') return;
          const createdAtMs = parseHistoryTimestamp(item.created_at);
          const task = {
            id: 'saved-xi-' + item.id,
            historyId: item.id,
            index: item.id,
            status: meta.status === 'failed' ? 'failed' : 'done',
            mode: item.sub_type === 'xi-edit' ? 'edit' : 'generate',
            prompt: item.prompt || '',
            size: item.ratio || DEFAULT_SIZE,
            count: imageUrls.length || meta.count || 1,
            quality: meta.quality || 'medium',
            requestedQuality: meta.requested_quality || meta.quality || 'medium',
            actualQuality: meta.actual_quality || '',
            actualSize: meta.actual_size || '',
            billingOutputTokens: meta.billing_output_tokens || 0,
            sourceFiles: [],
            sourcePreviewUrls: meta.source_urls || [],
            sourceFileNames: meta.sources || (meta.source ? [meta.source] : []),
            sourceDimensions: meta.source_dimensions || [],
            outputDimensions: meta.output_dimensions || [],
            createdAt: formatHistoryTime(item.created_at),
            createdAtMs,
            submittedAtMs: createdAtMs,
            startedAtMs: 0,
            finishedAtMs: createdAtMs,
            durationMs: meta.duration_ms || 0,
            provider: meta.provider || '',
            fallbackReason: meta.fallback_reason || '',
            imageUrls,
            error: formatTaskError(meta.error || ''),
            saved: true
          };
          state.taskSeq = Math.max(state.taskSeq, Number(item.id) || state.taskSeq);
          state.tasks.unshift(task);
        });
    }

    async function loadSavedTasks(options = {}) {
      const force = Boolean(options.force);
      if (state.historyLoading) return;
      if (force) {
        setStatus('正在找回之前的作品...', '');
        removeLoadedHistoryTasks();
        state.historyPage = 0;
        state.historyTotalPages = 1;
      }

      const targetPage = Math.max(1, Number(options.page) || 1);
      state.historyLoading = true;
      taskHistoryLoaded = false;
      try {
        const loadHistoryPage = async (page) => {
          const params = new URLSearchParams({
            type: 'image',
            limit: String(state.historyPageSize),
            page: String(page)
          });
          const res = await fetch('/api/user/history?' + params.toString(), {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            if (res.status === 401) {
              handleAuthExpired(data.error || '登录已过期，请重新登录。');
              return null;
            }
            throw new Error(data.error || '历史记录读取失败，请重新登录后再试。');
          }
          return data;
        };

        while (state.historyPage < targetPage && state.historyPage < state.historyTotalPages) {
          const data = await loadHistoryPage(state.historyPage + 1);
          if (!data) return;
          state.historyTotalPages = Math.max(1, Number(data.totalPages) || 1);
          appendSavedHistoryItems(data.history || []);
          state.historyPage = Math.max(state.historyPage + 1, Number(data.page) || state.historyPage + 1);
        }

        taskHistoryLoaded = true;
        orderTasksForDisplay();
        renderTaskPage();
        updateStats();
        if (force && state.tasks.filter((task) => task.saved).length === 0) {
          setStatus('这个账号还没有生成记录。先写个画面试试。', 'error');
        }
      } catch (err) {
        taskHistoryLoaded = false;
        renderTaskPage();
        setStatus('历史记录加载失败：' + (err.message || '网络异常'), 'error');
      } finally {
        state.historyLoading = false;
      }
    }

    async function ensureTaskPageLoaded(page) {
      const requiredTaskCount = page * state.taskPageSize;
      while (state.tasks.length < requiredTaskCount && state.historyPage < state.historyTotalPages) {
        await loadSavedTasks({ page: state.historyPage + 1 });
      }
    }

    async function loadServerJobs() {
      try {
        const res = await fetch('/api/xi-image/jobs', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) handleAuthExpired(data.error || '登录已过期，请重新登录。');
          return;
        }
        const data = await res.json();
        (data.jobs || []).forEach((job) => {
          if (state.tasks.some((task) => task.jobId === job.id)) return;
          const task = taskFromServerJob(job);
          state.tasks.unshift(task);
          if (task.status === 'running' || task.status === 'queued') {
            pollServerJob(task);
          }
        });
        if ((data.jobs || []).length > 0) {
          state.taskPage = 1;
          renderTaskPage();
          updateStats();
        setStatus(`已接回 ${data.jobs.length} 个正在生成的作品。`, 'ok');
        }
      } catch {}
    }

    function taskFromServerJob(job) {
      const index = Number(job.historyId) || ++state.taskSeq;
      const submittedAtMs = parseServerJobSubmittedAtMs(job);
      return {
        id: 'job-' + job.id,
        jobId: job.id,
        index,
        status: job.status,
        mode: job.mode || 'generate',
        prompt: job.prompt || '',
        size: job.size || DEFAULT_SIZE,
        count: job.count || 1,
        quality: job.quality || 'medium',
        requestedQuality: job.upstreamMeta?.requested_quality || job.quality || 'medium',
        actualQuality: job.upstreamMeta?.actual_quality || '',
        actualSize: job.upstreamMeta?.actual_size || '',
        billingOutputTokens: job.upstreamMeta?.billing_output_tokens || 0,
        sourceFiles: [],
        sourcePreviewUrls: job.sourcePreviewUrls || [],
        sourceFileNames: job.sourceFileNames || [],
        sourceDimensions: job.sourceDimensions || [],
        outputDimensions: job.outputDimensions || [],
        createdAt: job.createdAt || '',
        createdAtMs: submittedAtMs,
        submittedAtMs,
        startedAtMs: job.startedAtMs || 0,
        finishedAtMs: job.finishedAtMs || 0,
        durationMs: job.durationMs || 0,
        displayStartedAtMs: job.status === 'running' && job.durationMs ? Date.now() - job.durationMs : (job.startedAtMs || 0),
        imageUrls: job.imageUrls || [],
        error: job.error || '',
        historyId: job.historyId || '',
        provider: job.provider || '',
        fallbackReason: job.fallbackReason || '',
        saved: Boolean(job.historyId)
      };
    }

    function removeLoadedHistoryTasks() {
      state.tasks = state.tasks.filter((task) => {
        if (!task.saved) return true;
        return false;
      });
      state.taskPage = 1;
      renderTaskPage();
    }

    function parseSavedImageUrls(value) {
      if (!value) return [];
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
        if (typeof parsed === 'string') return [parsed].filter(Boolean);
      } catch {}
      return [value].filter(Boolean);
    }

    function parseJson(value) {
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }

    function parseHistoryTimestamp(value) {
      if (!value) return 0;
      const raw = String(value).trim();
      const normalized = raw.includes('T') || /Z$|[+-]\d{2}:\d{2}$/.test(raw)
        ? raw
        : raw.replace(' ', 'T') + 'Z';
      const ms = Date.parse(normalized);
      return Number.isFinite(ms) ? ms : 0;
    }

    function formatHistoryTime(value) {
      if (!value) return '';
      const raw = String(value).trim();
      const ms = parseHistoryTimestamp(raw);
      if (!ms) return raw.replace('T', ' ').slice(0, 16);
      const date = new Date(ms);
      if (Number.isNaN(date.getTime())) return raw.replace('T', ' ').slice(0, 16);
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(date).replace(/\//g, '-');
    }

    function formatBeijingTime(input = new Date()) {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(input);
    }

    function formatBeijingDateTime(input = new Date()) {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(input).replace(/\//g, '-');
    }

    function parseServerJobSubmittedAtMs(job) {
      const createdAtMs = Number(job?.createdAtMs || 0);
      if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;

      const createdAt = String(job?.createdAt || '').trim();
      const timeMatch = createdAt.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
      if (!timeMatch) return 0;

      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(new Date()).reduce((result, part) => {
        if (part.type !== 'literal') result[part.type] = part.value;
        return result;
      }, {});
      const beijingLocalMs = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(timeMatch[1]),
        Number(timeMatch[2]),
        Number(timeMatch[3] || 0)
      );
      return beijingLocalMs - (8 * 60 * 60 * 1000);
    }

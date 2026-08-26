    function setDetailSuiteStatus(text, type) {
      if (!detailSuiteStatusEl) return;
      detailSuiteStatusEl.textContent = text || '';
      detailSuiteStatusEl.className = 'xi-status' + (type ? ' ' + type : '');
    }

    function getDetailSuiteModules(count) {
      const modules = [
        { title: '主视觉图', purpose: 'white-background product hero image, show what the product is, clean premium commercial product photography, no text' },
        { title: '核心卖点图', purpose: 'feature infographic base image, visually emphasize the strongest benefit with clear text-safe empty space' },
        { title: '痛点解决图', purpose: 'problem-solution scene, show the shopper pain point being solved in a realistic situation' },
        { title: '使用场景图', purpose: 'lifestyle use scene, show the product naturally used by the target customer, product clearly visible' },
        { title: '对比优势图', purpose: 'advantage comparison layout without competitor logos, leave balanced clean areas for local text overlay' },
        { title: '尺寸参数图', purpose: 'specification and scale base image, clean technical composition, leave whitespace for local labels' },
        { title: '包装清单图', purpose: 'package contents and accessories image, only show items actually included, organized premium layout' },
        { title: '品牌收尾图', purpose: 'brand closing hero image, premium trust-building atmosphere, consistent color palette and lighting' }
      ];
      return modules.slice(0, clamp(Number(count || 8), 6, 8));
    }

    function getDetailSuiteForm() {
      if (!detailProductNameEl) return null;
      const sellingPoints = String(detailSellingPointsEl.value || '')
        .split(/\n|；|;|、/)
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 12);
      return {
        productName: detailProductNameEl.value.trim(),
        platform: detailPlatformEl.value || 'Amazon',
        sellingPoints,
        specs: detailSpecsEl.value.trim(),
        style: detailStyleEl.value || 'Minimal Premium',
        tone: detailToneEl.value.trim() || 'clean, trustworthy, premium, conversion-focused',
        brandColor: detailBrandColorEl.value || '#111827',
        fontMood: detailFontEl.value || 'modern sans-serif',
        count: clamp(Number(detailCountEl.value || 8), 6, 8),
        size: SUPPORTED_IMAGE_SIZES.includes(detailSizeEl.value) ? detailSizeEl.value : DEFAULT_SIZE
      };
    }

    function renderDetailSuitePreview() {
      const form = getDetailSuiteForm();
      if (!form || !detailSuitePreviewEl) return;
      const modules = getDetailSuiteModules(form.count);
      detailSuitePreviewEl.innerHTML = '';
      modules.forEach((module, index) => {
        const row = document.createElement('div');
        row.className = 'detail-suite-row';
        row.innerHTML = `<span class="detail-suite-chip">${String(index + 1).padStart(2, '0')}</span><span>${escapeHtml(module.title)}</span>`;
        detailSuitePreviewEl.appendChild(row);
      });
    }

    function buildDetailSuitePrompt(form, module, index, total, setId) {
      const point = form.sellingPoints[index - 1] || form.sellingPoints[(index - 1) % Math.max(form.sellingPoints.length, 1)] || 'premium product value and clear shopper benefit';
      const allPoints = form.sellingPoints.length > 0 ? form.sellingPoints.join(', ') : 'premium quality, clear function, trustworthy product details';
      const specs = form.specs || 'Follow the reference image exactly for size, material, color, component count, button position, connector position, package/accessory quantity, and original product shape.';
      const platformNote = form.platform === 'Amazon'
        ? 'Amazon listing image logic: mobile-readable composition, compliant product presentation, no price, no coupon, no Amazon badge, no unsupported claim.'
        : `${form.platform} ecommerce detail image logic: strong product recognition, clean conversion-oriented composition, premium visual hierarchy.`;
      return [
        `Create image ${index}/${total} for one consistent ecommerce detail image set.`,
        `Set ID: ${setId}. Product: ${form.productName}. Module: ${module.title}.`,
        `Module purpose: ${module.purpose}.`,
        `Main selling point for this image: ${point}. Full selling points: ${allPoints}.`,
        platformNote,
        `Visual style direction: ${form.style}. Brand tone: ${form.tone}. Brand color palette anchored by ${form.brandColor}, with restrained complementary colors.`,
        `Typography mood to reserve for later local overlay: ${form.fontMood}. Do not render readable text inside the image. Reserve clean text-safe whitespace where appropriate.`,
        `Product structure lock: ${specs}`,
        'Product ratio protection: keep the original product proportions, silhouette, color, material, logo position, surface texture, packaging details, and real-world scale unchanged from the reference image.',
        'Do not alter: button placement, interface layout, connector position, handle structure, accessory quantity, original product shape, product color, material texture, or logo position.',
        'Consistency requirements across the whole set: same lighting direction, same rendering quality, same color palette, same shadow softness, same visual tone, same product proportions, same premium commercial photography style.',
        'Composition: product must be fully visible, not awkwardly cropped, not stretched, not warped, with enough safe margins for ecommerce use.',
        'Negative prompt: distorted product, stretched structure, incorrect proportions, extra components, extra accessories, wrong package contents, unrealistic reflections, warped geometry, messy composition, low quality texture, inconsistent lighting, incorrect shadows, duplicated accessories, blurry rendering, fake material appearance, random text, misspelled text, logo hallucination, watermark.'
      ].join('\n');
    }

    function enqueueDetailSuite() {
      const form = getDetailSuiteForm();
      if (!form) return;
      if (!form.productName) {
        setDetailSuiteStatus('先填产品名称。', 'error');
        detailProductNameEl.focus();
        return;
      }
      if (form.sellingPoints.length === 0) {
        setDetailSuiteStatus('至少填一个核心卖点，一行一个最好用。', 'error');
        detailSellingPointsEl.focus();
        return;
      }

      const selectedSources = getSelectedSourceImages();
      if (selectedSources.length === 0) {
        setDetailSuiteStatus('请先在上方参考图放产品图，这样才能尽量保持产品比例和结构。', 'error');
        sourceGrid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const modules = getDetailSuiteModules(form.count);
      const parallelism = getParallelism();
      const setId = 'detail-' + (++state.detailSetSeq) + '-' + Date.now();
      if (parallelismEl) parallelismEl.value = parallelism;

      modules.forEach((module, index) => {
        const createdAtMs = Date.now() + index;
        const taskSourcePreviewUrls = createTaskSourcePreviewUrls(selectedSources);
        const task = {
          id: ImageStudio.createTaskId(),
          index: state.taskSeq,
          status: 'queued',
          mode: 'edit',
          prompt: buildDetailSuitePrompt(form, module, index + 1, modules.length, setId),
          size: form.size,
          count: 1,
          quality: state.quality,
          sourceFiles: selectedSources.map((source) => source.file),
          sourcePreviewUrls: taskSourcePreviewUrls,
          localSourcePreviewUrls: taskSourcePreviewUrls,
          sourceFileNames: selectedSources.map((source) => getSourceImageName(source.slotIndex ?? 0)),
          detailSuite: {
            setId,
            productName: form.productName,
            moduleTitle: module.title,
            moduleIndex: index + 1,
            total: modules.length,
            platform: form.platform,
            style: form.style,
            brandColor: form.brandColor,
            fontMood: form.fontMood
          },
          createdAt: formatBeijingTime(),
          createdAtMs,
          submittedAtMs: createdAtMs,
          startedAtMs: 0,
          finishedAtMs: 0,
          imageUrls: [],
          error: ''
        };
        state.tasks.unshift(task);
        state.queue.push(task);
      });

      state.taskPage = 1;
      renderTaskPage();
      updateStats();
      setDetailSuiteStatus(`已加入 ${modules.length} 张详情图，同一套风格开始跑。`, 'ok');
      setStatus(`电商详情套图已加入队列：${modules.length} 张。`, 'ok');
      processQueue();
    }

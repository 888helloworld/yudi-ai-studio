    const ImageStudio = window.ImageStudio = window.ImageStudio || {};
    const token = localStorage.getItem('token');
    const protectedImageUrlCache = new Map();
    const protectedImagePromiseCache = new Map();

    function getThumbnailImageUrl(url) {
      if (!isProtectedUploadUrl(url)) return url;
      const parsed = new URL(String(url || ''), window.location.origin);
      parsed.searchParams.set('variant', 'thumb');
      return parsed.href;
    }
    function buildAssetFetchOptions(url) {
      const headers = isProtectedUploadUrl(url) && token ? { 'Authorization': 'Bearer ' + token } : {};
      return { headers, credentials: 'same-origin', cache: 'default' };
    }

    async function fetchAssetBlob(url) {
      const response = await fetch(resolveAssetUrl(url), buildAssetFetchOptions(url));
      if (!response.ok) throw new Error('图片读取失败');
      return response.blob();
    }

    async function getDisplayImageUrl(url) {
      if (!isProtectedUploadUrl(url)) return url;
      const cacheKey = resolveAssetUrl(url);
      if (protectedImageUrlCache.has(cacheKey)) {
        return protectedImageUrlCache.get(cacheKey);
      }
      if (protectedImagePromiseCache.has(cacheKey)) {
        return protectedImagePromiseCache.get(cacheKey);
      }
      const pending = fetchAssetBlob(url)
        .then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          protectedImageUrlCache.set(cacheKey, objectUrl);
          return objectUrl;
        })
        .finally(() => {
          protectedImagePromiseCache.delete(cacheKey);
        });
      protectedImagePromiseCache.set(cacheKey, pending);
      return pending;
    }

    const protectedImageObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            protectedImageObserver.unobserve(entry.target);
            loadProtectedImage(entry.target);
          });
        }, { rootMargin: '200px 0px' })
      : null;

    function loadProtectedImage(img) {
      const url = img?.dataset.lazyUrl || '';
      const sourceKey = img?.dataset.sourceUrl || '';
      if (!img || !url || !sourceKey || img.dataset.sourceUrl !== sourceKey) return;

      const markFailed = () => {
        if (img.dataset.sourceUrl !== sourceKey) return;
        img.classList.remove('protected-image-loading', 'protected-image-ready');
        img.classList.add('protected-image-failed');
        img.removeAttribute('aria-busy');
        img.alt = '';
        img.removeAttribute('src');
      };

      const markReady = () => {
        if (img.dataset.sourceUrl !== sourceKey) return;
        img.classList.remove('protected-image-loading', 'protected-image-failed');
        img.classList.add('protected-image-ready');
        img.removeAttribute('aria-busy');
        img.alt = img.dataset.loadedAlt || '';
      };

      getDisplayImageUrl(url)
        .then((displayUrl) => {
          if (img.dataset.sourceUrl !== sourceKey) return;
          img.onload = markReady;
          img.onerror = markFailed;
          if (img.src === displayUrl && img.complete && img.naturalWidth > 0) {
            markReady();
          } else {
            img.src = displayUrl;
          }
        })
        .catch(() => {
          markFailed();
          img.dispatchEvent(new Event('error'));
        });
    }

    function setProtectedImageSource(img, url, altText = '') {
      if (!img || !url) return;
      const sourceKey = resolveAssetUrl(url);
      img.dataset.sourceUrl = sourceKey;
      img.dataset.lazyUrl = url;
      img.dataset.loadedAlt = altText || img.alt || '';
      img.alt = '';
      img.classList.remove('protected-image-ready', 'protected-image-failed');
      img.classList.add('protected-image-loading');
      img.setAttribute('aria-busy', 'true');
      img.loading = 'lazy';

      if (!isProtectedUploadUrl(url)) {
        img.onload = () => {
          img.classList.remove('protected-image-loading', 'protected-image-failed');
          img.classList.add('protected-image-ready');
          img.removeAttribute('aria-busy');
          img.alt = img.dataset.loadedAlt || '';
        };
        img.onerror = () => {
          img.classList.remove('protected-image-loading', 'protected-image-ready');
          img.classList.add('protected-image-failed');
          img.removeAttribute('aria-busy');
          img.alt = '';
        };
        img.src = url;
        return;
      }

      if (protectedImageObserver && img.isConnected) {
        protectedImageObserver.observe(img);
      } else if (protectedImageObserver) {
        requestAnimationFrame(() => {
          if (img.isConnected) protectedImageObserver.observe(img);
          else loadProtectedImage(img);
        });
      } else {
        loadProtectedImage(img);
      }
    }
    const promptEl = document.getElementById('prompt');
    const sourceGrid = document.getElementById('sourceGrid');
    const sourceSlots = Array.from(document.querySelectorAll('[data-source-slot]'));
    const countEl = document.getElementById('count');
    const batchCountEl = document.getElementById('batchCount');
    const parallelismEl = document.getElementById('parallelism');
    const estimateTotalEl = document.getElementById('estimateTotal');
    const statusEl = document.getElementById('status');
    const emptyEl = document.getElementById('empty');
    const taskListEl = document.getElementById('taskList');
    const taskPagerEl = document.getElementById('taskPager');
    const taskPageSizeEl = document.getElementById('taskPageSize');
    const taskPrevPageBtn = document.getElementById('taskPrevPage');
    const taskNextPageBtn = document.getElementById('taskNextPage');
    const taskPageInfoEl = document.getElementById('taskPageInfo');
    const generateBtn = document.getElementById('generateBtn');
    const clearPromptBtn = document.getElementById('clearPromptBtn');
    const clearSourcesBtn = document.getElementById('clearSourcesBtn');
    const reloadHistoryBtn = document.getElementById('reloadHistoryBtn');
    const clearQueuedBtn = document.getElementById('clearQueuedBtn');
    const previewOverlay = document.getElementById('imagePreview');
    const previewImage = document.getElementById('previewImage');
    const previewLoading = document.getElementById('previewLoading');
    const previewTitle = document.getElementById('previewTitle');
    const previewDownload = document.getElementById('previewDownload');
    const previewOpen = document.getElementById('previewOpen');
    const previewClose = document.getElementById('previewClose');
    const previewEditBtn = document.getElementById('previewEditBtn');
    const detailProductNameEl = document.getElementById('detailProductName');
    const detailPlatformEl = document.getElementById('detailPlatform');
    const detailSellingPointsEl = document.getElementById('detailSellingPoints');
    const detailSpecsEl = document.getElementById('detailSpecs');
    const detailStyleEl = document.getElementById('detailStyle');
    const detailToneEl = document.getElementById('detailTone');
    const detailBrandColorEl = document.getElementById('detailBrandColor');
    const detailFontEl = document.getElementById('detailFont');
    const detailCountEl = document.getElementById('detailCount');
    const detailSizeEl = document.getElementById('detailSize');
    const detailSuiteBtn = document.getElementById('detailSuiteBtn');
    const detailSuiteStatusEl = document.getElementById('detailSuiteStatus');
    const detailSuitePreviewEl = document.getElementById('detailSuitePreview');
    const MAX_BATCH_COUNT = 5;
    const MAX_PARALLELISM = Number.MAX_SAFE_INTEGER;
    const SUPPORTED_IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024', '2048x1152', '1152x2048'];
    const DISPLAY_IMAGE_SIZES = {
      '1024x1024': '1254x1254',
      '1024x1536': '1024x1536',
      '1536x1024': '1536x1024',
      '2048x1152': '1672x941',
      '1152x2048': '941x1672'
    };
    const DEFAULT_SIZE = '1024x1536';
    const DEFAULT_QUALITY = 'medium';
    const DEFAULT_BATCH_COUNT = 1;
    const DEFAULT_PARALLELISM = 10;
    const MAX_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024;
    const MAX_SOURCE_INPUT_BYTES = 50 * 1024 * 1024;
    const TARGET_PREPARED_SOURCE_BYTES = 19 * 1024 * 1024;
    const PROMPT_PLACEHOLDERS = [
      '例如：雨后的窗边，一束柔光落在旧木桌上，咖啡还有热气，画面安静、真实、带一点温柔的颗粒感。',
      '例如：白底产品主图，一双米白色分趾袜平整摆放，纹理清楚，光线干净，像专业电商摄影棚拍出来的。',
      '例如：清晨厨房里的玻璃杯，柠檬水泛着小气泡，阳光斜斜照进来，画面清爽得像刚洗过脸。',
      '例如：日系小红书封面，一个奶油色托盘放着香薰、书和小花，整体柔和、干净、有生活感。',
      '例如：亚马逊商品场景图，产品放在浅灰背景前，旁边有少量道具衬托功能，但主体一定要清楚完整。',
      '例如：一张高级感详情图，产品居中，背景简洁，有柔和阴影，给文字留出安全空白区域。',
      '例如：秋天公园长椅上的帆布包，旁边有落叶和咖啡杯，色调温暖，像真实生活随手拍但更精致。',
      '例如：黑色运动水杯的商业海报，冷色灯光，金属质感明显，背景有轻微水雾和速度感。',
      '例如：儿童绘本风插画，一个戴围巾的小朋友坐在月亮上钓星星，颜色温柔，画面有童话感。',
      '例如：极简白底静物摄影，一只陶瓷花瓶和一枝白色郁金香，构图留白多，质感安静高级。',
      '例如：复古胶片感街角咖啡店，暖黄色灯光从窗户透出来，行人有一点虚化，像电影里的夜晚。',
      '例如：产品局部特写，突出材质纹理、缝线、边缘和细节，真实锐利，不要塑料感，也不要过度磨皮。',
      '例如：一只透明雨伞靠在便利店门口，地面倒映霓虹灯，画面像凌晨两点刚买完关东煮。',
      '例如：奶油风卧室一角，床头柜上有台灯、眼镜和一本翻开的书，生活很慢，但画面要很会呼吸。',
      '例如：一张干净利落的新品发布海报，产品像刚从未来快递盒里拆出来，背景简洁，有一点科技感。',
      '例如：小红书氛围图，手捧热饮站在冬天街边，围巾柔软，背景虚化，整张图看起来暖乎乎的。',
      '例如：厨房台面上的早餐，吐司边缘微焦，黄油正在融化，阳光刚好落在盘子边上。',
      '例如：高端护肤品静物，半透明瓶身，水波纹背景，光线通透，像一口气喝完冰镇柠檬水。',
      '例如：运动鞋悬浮在纯色背景中，鞋底纹路清楚，旁边有轻微动感线条，像准备冲出去。',
      '例如：一张可爱的贴纸风插画，杯子、云朵、星星和小表情围在一起，颜色轻快但别太幼稚。',
      '例如：木质书桌上的手账拼贴，胶带、便签、钢笔和干花散开，画面整齐但有一点真实凌乱。',
      '例如：咖啡豆从空中落进杯子里，液体飞溅被定格，商业摄影，高速快门，香味好像要飘出来。',
      '例如：一张黑金风详情图，产品边缘有漂亮高光，背景低调，整体看起来贵，但不要土豪金。',
      '例如：夏日海边的草编包和墨镜，沙子细腻，海水在远处发亮，画面有度假感但别像旅游广告。',
      '例如：办公室桌面上的智能设备，线材整齐，屏幕微亮，背景有浅浅虚化，像认真工作但不加班。',
      '例如：一张食品包装主图，包装完整正面朝前，旁边有原料点缀，干净、可信、好吃但不夸张。',
      '例如：夜晚窗前的小台灯，窗外有城市灯光，桌上放着耳机和笔记本，气氛安静又有一点孤独。',
      '例如：一张赛博风饮料海报，冰块、气泡、霓虹反光都要有，但产品标签必须清楚不变形。',
      '例如：粉色甜品店橱窗，一块草莓蛋糕被摆在中间，奶油纹路清楚，画面甜但不要齁。',
      '例如：户外露营用品场景，折叠椅、营灯和热水壶在草地上，傍晚光线，舒服、松弛、能闻到风。'
    ];
    const REVERSE_TEMPLATE_HINTS = {
      general: '按主体、场景、构图、光线、色彩、材质、镜头、风格和负面词完整拆解。',
      amazon: '适合家居、清洁、服饰配件等产品主图，重点输出专业棚拍和亚马逊白底主图提示词。',
      outfit: '适合模特穿搭、电商场景图，重点拆解姿势、服装层次、材质纹理、日系氛围和白底主图要求。',
      'style-only': '只提取风格、构图、光线、色彩和商业摄影感觉，不复制人物、品牌、logo 或独特设计。',
      structured: '按主体、背景、构图、镜头、光线、颜色、材质、风格、细节和画质关键词结构化拆图。'
    };
    let reverseSelectedFile = null;
    let reversePreviewUrl = '';
    let activeReverseRequests = 0;
    let reverseHistoryPollId = null;
    let currentPreviewImage = null;
    let previewRequestSeq = 0;
    let pasteTargetMode = 'source';
    let taskHistoryLoaded = false;

    const state = {
      tasks: [],
      queue: [],
      running: 0,
      taskSeq: 0,
      selectedSize: DEFAULT_SIZE,
      quality: DEFAULT_QUALITY,
      reverseMode: 'general',
      sourceFiles: [null, null, null],
      sourcePreviewUrls: ['', '', ''],
      taskPage: 1,
      taskPageSize: 50,
      reverseHistory: [],
      reverseSeq: 0,
      reversePage: 1,
      reversePageSize: 10,
      detailSetSeq: 0,
      historyPage: 0,
      historyTotalPages: 1,
      historyPageSize: 50,
      historyLoading: false
    };
    ImageStudio.state = state;
    ImageStudio.assets = Object.freeze({
      buildAssetFetchOptions,
      fetchAssetBlob,
      getThumbnailImageUrl,
      isProtectedUploadUrl,
      setProtectedImageSource
    });

    function refreshPromptPlaceholder() {
      const index = Math.floor(Math.random() * PROMPT_PLACEHOLDERS.length);
      promptEl.placeholder = PROMPT_PLACEHOLDERS[index] || '写下你想要的画面，越具体越好。';
    }

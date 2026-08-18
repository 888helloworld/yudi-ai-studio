function getAuthHeader() {
  const token = localStorage.getItem('token');
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function fetchImageBlob(url) {
  const headers = isProtectedUploadUrl(url) ? getAuthHeader() : {};
  const res = await fetch(new URL(url, window.location.origin).href, {
    headers,
    credentials: 'same-origin',
    cache: 'default'
  });
  if (!res.ok) throw new Error('图片读取失败');
  return res.blob();
}

function setProtectedImageSource(img, url, altText = '') {
  if (!img || !url) return;
  const sourceKey = new URL(url, window.location.origin).href;
  img.dataset.sourceUrl = sourceKey;
  img.dataset.loadedAlt = altText || img.alt || '';
  img.alt = '';
  img.classList.remove('protected-image-ready', 'protected-image-failed');
  img.classList.add('protected-image-loading');
  img.setAttribute('aria-busy', 'true');

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
  const loadUrl = isProtectedUploadUrl(url)
    ? fetchImageBlob(url).then((blob) => URL.createObjectURL(blob))
    : Promise.resolve(sourceKey);

  loadUrl
    .then((displayUrl) => {
      if (img.dataset.sourceUrl !== sourceKey) return;
      img.onload = () => {
        markReady();
        if (displayUrl.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(displayUrl), 1000);
      };
      img.onerror = markFailed;
      img.src = displayUrl;
    })
    .catch(markFailed);
}

function protectedImageHtml(url, alt, className = '', style = '') {
  const classes = ['protected-image-loading', className].filter(Boolean).join(' ');
  return `<img data-protected-src="${escapeForAttr(url)}" data-loaded-alt="${escapeForAttr(alt)}" alt="" class="${escapeForAttr(classes)}"${style ? ` style="${escapeForAttr(style)}"` : ''}>`;
}

function hydrateProtectedImages(root = document) {
  root.querySelectorAll('img[data-protected-src]').forEach((img) => {
    setProtectedImageSource(img, img.dataset.protectedSrc, img.dataset.loadedAlt || '');
  });
}

function getImageCountInput(id) {
  const value = parseInt(document.getElementById(id)?.value, 10);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 1), 4);
}

const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const TARGET_REFERENCE_UPLOAD_BYTES = 4.5 * 1024 * 1024;

async function prepareReferenceImageForUpload(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) {
    throw new Error('只能上传图片文件');
  }
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error('参考图不能超过 20MB');
  }

  const canSendOriginal = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    && file.size <= TARGET_REFERENCE_UPLOAD_BYTES;
  if (canSendOriginal) return file;

  const dataUrl = await readImageFileAsDataUrl(file);
  const image = await loadReferenceImage(dataUrl);
  const maxSides = [2048, 1600, 1280, 1024, 768];
  const qualities = [0.9, 0.82, 0.74];
  let lastBlob = null;

  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      lastBlob = blob;
      if (blob.size <= TARGET_REFERENCE_UPLOAD_BYTES) {
        return new File([blob], normalizeReferenceUploadName(file.name), { type: 'image/jpeg' });
      }
    }
  }

  if (lastBlob && lastBlob.size <= 5 * 1024 * 1024) {
    return new File([lastBlob], normalizeReferenceUploadName(file.name), { type: 'image/jpeg' });
  }
  throw new Error('参考图处理后仍然太大，请换一张更小的图片');
}

function readImageFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function loadReferenceImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片无法解码，请换一张 PNG/JPG/WebP 图片'));
    image.src = src;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('参考图压缩失败'));
    }, type, quality);
  });
}

function normalizeReferenceUploadName(name) {
  const base = String(name || 'reference').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'reference';
  return `${base}.jpg`;
}

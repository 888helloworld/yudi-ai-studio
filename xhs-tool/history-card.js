function createHistoryCard(item) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.id = getHistoryId(item);

  if (item.type === 'reverse' || item.sub_type === 'xhs-reverse') {
    const meta = getReverseMeta(item);
    const previewUrl = meta.preview_url || item.previewUrl || '';
    const summary = getReversePromptSummary(item);
    const thumb = previewUrl
      ? document.createElement('img')
      : document.createElement('div');

    if (previewUrl) {
      setProtectedImageSource(thumb, previewUrl);
      thumb.alt = '反推参考图';
    } else {
      thumb.className = 'copy-thumb';
      thumb.textContent = 'P';
    }

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type';
    typeSpan.textContent = '看图写 Prompt';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const title = document.createElement('p');
      title.className = 'history-title-text';
      title.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      title.title = item.prompt;
      infoDiv.appendChild(title);
    }

    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = getCopySummary(summary);
      summaryP.title = summary;
      infoDiv.appendChild(summaryP);
    }

    card.appendChild(thumb);
    card.appendChild(infoDiv);
  } else if (item.type === 'image' && getHistoryImageUrl(item)) {
    const img = document.createElement('img');
    setProtectedImageSource(img, getHistoryImageUrl(item));
    img.alt = '历史图片';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type';
    typeSpan.textContent = item.ratio || '1:1';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-info-text';
      p.textContent = item.prompt.substring(0, 20) + '...';
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }

    card.appendChild(img);
    card.appendChild(infoDiv);

  } else if (item.type === 'copy' && getHistoryCopyContent(item)) {
    const isRewrite = isRewriteHistory(item);
    const typeLabel = getHistorySourceLabel(item);
    const content = getHistoryCopyContent(item);

    const thumbDiv = document.createElement('div');
    thumbDiv.className = 'copy-thumb' + (isRewrite ? ' rewrite' : '');
    thumbDiv.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>`;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type copy-type' + (isRewrite ? ' rewrite-type' : '');
    typeSpan.textContent = typeLabel;

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }

    const summary = getCopySummary(content);
    if (summary) {
      const summaryP = document.createElement('p');
      summaryP.className = 'history-copy-summary';
      summaryP.textContent = summary;
      summaryP.title = content;
      infoDiv.appendChild(summaryP);
    }

    card.appendChild(thumbDiv);
    card.appendChild(infoDiv);

  } else if (item.type === 'both') {
    // 图文一体卡片：小图 + 文案摘要
    const imageUrls = getHistoryImageUrls(item);
    const imgUrl = imageUrls[0] || '';
    const content = getHistoryCopyContent(item);

    const img = document.createElement('img');
    if (imgUrl) setProtectedImageSource(img, imgUrl);
    img.alt = '图文一体';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'history-info';

    const typeSpan = document.createElement('span');
    typeSpan.className = 'history-type both-type';
    typeSpan.textContent = imageUrls.length > 1 ? `图文一体生成 · ${imageUrls.length}图` : '图文一体生成';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'history-date';
    dateSpan.textContent = getHistoryCreatedAt(item);

    infoDiv.appendChild(typeSpan);
    infoDiv.appendChild(dateSpan);

    if (item.prompt) {
      const p = document.createElement('p');
      p.className = 'history-title-text';
      p.textContent = item.prompt.length > 18 ? item.prompt.substring(0, 18) + '...' : item.prompt;
      p.title = item.prompt;
      infoDiv.appendChild(p);
    }

    card.appendChild(img);
    card.appendChild(infoDiv);
  }

  return card;
}

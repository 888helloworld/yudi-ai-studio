(() => {
  const files = [
    'state.js',
    'auth-history.js',
    'detail-suite.js',
    'task-queue.js',
    'task-rendering.js',
    'image-actions.js',
    'source-images.js',
    'prompt-polish.js',
    'reverse-prompt.js',
    'utilities.js',
    'bootstrap.js'
  ];

  function loadScript(filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `image-studio/${filename}?v=20260825-2`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`画面工坊脚本加载失败：${filename}`));
      document.body.appendChild(script);
    });
  }

  files.reduce(
    (chain, filename) => chain.then(() => loadScript(filename)),
    Promise.resolve()
  ).catch((error) => {
    console.error(error);
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div class="alert alert-error">画面工坊加载失败，请刷新页面重试。</div>'
    );
  });
})();

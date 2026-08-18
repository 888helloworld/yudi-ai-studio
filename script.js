(() => {
  const files = [
    'state.js',
    'image-utils.js',
    'workspace.js',
    'generation.js',
    'task-ui.js',
    'history.js',
    'modals.js',
    'bootstrap.js'
  ];

  function loadScript(filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `xhs-tool/${filename}?v=20260818`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`工作台脚本加载失败：${filename}`));
      document.body.appendChild(script);
    });
  }

  files.reduce(
    (chain, filename) => chain.then(() => loadScript(filename)),
    Promise.resolve()
  ).catch((error) => {
    console.error(error);
    const toolSection = document.getElementById('toolSection');
    if (toolSection) {
      toolSection.insertAdjacentHTML(
        'afterbegin',
        '<div class="alert alert-error">工作台加载失败，请刷新页面重试。</div>'
      );
    }
  });
})();

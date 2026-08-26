(() => {
  const files = ['state-users.js', 'history.js', 'billing.js', 'audit.js', 'bootstrap.js'];

  function loadScript(filename) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `admin/${filename}?v=20260826`;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`管理后台脚本加载失败：${filename}`));
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
      '<div class="alert alert-error">管理后台加载失败，请刷新页面重试。</div>'
    );
  });
})();

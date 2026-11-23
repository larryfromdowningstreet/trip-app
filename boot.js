// Runs before the app, in the oldest JavaScript every phone understands. If the app has not appeared
// after a few seconds, this shows why (instead of a blank white page) and offers a clean reload.
// A clean reload removes downloaded app files only; trips stay on the phone.
(function () {
  var problems = [];

  window.addEventListener('error', function (e) {
    var file = e.target && (e.target.src || e.target.href); // a file that did not load
    if (file) return problems.push('載入失敗：' + String(file).split('/').pop());
    var where = e.filename ? ' (' + e.filename.split('/').pop() + ':' + e.lineno + ')' : '';
    problems.push(String(e.message || e.type) + where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    problems.push('Promise: ' + (r && (r.name + ': ' + r.message) || String(r)));
  });

  function cleanReload() {
    var jobs = [];
    if (navigator.serviceWorker) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (list) {
        return Promise.all(list.map(function (r) { return r.unregister(); }));
      }));
    }
    if (window.caches) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }));
    }
    Promise.all(jobs).then(function () { location.reload(); }, function () { location.reload(); });
  }

  setTimeout(function () {
    var app = document.getElementById('app');
    if (!app || app.children.length) return;
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99;overflow:auto;padding:48px 24px;' +
      'font:15px/1.6 -apple-system,sans-serif;color:#35281F;background:#F5EDE2';
    var title = document.createElement('h1');
    title.textContent = '漫旅手帳沒有成功開啟';
    title.style.cssText = 'font-size:22px;margin:0 0 12px';
    var text = document.createElement('p');
    text.textContent = '請截圖這個畫面給開發者，然後按下面的按鈕重新載入（保持連網）。';
    var detail = document.createElement('pre');
    detail.textContent = (problems.length ? problems.join('\n') : '沒有錯誤訊息') + '\n\n' + navigator.userAgent;
    detail.style.cssText = 'white-space:pre-wrap;word-break:break-all;font-size:12px;background:#FFF8EF;padding:12px;border-radius:10px';
    var button = document.createElement('button');
    button.textContent = '清除下載的檔案並重新載入';
    button.style.cssText = 'margin-top:16px;width:100%;min-height:52px;border:0;border-radius:14px;background:#74513A;color:#FFF8EF;font-size:16px;font-weight:700';
    button.onclick = cleanReload;
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(detail);
    box.appendChild(button);
    document.body.appendChild(box);
  }, 6000);
})();

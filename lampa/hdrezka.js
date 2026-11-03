// HDRezka stable loader.
(function () {
  'use strict';

  if (typeof window === 'undefined' || window.hdrezka_loader_started) return;
  window.hdrezka_loader_started = true;

  function loaderUrl() {
    var current = document.currentScript;
    var scripts;
    var index;

    if (current && current.src) return current.src;

    scripts = document.getElementsByTagName('script');
    for (index = scripts.length - 1; index >= 0; index--) {
      if (scripts[index].src && scripts[index].src.indexOf('hdrezka.js') !== -1) return scripts[index].src;
    }

    return window.location.href;
  }

  function loadCore() {
    var source = loaderUrl();
    var slash = source.lastIndexOf('/');
    var base = slash === -1 ? '' : source.substring(0, slash + 1);
    var script = document.createElement('script');

    script.type = 'text/javascript';
    script.src = base + 'hdrezka-core.js?v=' + new Date().getTime();
    script.onerror = function () {
      if (window.console && console.error) console.error('[HDRezka] core load failed');
    };

    (document.head || document.getElementsByTagName('head')[0] || document.documentElement).appendChild(script);
  }

  loadCore();
})();

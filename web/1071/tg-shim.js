// Минимальный заглушечный shim Telegram.WebApp для нативного iOS-WKWebView.
// Реальный telegram-web-app.js не доступен вне Telegram-клиента, поэтому
// объекту WebApp присваиваем no-op методы и пустой initData. Гейт !tg.initData
// в app.js всё равно сработает — и это нормально для первой проверки UI.
(function () {
  if (window.Telegram && window.Telegram.WebApp) return;
  var ua = navigator.userAgent || "";
  var isMacDesktopNative = /MaccodNative-macOS/i.test(ua) ||
    (/MaccodNative/i.test(ua) && /\bMacintosh\b/i.test(ua) && !/Mobile/i.test(ua));
  window.MACCODE_DESKTOP_NATIVE = isMacDesktopNative;
  // С 1.66 в обёртке выставлен Keyboard.resize:"none" — WebView не схлопывается
  // нативно, и нам нужно поднимать #app через JS translate3d (плавно в такт
  // с iOS-анимацией клавы). Старые сборки (1.63-1.65) используют resize:"native"
  // и НЕ должны получать translate3d (двойная компенсация → улёт композера).
  var vMatch = /MaccodNative-V(\d+)/i.exec(ua);
  var bundleVer = vMatch ? parseInt(vMatch[1], 10) : 0;
  window.MACCODE_RESIZE_NONE = bundleVer >= 166;

  // Десктоп-обёртка передаёт подписанный initData в URL fragment как
  // tgWebAppData=<urlencoded> (main.swift:104). Реального telegram-web-app.js
  // нет, поэтому достаём сами и кладём в WebApp.initData — тогда серверный
  // verify_init_data примет подпись без нативного PIN-фолбэка.
  var initFromHash = "";
  try {
    var hash = (window.location.hash || "").replace(/^#/, "");
    if (hash) {
      var parts = hash.split("&");
      for (var i = 0; i < parts.length; i++) {
        var eq = parts[i].indexOf("=");
        if (eq < 0) continue;
        var k = parts[i].substring(0, eq);
        var v = parts[i].substring(eq + 1);
        if (k === "tgWebAppData") { initFromHash = decodeURIComponent(v); break; }
      }
    }
  } catch (_) {}
  var noop = function () {};
  function capHaptics() {
    var c = window.Capacitor;
    if (!c || !c.Plugins || !c.Plugins.Haptics) return null;
    return c.Plugins.Haptics;
  }
  // Нативный мост MaccodBridge (maccodHaptic) умеет настоящий
  // UIImpactFeedbackGenerator(.soft/.rigid) — мягче, чем потолок Capacitor
  // (LIGHT). Есть только на новых IPA; если хендлера нет — null, падаем на
  // Capacitor-фолбэк ниже.
  function nativeHaptic(style) {
    try {
      var mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.maccodHaptic;
      if (!mh) return false;
      mh.postMessage(String(style));
      return true;
    } catch (_) { return false; }
  }
  function impact(style) {
    var s = String(style || "light").toLowerCase();
    // Нативный путь: отдаём стиль как есть — soft реально мягкий.
    if (nativeHaptic(s)) return;
    var h = capHaptics();
    if (!h) return;
    // Фолбэк (старый IPA): Capacitor Haptics не знает SOFT/RIGID —
    // light/soft/medium → LIGHT impact; heavy/rigid → MEDIUM.
    try {
      if (s === "heavy" || s === "rigid") {
        h.impact({ style: "MEDIUM" });
      } else {
        h.impact({ style: "LIGHT" });
      }
    } catch (_) {}
  }
  function notify(type) {
    var t = String(type || "success").toLowerCase();
    if (t !== "success" && t !== "warning" && t !== "error") t = "success";
    if (nativeHaptic(t)) return;
    var h = capHaptics();
    if (!h) return;
    try { h.notification({ type: t.toUpperCase() }); } catch (_) {}
  }
  function select() {
    if (nativeHaptic("selection")) return;
    var h = capHaptics();
    if (!h) return;
    try { h.selectionStart(); h.selectionChanged(); h.selectionEnd(); } catch (_) {}
  }
  var WebApp = {
    initData: initFromHash,
    initDataUnsafe: {},
    platform: isMacDesktopNative ? "macos-native" : "ios-native",
    version: "0.0",
    colorScheme: "dark",
    themeParams: {},
    isExpanded: true,
    viewportHeight: window.innerHeight,
    viewportStableHeight: window.innerHeight,
    isFullscreen: false,
    safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
    ready: noop,
    expand: noop,
    close: noop,
    setHeaderColor: noop,
    setBackgroundColor: noop,
    setBottomBarColor: noop,
    disableVerticalSwipes: noop,
    enableVerticalSwipes: noop,
    requestFullscreen: noop,
    exitFullscreen: noop,
    isVersionAtLeast: function () { return false; },
    onEvent: noop,
    offEvent: noop,
    sendData: noop,
    showPopup: noop,
    showAlert: function (msg) { try { alert(msg); } catch (_) {} },
    HapticFeedback: { impactOccurred: impact, notificationOccurred: notify, selectionChanged: select },
    MainButton: { setText: noop, show: noop, hide: noop, onClick: noop, offClick: noop },
    BackButton:  { show: noop, hide: noop, onClick: noop, offClick: noop }
  };
  window.Telegram = { WebApp: WebApp };
  window.MACCODE_NATIVE = true;
  function applyClass() {
    // На macOS-обёртке не ставим maccode-native — этот класс активирует
    // iOS-специфичные CSS-правила (верхний блюр в styles.css ~74, safe-top
    // паддинги, transform-сдвиги под клавиатуру). Десктопу всё это не нужно;
    // даём отдельный класс maccode-desktop для возможных будущих правил.
    try {
      if (!document.body) return;
      document.body.classList.add(isMacDesktopNative ? "maccode-desktop" : "maccode-native");
      if (window.MACCODE_RESIZE_NONE) document.body.classList.add("maccode-rn");
    } catch (_) {}
  }
  if (document.body) applyClass();
  else document.addEventListener("DOMContentLoaded", applyClass, { once: true });

  function killAccessoryBar() {
    try {
      var c = window.Capacitor;
      var kb = c && c.Plugins && c.Plugins.Keyboard;
      if (kb && typeof kb.setAccessoryBarVisible === "function") {
        kb.setAccessoryBarVisible({ isVisible: false });
      }
    } catch (_) {}
  }
  killAccessoryBar();
  document.addEventListener("DOMContentLoaded", killAccessoryBar, { once: true });

  // Подписка на нативные события клавиатуры. keyboardWillShow стреляет
  // в момент старта анимации iOS-клавиатуры и сразу даёт keyboardHeight —
  // это единственный способ синхронизировать наш layout с системной анимацией.
  // visualViewport.resize в WKWebView приходит уже после завершения анимации.
  function bindKeyboardEvents() {
    try {
      var c = window.Capacitor;
      var kb = c && c.Plugins && c.Plugins.Keyboard;
      if (!kb || typeof kb.addListener !== "function") return;
      var root = document.documentElement;
      kb.addListener("keyboardWillShow", function (info) {
        var h = (info && info.keyboardHeight) || 0;
        root.style.setProperty("--kb-h", h + "px");
        try { document.body.classList.add("kb-active"); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent("maccode:kbshow", { detail: { height: h } })); } catch (_) {}
      });
      kb.addListener("keyboardWillHide", function () {
        root.style.setProperty("--kb-h", "0px");
        try { document.body.classList.remove("kb-active"); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent("maccode:kbhide")); } catch (_) {}
      });
    } catch (_) {}
  }
  bindKeyboardEvents();
  document.addEventListener("DOMContentLoaded", bindKeyboardEvents, { once: true });

  // Гасим нативный SplashScreen, как только app.js поставит body.app-ready.
  // Плагин держит native splash (launchAutoHide:false), чтобы не было моргания
  // между LaunchScreen.storyboard и WebView; снимаем сами, когда чат отрисован.
  function hideSplashOnce() {
    try {
      var c = window.Capacitor;
      var p = c && c.Plugins && c.Plugins.SplashScreen;
      if (p && typeof p.hide === "function") p.hide({ fadeOutDuration: 220 });
    } catch (_) {}
  }
  function watchAppReady() {
    if (!document.body) return;
    if (document.body.classList.contains("app-ready")) { hideSplashOnce(); return; }
    var fired = false;
    var fire = function () { if (fired) return; fired = true; hideSplashOnce(); try { obs.disconnect(); } catch (_) {} };
    var obs = new MutationObserver(function () {
      if (document.body.classList.contains("app-ready")) fire();
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    setTimeout(fire, 8000);
  }
  if (document.body) watchAppReady();
  else document.addEventListener("DOMContentLoaded", watchAppReady, { once: true });
})();

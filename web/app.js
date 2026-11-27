/* 密码卡包 V0.1 — 应用逻辑层
 * 原生壳（iOS IPA）通过 window.webkit.messageHandlers.vaultBridge 提供加密存储与剪贴板；
 * 浏览器直接打开时自动降级到 localStorage，便于本地预览与调试。
 */
(function () {
  'use strict';

  /* ============================================================
   * 1. 原生桥
   * ========================================================== */

  /* Android：把 addJavascriptInterface 注入的对象包装成与 iOS 完全相同的桥形状，
     这样界面层只认一套协议（window.webkit.messageHandlers.vaultBridge）。 */
  (function installAndroidBridge() {
    const native = window.AndroidVault;
    if (!native) return;
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.vaultBridge) return;
    window.webkit = {
      messageHandlers: {
        vaultBridge: {
          postMessage: function (msg) {
            try { native.postMessage(JSON.stringify(msg)); } catch (e) {}
          }
        }
      }
    };
    document.documentElement.classList.add('android');
    // 物理返回键：先关弹层，再回首页，都不需要才让系统退出
    window.__androidBack = function () {
      const open = document.querySelectorAll('.overlay.open');
      if (open.length) { open[open.length - 1].classList.remove('open'); return true; }
      if (currentTab !== 'home') { switchTab('home'); return true; }
      return false;
    };
  })();

  const hasBridge = !!(window.webkit && window.webkit.messageHandlers &&
                       window.webkit.messageHandlers.vaultBridge);

  const pendingCalls = new Map();
  let callSeq = 0;

  function nativeCall(method, params) {
    if (!hasBridge) return Promise.reject(new Error('no-bridge'));
    return new Promise((resolve, reject) => {
      const id = 'c' + (++callSeq);
      pendingCalls.set(id, { resolve, reject });
      try {
        window.webkit.messageHandlers.vaultBridge.postMessage({
          id: id, method: method, params: params || {}
        });
      } catch (e) {
        pendingCalls.delete(id);
        reject(e);
        return;
      }
      setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(new Error('bridge-timeout:' + method));
        }
      }, 6000);
    });
  }

  window.__bridgeReply = function (id, payload) {
    const p = pendingCalls.get(id);
    if (!p) return;
    pendingCalls.delete(id);
    if (payload && payload.ok) p.resolve(payload.result || {});
    else p.reject(new Error((payload && payload.error) || 'native-error'));
  };

  /* 原生事件（前后台切换） */
  let onAppEvent = function () {};
  window.__appEvent = function (name) { try { onAppEvent(name); } catch (e) {} };

  /* ============================================================
   * 2. 静态数据
   * ========================================================== */
  const CATEGORIES = ['社交', '支付', '购物', '影音', '游戏', '工具', '金融',
                      '工作', '学习', '出行', '医疗', '邮箱', '生活', '其他'];

  /* 分类配色（分类页标题标签用） */
  const CAT_COLORS = {
    '社交': '#0A84FF',
    '支付': '#FF9500',
    '购物': '#FF3B30',
    '影音': '#AF52DE',
    '游戏': '#34C759',
    '工具': '#00A7C4',
    '金融': '#D9A400',
    '工作': '#5E5CE6',
    '学习': '#FF2D55',
    '出行': '#00C7BE',
    '医疗': '#FF6482',
    '邮箱': '#4B6A88',
    '生活': '#8E7CC3',
    '其他': '#8A90A0'
  };

  /* 版本更新：随包发布的“最新版本”，用于小红点与更新页 */
  const LATEST_VERSION = '0.8';

  /* 联网检查地址（二选一，留空 = 关闭联网检查）。
     A. GitHub Releases 推荐：填 '用户名/仓库名'，例 'cheng/passwordwallet'
        会读 https://api.github.com/repos/<repo>/releases/latest 的 tag_name / body / html_url
     B. 自建静态 JSON：填完整 https 地址，返回 {"version":"0.6","notes":[...],"url":"..."}
     注：window.__UPDATE_FEED_URL / window.__UPDATE_GITHUB_REPO 仅用于本地联调覆盖。 */
  const GITHUB_UPDATE_REPO = (typeof window !== 'undefined' && window.__UPDATE_GITHUB_REPO) || 'checkak/passwordwallet';
  const UPDATE_FEED_URL = (typeof window !== 'undefined' && window.__UPDATE_FEED_URL) || '';
  const UPDATE_CHECK_TTL = 6 * 60 * 60 * 1000;

  const PALETTES = [
    ['#34C759', '#0B9E45'],
    ['#3D9BFF', '#0B5FE0'],
    ['#FF7A45', '#EE3B2B'],
    ['#FF3D68', '#CE0F4E'],
    ['#9B8BFF', '#5B45E0'],
    ['#FFB020', '#ED8A00'],
    ['#2B3648', '#0D141D'],
    ['#2ED3D8', '#028B96'],
    ['#F76FB4', '#C43A88'],
    ['#5C6B8A', '#2B3245']
  ];

  const GLYPHS = [
    '💬', '💰', '🐧', '🎮', '🛒', '📧', '📺', '🎧', '🌐', '📕',
    '🚄', '🏦', '🍎', '🔍', '📌', '☁️', '❓', '📱', '🎬', '🍔',
    '✈️', '🏥', '📚', '🎓', '👤', '💳', '🔑', '🎨', '🚗', '🚕',
    '🏠', '🛡️', '🎫', '🎟️', '📦', '🔒', '🧾', '💼', '📊', '🗓️',
    '🎵', '📷', '⚽', '🎯', '🎁', '🧩', '🪟', '☕', '🍜', '🎙️',
    '📖', '💎', '🧠', '🏋️', '🛠️', '🔔'
  ];

  const TEMPLATES = [
    { name: '微信', glyph: '💬', color: ['#3ED46B', '#08A03F'], cat: '社交', hint: '手机号 / 微信号' },
    { name: 'QQ', glyph: '🐧', color: ['#33C3F6', '#0C8FD6'], cat: '社交', hint: 'QQ 号' },
    { name: '微博', glyph: '🌐', color: ['#FF7B4D', '#E01B12'], cat: '社交', hint: '手机号 / 邮箱' },
    { name: '小红书', glyph: '📕', color: ['#FF5C7A', '#D40E45'], cat: '社交', hint: '手机号' },
    { name: '知乎', glyph: '❓', color: ['#4FA9FF', '#0A62D0'], cat: '社交', hint: '手机号 / 邮箱' },
    { name: '百度贴吧', glyph: '🧩', color: ['#4E9BFF', '#1B5FD0'], cat: '社交', hint: '用户名' },
    { name: '豆瓣', glyph: '🌱', color: ['#3FA45B', '#1F7A3C'], cat: '社交', hint: '手机号 / 邮箱' },
    { name: 'Soul', glyph: '🌙', color: ['#6C5CE7', '#3B2E8F'], cat: '社交', hint: '手机号' },
    { name: '陌陌', glyph: '💫', color: ['#FF8A65', '#E64A19'], cat: '社交', hint: '手机号' },
    { name: 'Telegram', glyph: '✈️', color: ['#3CA5E0', '#1C7BB5'], cat: '社交', hint: '手机号' },
    { name: 'WhatsApp', glyph: '💚', color: ['#4CD964', '#1E9E4A'], cat: '社交', hint: '手机号' },
    { name: 'Instagram', glyph: '📷', color: ['#F06292', '#8E24AA'], cat: '社交', hint: '用户名' },
    { name: 'X', glyph: '✖️', color: ['#3A3F47', '#0B0E13'], cat: '社交', hint: '用户名' },
    { name: 'Facebook', glyph: '📘', color: ['#5B8DEF', '#1B4FBF'], cat: '社交', hint: '邮箱' },
    { name: 'Discord', glyph: '🎧', color: ['#6C7FF0', '#3B45B5'], cat: '社交', hint: '邮箱' },
    { name: 'LINE', glyph: '💬', color: ['#3FD07A', '#0F9E4E'], cat: '社交', hint: '手机号' },
    { name: '支付宝', glyph: '支', color: ['#3FA0FF', '#0A63E8'], cat: '支付', hint: '手机号 / 邮箱' },
    { name: '云闪付', glyph: '💳', color: ['#E8443A', '#B3141C'], cat: '支付', hint: '手机号' },
    { name: '淘宝', glyph: '🛒', color: ['#FF8B3D', '#F0431D'], cat: '购物', hint: '淘宝会员名' },
    { name: '京东', glyph: '🛍️', color: ['#FF5A4E', '#D3160F'], cat: '购物', hint: '手机号' },
    { name: '拼多多', glyph: '🍎', color: ['#FF6A5C', '#D9201A'], cat: '购物', hint: '手机号' },
    { name: '闲鱼', glyph: '🐟', color: ['#FFC53D', '#F09A00'], cat: '购物', hint: '手机号' },
    { name: '得物', glyph: '👟', color: ['#3ED2C0', '#0C9A8C'], cat: '购物', hint: '手机号' },
    { name: '美团', glyph: '🍔', color: ['#FFD43B', '#F0A400'], cat: '购物', hint: '手机号' },
    { name: '饿了么', glyph: '🥡', color: ['#3FA9FF', '#0A6FD8'], cat: '购物', hint: '手机号' },
    { name: '大众点评', glyph: '🍜', color: ['#FF8A3D', '#E85A00'], cat: '购物', hint: '手机号' },
    { name: '亚马逊', glyph: '📦', color: ['#3B4A5A', '#121A22'], cat: '购物', hint: '邮箱' },
    { name: '抖音', glyph: '🎵', color: ['#3A3F52', '#12151C'], cat: '影音', hint: '手机号 / 抖音号' },
    { name: '快手', glyph: '🎬', color: ['#FF9F43', '#F25C05'], cat: '影音', hint: '手机号' },
    { name: '哔哩哔哩', glyph: '📺', color: ['#FF9AC1', '#F25E8E'], cat: '影音', hint: '手机号 / 邮箱' },
    { name: '网易云音乐', glyph: '🎧', color: ['#FF5E5E', '#C30C0C'], cat: '影音', hint: '手机号' },
    { name: 'QQ 音乐', glyph: '🎼', color: ['#4CD07A', '#0E9A44'], cat: '影音', hint: 'QQ / 微信登录' },
    { name: '喜马拉雅', glyph: '🎙️', color: ['#FF7A45', '#E03A00'], cat: '影音', hint: '手机号' },
    { name: '爱奇艺', glyph: '🎞️', color: ['#4CD964', '#0C9E42'], cat: '影音', hint: '手机号' },
    { name: '腾讯视频', glyph: '▶️', color: ['#4FA9FF', '#0A62D0'], cat: '影音', hint: '手机号' },
    { name: '优酷', glyph: '📽️', color: ['#3FA9FF', '#0B5FBF'], cat: '影音', hint: '手机号' },
    { name: 'Netflix', glyph: '🍿', color: ['#E50914', '#8B0007'], cat: '影音', hint: '邮箱' },
    { name: 'Spotify', glyph: '🎵', color: ['#3FD46A', '#0E9E45'], cat: '影音', hint: '邮箱' },
    { name: 'YouTube', glyph: '⏯️', color: ['#FF4D4D', '#C00000'], cat: '影音', hint: '邮箱' },
    { name: 'Steam', glyph: '🎮', color: ['#4B6A88', '#101C29'], cat: '游戏', hint: '账号名 / 邮箱' },
    { name: 'Epic', glyph: '🕹️', color: ['#3A3F47', '#0B0E13'], cat: '游戏', hint: '邮箱' },
    { name: 'TapTap', glyph: '🎯', color: ['#3ED2C0', '#0C9A8C'], cat: '游戏', hint: '手机号 / 邮箱' },
    { name: '米游社', glyph: '🎋', color: ['#5FA8FF', '#1B62C8'], cat: '游戏', hint: '手机号' },
    { name: 'PlayStation', glyph: '🎮', color: ['#3A6BC7', '#1B3C82'], cat: '游戏', hint: '邮箱' },
    { name: 'Nintendo', glyph: '🔴', color: ['#E8443A', '#B3141C'], cat: '游戏', hint: '邮箱' },
    { name: 'QQ 邮箱', glyph: '📧', color: ['#45B4F5', '#1373C9'], cat: '工具', hint: 'xxx@qq.com' },
    { name: '钉钉', glyph: '📌', color: ['#48A8FF', '#0A6EDB'], cat: '工具', hint: '手机号' },
    { name: '企业微信', glyph: '🏢', color: ['#4C8DFF', '#1A5FD0'], cat: '工具', hint: '企业账号' },
    { name: '飞书', glyph: '🕊️', color: ['#4C8DFF', '#1A5FD0'], cat: '工具', hint: '手机号' },
    { name: '腾讯会议', glyph: '📹', color: ['#4FA9FF', '#0A62D0'], cat: '工具', hint: '手机号' },
    { name: '百度网盘', glyph: '☁️', color: ['#5B9BFF', '#2064E8'], cat: '工具', hint: '手机号 / 邮箱' },
    { name: '阿里云盘', glyph: '🗂️', color: ['#FF7A45', '#E03A00'], cat: '工具', hint: '手机号' },
    { name: '12306', glyph: '🚄', color: ['#63B8FF', '#1D6FD0'], cat: '工具', hint: '用户名' },
    { name: '高德地图', glyph: '🗺️', color: ['#3FA9FF', '#0A6FD8'], cat: '工具', hint: '手机号' },
    { name: '滴滴出行', glyph: '🚕', color: ['#FF8A3D', '#E85A00'], cat: '工具', hint: '手机号' },
    { name: '携程', glyph: '✈️', color: ['#4AA8FF', '#0B62D6'], cat: '工具', hint: '手机号' },
    { name: 'GitHub', glyph: '🐙', color: ['#4B5563', '#161B22'], cat: '工具', hint: '用户名 / 邮箱' },
    { name: 'Apple ID', glyph: '🍎', color: ['#6E7681', '#1E242C'], cat: '工具', hint: 'xxx@icloud.com' },
    { name: 'Google', glyph: '🔍', color: ['#5C9BFF', '#1A73E8'], cat: '工具', hint: 'xxx@gmail.com' },
    { name: 'Microsoft', glyph: '🪟', color: ['#4FA9FF', '#0A62D0'], cat: '工具', hint: '邮箱' },
    { name: 'Notion', glyph: '📝', color: ['#3A3F47', '#0B0E13'], cat: '工具', hint: '邮箱' },
    { name: 'Zoom', glyph: '🎥', color: ['#4FA9FF', '#2D8CFF'], cat: '工具', hint: '邮箱' },
    { name: '中国移动', glyph: '📶', color: ['#3FA9FF', '#0A6FD8'], cat: '工具', hint: '手机号' },
    { name: '招商银行', glyph: '🏦', color: ['#F04A4A', '#B40000'], cat: '金融', hint: '一卡通号 / 手机号' },
    { name: '工商银行', glyph: '🏦', color: ['#D93A3A', '#9C1010'], cat: '金融', hint: '卡号 / 手机号' },
    { name: '建设银行', glyph: '🏦', color: ['#3E7BD6', '#12509E'], cat: '金融', hint: '卡号' },
    { name: 'PayPal', glyph: '💰', color: ['#4FA3E3', '#1B6FB5'], cat: '金融', hint: '邮箱' }
  ];

  /* ============================================================
   * 3. 存储
   * ========================================================== */
  const LS_KEY = 'pw.vault.v1';
  const LS_PASS = 'pw.pass.v1';

  const store = {
    async load() {
      if (hasBridge) {
        try {
          const r = await nativeCall('vault.load');
          if (r && r.data) return JSON.parse(r.data);
          return null;
        } catch (e) { /* 落到本地降级 */ }
      }
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    async save(state) {
      const data = JSON.stringify(state);
      if (hasBridge) {
        try { await nativeCall('vault.save', { data: data }); return; } catch (e) {}
      }
      localStorage.setItem(LS_KEY, data);
    }
  };

  const passcode = {
    async has() {
      if (hasBridge) {
        try { const r = await nativeCall('passcode.has'); return !!r.has; } catch (e) {}
      }
      return !!localStorage.getItem(LS_PASS);
    },
    async set(code) {
      if (hasBridge) { await nativeCall('passcode.set', { passcode: code }); return; }
      localStorage.setItem(LS_PASS, simpleHash(code));
    },
    async verify(code) {
      if (hasBridge) {
        try { const r = await nativeCall('passcode.verify', { passcode: code }); return !!r.ok; }
        catch (e) { return false; }
      }
      return localStorage.getItem(LS_PASS) === simpleHash(code);
    },
    async clear() {
      if (hasBridge) { try { await nativeCall('passcode.clear'); } catch (e) {} }
      localStorage.removeItem(LS_PASS);
    }
  };

  function simpleHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(16);
  }

  /* ============================================================
   * 4. 状态
   * ========================================================== */
  let state = {
    version: 1,
    cards: [],
    settings: { mode: 'wheel', hideBanner: false, autoLock: true }
  };
  let currentTab = 'home';
  let activeCardId = null;
  let editingId = null;
  let locked = false;

  const $ = (id) => document.getElementById(id);
  const el = (sel, root) => (root || document).querySelector(sel);

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function demoCards() {
    const now = Date.now();
    return [
      { id: uid(), name: '微信', glyph: '💬', color: ['#3ED46B', '#08A03F'], cat: '社交',
        account: 'cheng_yy@qq.com', password: 'Cheng@2024qq', note: '绑定手机 138****6789',
        favorite: true, createdAt: now - 86400000 * 3, updatedAt: now - 86400000 * 2 },
      { id: uid(), name: '支付宝', glyph: '支', color: ['#3FA0FF', '#0A63E8'], cat: '支付',
        account: '150****8888', password: 'Alipay#2024', note: '支付密码在另处记录',
        favorite: false, createdAt: now - 86400000 * 2, updatedAt: now - 3600000 * 5 },
      { id: uid(), name: 'Steam', glyph: '🎮', color: ['#4B6A88', '#101C29'], cat: '游戏',
        account: 'cheng_steam', password: 'Steam#2024acc', note: '二级验证邮箱同微信',
        favorite: false, createdAt: now - 86400000, updatedAt: now - 3600000 }
    ];
  }

  /* ============================================================
   * 5. 工具
   * ========================================================== */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function maskValue(s, headN, tailN) {
    s = String(s || '');
    if (!s) return '—';
    if (s.length <= headN + tailN + 1) {
      return s[0] + '*'.repeat(Math.max(1, s.length - 2)) + (s.length > 1 ? s.slice(-1) : '');
    }
    return s.slice(0, headN) + '*****' + (tailN ? s.slice(-tailN) : '');
  }

  function maskAccount(v) {
    v = String(v || '');
    if (!v) return '—';
    const at = v.indexOf('@');
    if (at > 2) return maskValue(v.slice(0, at), 5, 0) + v.slice(at);
    return maskValue(v, 3, 2);
  }

  function maskPassword(p) {
    const n = Math.min(String(p || '').length, 8);
    return n ? '•'.repeat(Math.max(n, 4)) : '—';
  }

  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 2) return '昨天';
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function grad(c) {
    const a = (c && c[0]) || '#3D9BFF';
    const b = (c && c[1]) || '#0B5FE0';
    return 'linear-gradient(135deg,' + a + ' 0%,' + b + ' 100%)';
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1700);
  }

  function haptic(type) {
    if (hasBridge) { nativeCall('haptic', { type: type || 'light' }).catch(() => {}); }
  }

  async function copyText(text, sensitive) {
    if (!text) { toast('没有可复制的内容'); return; }
    if (hasBridge) {
      try {
        await nativeCall('clipboard.copy', { text: text, sensitive: !!sensitive });
        toast(sensitive ? '已复制，60 秒后自动清空' : '已复制');
        return;
      } catch (e) {}
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      toast(sensitive ? '已复制，60 秒后自动清空' : '已复制');
    } catch (e) {
      toast('复制失败');
    }
  }

  function cardById(id) { return state.cards.find(c => c.id === id); }

  function sortedCards() {
    return state.cards.slice().sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  }

  /* 首页搜索：App 名 / 账号 / 分类 / 备注 模糊匹配 */
  let searchQuery = '';

  function matchesQuery(card) {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return [card.name, card.account, card.cat, card.note].some(v =>
      String(v == null ? '' : v).toLowerCase().indexOf(q) >= 0);
  }

  function visibleCards() {
    return sortedCards().filter(matchesQuery);
  }

  async function persist() {
    state.settings.mode = state.settings.mode || 'wheel';
    await store.save(state);
  }

  /* ============================================================
   * 6. 首页渲染
   * ========================================================== */
  function cardNode(card, index) {
    const node = document.createElement('button');
    node.className = 'card';
    node.dataset.id = card.id;
    node.style.background = grad(card.color);
    node.innerHTML =
      '<div class="c-icon">' + esc(card.glyph || '🔑') + '</div>' +
      '<div class="c-main">' +
        '<div class="c-name">' + esc(card.name) + '</div>' +
        '<div class="c-line">' +
          '<div class="c-row">' +
            '<span class="c-tag">账号</span>' +
            '<span class="c-account">' + esc(maskAccount(card.account)) + '</span>' +
          '</div>' +
          '<div class="c-row">' +
            '<span class="c-tag">密码</span>' +
            '<span class="pw">' + maskPassword(card.password) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (card.favorite ? '<div class="c-star">★</div>' : '');
    node.dataset.index = String(index);
    node.addEventListener('click', () => {
      if (suppressWheelClick) return;          // 刚滑动过，交给手势处理
      const idx = Number(node.dataset.index);
      if (idx === wheelActive) { haptic('light'); openDetail(card.id); }
      else { setWheelActive(idx); }
    });
    return node;
  }

  /* ---------- 左轮转盘（V0.7） ---------- */
  let wheelActive = 0;
  let hintHidden = false;
  let suppressWheelClick = false;

  function hideWheelHint() {
    if (hintHidden) return;
    hintHidden = true;
    const hint = $('wheelHint');
    if (hint) hint.style.opacity = '0';
  }

  function renderDots(total) {
    const box = $('wheelDots');
    box.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('i');
      if (i === wheelActive) dot.className = 'on';
      box.appendChild(dot);
    }
  }

  function layoutWheel() {
    const stage = $('wheelTrack');
    if (!stage) return;
    const cards = Array.prototype.slice.call(stage.children);
    if (!cards.length) return;
    const h = stage.clientHeight || 520;
    const cardH = cards[0].offsetHeight || 108;
    const n = cards.length;

    // 卡片扇形间距：张数多时自动压缩
    const pitch = Math.max(76, Math.min(108, (h - cardH - 40) / Math.max(1, n - 1)));
    const totalSpan = (n - 1) * pitch + cardH;
    // 选中卡片锚在容器 40% 高度处（偏上，给右侧提示留白）
    const anchor = Math.round(h * 0.32);
    const centerY = anchor;                    // 选中卡片中心
    const shift = -wheelActive * pitch;        // 让选中卡片落在锚点

    cards.forEach((node, i) => {
      const d = i - wheelActive;
      const ad = Math.abs(d);
      const baseY = centerY + i * pitch + shift;
      const ty = Math.max(-cardH, baseY - cardH / 2);   // 越界后裁掉
      const tx = Math.min(26, ad * 8);         // 越远越往右探出（左轮扇形）
      const rot = Math.min(4.5, ad * 1.6);     // 轻微倾斜
      const sc = d === 0 ? 1.03 : 1 - Math.min(ad, 4) * 0.028;
      const op = ad > 4 ? 0 : Math.max(0.28, 1 - ad * 0.16);

      node.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) rotate(' + rot + 'deg) scale(' + sc.toFixed(3) + ')';
      node.style.opacity = op.toFixed(2);
      node.style.zIndex = String(200 - ad);
      node.classList.toggle('is-active', d === 0);
      node.style.pointerEvents = ad > 4 ? 'none' : 'auto';
    });

    Array.prototype.forEach.call($('wheelDots').children, (dot, i) => {
      dot.classList.toggle('on', i === wheelActive);
    });
  }

  function setWheelActive(i, silent) {
    const total = $('wheelTrack').children.length;
    if (!total) return;
    const next = Math.max(0, Math.min(total - 1, i));
    if (next === wheelActive) return;
    wheelActive = next;
    layoutWheel();
    hideWheelHint();
    if (!silent) haptic('light');
  }

  function renderWheel() {
    const stage = $('wheelTrack');
    stage.innerHTML = '';
    const cards = visibleCards();
    cards.forEach((c, i) => {
      const node = cardNode(c, i);
      node.classList.add('wheel-card');
      stage.appendChild(node);
    });
    if (wheelActive > cards.length - 1) wheelActive = Math.max(0, cards.length - 1);
    renderDots(cards.length);
    requestAnimationFrame(layoutWheel);
  }

  /* 手势：上滑看下一张、下滑回上一张；桌面端支持滚轮与方向键 */
  function bindWheelGestures() {
    const view = $('wheelView');
    let drag = null;

    view.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, fired: false }; });
    view.addEventListener('pointermove', (e) => {
      if (!drag || drag.fired) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) >= 34) {
        drag.fired = true;                     // 一次拖动只切一张
        suppressWheelClick = true;
        setTimeout(() => { suppressWheelClick = false; }, 400);
        setWheelActive(wheelActive + (dy < 0 ? 1 : -1));
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
      view.addEventListener(ev, () => { drag = null; }));

    let wheelLock = 0;
    view.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) < 6) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelLock < 260) return;       // 滚轮节流
      wheelLock = now;
      setWheelActive(wheelActive + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    document.addEventListener('keydown', (e) => {
      if (currentTab !== 'home' || state.settings.mode !== 'wheel') return;
      if (e.key === 'ArrowDown') setWheelActive(wheelActive + 1);
      if (e.key === 'ArrowUp') setWheelActive(wheelActive - 1);
    });
  }

  function rowNode(card) {
    const row = document.createElement('button');
    row.className = 'row';
    row.innerHTML =
      '<div class="row-icon" style="background:' + grad(card.color) + ';color:#fff">' +
        esc(card.glyph || '🔑') + '</div>' +
      '<div class="row-main">' +
        '<div class="row-name">' + esc(card.name) + '</div>' +
        '<div class="row-sub">' + esc(maskAccount(card.account)) + '</div>' +
      '</div>' +
      '<span class="row-chev">›</span>';
    row.addEventListener('click', () => { haptic('light'); openDetail(card.id); });
    return row;
  }

  function renderList() {
    const track = $('listTrack');
    track.innerHTML = '';
    const cards = visibleCards();
    cards.forEach(c => track.appendChild(rowNode(c)));
    $('listHead').innerHTML = cards.length
      ? '<p class="page-lead">' + (searchQuery ? '搜索到 ' + cards.length + ' 张卡片' : '共 ' + cards.length + ' 张卡片') +
        ' · 点击查看账号与密码</p>'
      : '';
  }

  function renderHome() {
    const all = sortedCards();
    const shown = visibleCards();
    const empty = $('homeEmpty');
    const searchEmpty = $('searchEmpty');
    const wrap = el('.view-wrap');
    if (!all.length) {
      empty.classList.remove('hidden');
      searchEmpty.classList.add('hidden');
      wrap.style.display = 'none';
      $('wheelTrack').innerHTML = '';
      $('listTrack').innerHTML = '';
      renderDots(0);
    } else if (!shown.length) {
      empty.classList.add('hidden');
      searchEmpty.classList.remove('hidden');
      wrap.style.display = 'none';
      $('wheelTrack').innerHTML = '';
      $('listTrack').innerHTML = '';
      renderDots(0);
    } else {
      empty.classList.add('hidden');
      searchEmpty.classList.add('hidden');
      wrap.style.display = '';
      renderWheel();
      renderList();
    }
    const mode = state.settings.mode || 'wheel';
    setMode(mode, true);
    $('banner').classList.toggle('hidden', !!state.settings.hideBanner);
  }

  const MODE_ICONS = {
    list: '<svg viewBox="0 0 24 24" width="21" height="21"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" width="21" height="21"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>'
  };

  function setMode(mode, silent) {
    state.settings.mode = mode;
    $('wheelView').classList.toggle('hidden', mode !== 'wheel');
    $('listView').classList.toggle('hidden', mode !== 'list');
    // 按钮显示的是「切过去的模式」
    $('btnModeLabel').textContent = mode === 'wheel' ? '列表' : '轮盘';
    $('btnModeIcon').innerHTML = mode === 'wheel' ? MODE_ICONS.list : MODE_ICONS.wheel;
    if (!silent) { haptic('light'); persist(); }
    if (mode === 'wheel') requestAnimationFrame(layoutWheel);
  }

  /* ============================================================
   * 7. 分类 / 收藏 / 我的
   * ========================================================== */
  function renderCategory() {
    const body = $('categoryBody');
    body.innerHTML = '';
    if (!state.cards.length) {
      body.innerHTML = '<div class="empty-state"><div class="empty-art">🗂️</div>' +
        '<h3>还没有卡片</h3><p>先在首页添加一张密码卡片吧</p></div>';
      return;
    }
    CATEGORIES.forEach(cat => {
      const list = state.cards.filter(c => (c.cat || '其他') === cat);
      if (!list.length) return;
      const block = document.createElement('div');
      block.className = 'cat-block';
      const color = CAT_COLORS[cat] || CAT_COLORS['其他'];
      const rgb = hexToRgb(color);
      const tint = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.13)';
      block.innerHTML =
        '<div class="cat-head">' +
          '<span class="cat-name" style="color:' + color + ';background:' + tint + '">' +
            '<i class="cat-dot"></i>' + esc(cat) +
          '</span>' +
          '<span class="cat-count" style="color:' + color + ';background:' + tint + '">' +
            list.length +
          '</span>' +
        '</div>' +
        '<div class="cat-items"></div>';
      const items = el('.cat-items', block);
      list.forEach(c => {
        const row = document.createElement('button');
        row.className = 'cat-item';
        row.innerHTML =
          '<div class="row-icon" style="background:' + grad(c.color) + ';color:#fff">' +
            esc(c.glyph || '🔑') + '</div>' +
          '<div class="row-main"><div class="row-name">' + esc(c.name) + '</div>' +
          '<div class="row-sub">' + esc(maskAccount(c.account)) + '</div></div>' +
          '<span class="row-chev">›</span>';
        row.addEventListener('click', () => openDetail(c.id));
        items.appendChild(row);
      });
      body.appendChild(block);
    });
  }

  function renderFav() {
    const body = $('favBody');
    body.innerHTML = '';
    const favs = sortedCards().filter(c => c.favorite);
    if (!favs.length) {
      body.innerHTML = '<div class="empty-state"><div class="empty-art">⭐️</div>' +
        '<h3>还没有收藏</h3><p>在卡片详情页点击「收藏」，常用账号即可置顶在这里</p></div>';
      return;
    }
    const box = document.createElement('div');
    box.className = 'list-track';
    favs.forEach(c => box.appendChild(rowNode(c)));
    body.appendChild(box);
  }

  function renderMe() {
    $('meStat').textContent = state.cards.length + ' 张卡片 · 数据仅保存在本机';
    passcode.has().then(has => {
      $('passcodeState').textContent = has ? '已开启' : '未开启';
    });
    $('swAutoLock').checked = state.settings.autoLock !== false;
    refreshUpdateBadge();
  }

  /* ---------- 通用确认弹窗（返回 Promise<boolean>） ---------- */
  let confirmResolver = null;

  function confirmDialog(opts) {
    return new Promise((resolve) => {
      $('confirmTitle').textContent = opts.title || '确认操作';
      $('confirmMessage').textContent = opts.message || '';
      $('confirmOk').textContent = opts.confirmText || '确定';
      $('confirmOk').classList.toggle('danger', opts.danger !== false);
      confirmResolver = resolve;
      openOverlay('confirmOverlay');
    });
  }

  function settleConfirm(value) {
    closeOverlay('confirmOverlay');
    const resolve = confirmResolver;
    confirmResolver = null;
    if (resolve) resolve(!!value);
  }

  function bindConfirm() {
    $('confirmCancel').addEventListener('click', () => settleConfirm(false));
    $('confirmOk').addEventListener('click', () => settleConfirm(true));
    $('confirmOverlay').addEventListener('click', (e) => {
      if (e.target === $('confirmOverlay')) settleConfirm(false);
    });
  }

  /* ---------- 版本更新 ---------- */
  function appVersionText() {
    return normalizeVersion($('appVersion').textContent || LATEST_VERSION);
  }

  function normalizeVersion(v) {
    return String(v == null ? '' : v).replace(/^[vV]/, '').split(/[-+\s(]/)[0].trim();
  }

  function versionGt(a, b) {
    const pa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  function latestVersion() {
    const remote = normalizeVersion(state.settings.remoteVersion);
    if (remote && versionGt(remote, LATEST_VERSION)) return remote;
    return LATEST_VERSION;
  }

  function updateFeedMode() {
    if (GITHUB_UPDATE_REPO) return 'github';
    if (UPDATE_FEED_URL) return 'json';
    return '';
  }

  function refreshUpdateBadge() {
    const current = appVersionText();
    const latest = latestVersion();
    const unread = normalizeVersion(state.settings.seenVersion) !== latest;
    const newer = versionGt(latest, current);
    const showDot = unread || newer;

    $('updateDot').classList.toggle('hidden', !showDot);
    $('updateState').textContent = showDot ? '有新版本' : '已是最新';
    $('uvCurrent').textContent = 'V' + current;
    $('uvLatest').textContent = 'V' + latest;
    $('uvBadge').classList.toggle('hidden', !showDot);
    $('updateSummary').textContent = newer
      ? '发现新版本 V' + latest + '，建议升级体验'
      : (unread ? 'V' + latest + ' 更新说明未读，点开看看' : '当前已是最新版本');
    updateCheckedLine();
    renderRemoteNotes();
  }

  /* 上次联网检查的状态行 */
  function updateCheckedLine() {
    const node = $('updateChecked');
    if (!node) return;
    const mode = updateFeedMode();
    if (!mode) {
      node.textContent = '未配置更新源（离线模式，仅比对安装包内版本）';
      return;
    }
    const at = state.settings.lastCheckAt;
    if (!at) { node.textContent = (mode === 'github' ? 'GitHub ' + GITHUB_UPDATE_REPO + ' · 尚未检查' : '尚未检查'); return; }
    const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
    const when = mins < 1 ? '刚刚' : (mins < 60 ? mins + ' 分钟前' : Math.round(mins / 60) + ' 小时前');
    const src = mode === 'github' ? 'GitHub Releases' : '更新源';
    if (state.settings.lastCheckOk) {
      node.textContent = '上次检查：' + when + ' · ' + src + ' 正常';
    } else {
      const reason = String(state.settings.lastCheckError || '').slice(0, 40);
      node.textContent = '上次检查：' + when + ' · ' + src + ' 不可达' + (reason ? '（' + reason + '）' : '');
    }
  }

  /* 远程更新说明（有新版本时展示 Release 正文） */
  function renderRemoteNotes() {
    const card = $('remoteNotesCard');
    if (!card) return;
    const notes = Array.isArray(state.settings.remoteNotes) ? state.settings.remoteNotes : [];
    const remote = normalizeVersion(state.settings.remoteVersion);
    const show = notes.length > 0 && remote && versionGt(remote, appVersionText());
    card.classList.toggle('hidden', !show);
    if (!show) return;
    $('remoteNotesTitle').textContent = 'V' + remote + ' 更新内容（来自 GitHub）';
    $('remoteNotesList').innerHTML = notes.map(n => '<li>' + esc(n) + '</li>').join('');
  }

  /* ---------- 联网检查新版本 ---------- */
  async function fetchJsonViaBridge(url) {
    if (hasBridge) {
      const r = await nativeCall('http.get', { url: url });
      if (!r || !r.status || r.status >= 400) throw new Error('http ' + (r && r.status));
      return JSON.parse(r.body || '{}');
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  }

  /* 把 GitHub Release / 自建 JSON 统一成 {version, notes, url} */
  function parseFeed(mode, data) {
    if (mode === 'github') {
      if (!data || !data.tag_name) return null;
      const body = String(data.body || '');
      const notes = body.split('\n')
        .map(l => l.replace(/^[\s>*#\-]+/, '').trim())
        .filter(l => l.length > 0 && l.length < 120)
        .slice(0, 6);
      return {
        version: normalizeVersion(data.tag_name),
        notes: notes,
        url: data.html_url || '',
        name: data.name || ''
      };
    }
    if (!data || !data.version) return null;
    return {
      version: normalizeVersion(data.version),
      notes: Array.isArray(data.notes) ? data.notes.slice(0, 8).map(String) : [],
      url: data.url || '',
      name: data.name || ''
    };
  }

  async function checkRemoteVersion(force) {
    const mode = updateFeedMode();
    if (!mode) return;
    const last = state.settings.lastCheckAt || 0;
    if (!force && Date.now() - last < UPDATE_CHECK_TTL) return;

    let url;
    if (mode === 'github') {
      const apiBase = (typeof window !== 'undefined' && window.__UPDATE_API_BASE) || 'https://api.github.com';
      url = apiBase + '/repos/' + GITHUB_UPDATE_REPO + '/releases/latest';
    } else {
      const sep = UPDATE_FEED_URL.indexOf('?') >= 0 ? '&' : '?';
      url = UPDATE_FEED_URL + sep + 't=' + Date.now();
    }

    try {
      const data = await fetchJsonViaBridge(url);
      const info = parseFeed(mode, data);
      if (info && info.version) {
        state.settings.remoteVersion = info.version;
        state.settings.remoteNotes = info.notes;
        state.settings.remoteUrl = info.url;
        state.settings.remoteName = info.name;
        state.settings.lastCheckOk = true;
      } else {
        state.settings.lastCheckOk = false;
      }
    } catch (e) {
      state.settings.lastCheckOk = false;
      state.settings.lastCheckError = String((e && e.message) || e);
    }
    state.settings.lastCheckAt = Date.now();
    await persist();
    refreshUpdateBadge();
  }

  async function openUpdate() {
    const latest = latestVersion();
    const wasUnread = state.settings.seenVersion !== latest;
    refreshUpdateBadge();
    // 打开瞬间仍展示 NEW 徽标，关掉后就不再提示
    $('uvBadge').classList.toggle('hidden', !wasUnread);
    $('updateSummary').textContent = wasUnread
      ? 'V' + latest + ' 更新说明（本次首次查看）'
      : '当前版本 V' + appVersionText() + ' · 已是最新';
    openOverlay('updateOverlay');
    if (updateFeedMode()) checkRemoteVersion(true);

    if (wasUnread) {
      state.settings.seenVersion = latest;
      await persist();
      $('updateDot').classList.add('hidden');
      $('updateState').textContent = '已是最新';
    }
  }

  function bindUpdate() {
    $('rowUpdate').addEventListener('click', () => { haptic('light'); openUpdate(); });
    $('updateClose').addEventListener('click', () => closeOverlay('updateOverlay'));
    $('updateOverlay').addEventListener('click', (e) => {
      if (e.target === $('updateOverlay')) closeOverlay('updateOverlay');
    });
  }

  function renderAll() {
    renderHome();
    renderCategory();
    renderFav();
    renderMe();
  }

  /* ============================================================
   * 8. 详情页
   * ========================================================== */
  function openOverlay(id) {
    $(id).classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeOverlay(id) {
    $(id).classList.remove('open');
  }

  function openDetail(id) {
    const card = cardById(id);
    if (!card) return;
    activeCardId = id;
    $('detailArt').style.background = grad(card.color);
    $('detailIcon').textContent = card.glyph || '🔑';
    $('detailName').textContent = card.name;
    $('detailMasked').textContent = maskAccount(card.account);
    $('detailAccount').textContent = card.account || '—';
    $('detailCategory').textContent = card.cat || '其他';
    $('detailNote').textContent = card.note || '—';
    $('detailUpdated').textContent = fmtTime(card.updatedAt);
    $('detailPassword').textContent = maskPassword(card.password);
    $('detailPassword').dataset.revealed = '0';
    $('detailFav').textContent = card.favorite ? '★ 已收藏' : '☆ 收藏';
    openOverlay('detailOverlay');
  }

  function currentDetailCard() { return cardById(activeCardId); }

  function bindDetail() {
    $('detailClose').addEventListener('click', () => {
      closeOverlay('detailOverlay');
    });
    $('detailOverlay').addEventListener('click', (e) => {
      if (e.target === $('detailOverlay')) closeOverlay('detailOverlay');
    });

    $('togglePwd').addEventListener('click', () => {
      const card = currentDetailCard();
      if (!card) return;
      const node = $('detailPassword');
      const revealed = node.dataset.revealed === '1';
      node.textContent = revealed ? maskPassword(card.password) : (card.password || '—');
      node.dataset.revealed = revealed ? '0' : '1';
      haptic('light');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), (btn) => {
      btn.addEventListener('click', () => {
        const card = currentDetailCard();
        if (!card) return;
        if (btn.dataset.copy === 'account') copyText(card.account, false);
        else copyText(card.password, true);
        haptic('light');
      });
    });

    $('detailFav').addEventListener('click', async () => {
      const card = currentDetailCard();
      if (!card) return;
      card.favorite = !card.favorite;
      card.updatedAt = Date.now();
      $('detailFav').textContent = card.favorite ? '★ 已收藏' : '☆ 收藏';
      await persist();
      renderAll();
      toast(card.favorite ? '已加入收藏' : '已取消收藏');
    });

    $('detailEdit').addEventListener('click', () => {
      const card = currentDetailCard();
      if (!card) return;
      closeOverlay('detailOverlay');
      openEditor(card);
    });

    $('detailDelete').addEventListener('click', async () => {
      const card = currentDetailCard();
      if (!card) return;
      const ok = await confirmDialog({
        title: '删除这张卡片',
        message: '将删除「' + card.name + '」，删除后无法恢复。\n如果只是想暂时收起，可以改为取消收藏。',
        confirmText: '删除',
        danger: true
      });
      if (!ok) return;
      state.cards = state.cards.filter(c => c.id !== card.id);
      await persist();
      closeOverlay('detailOverlay');
      renderAll();
      haptic('medium');
      toast('已删除「' + card.name + '」');
    });
  }

  /* ============================================================
   * 9. 编辑器
   * ========================================================== */
  let form = {
    name: '', account: '', password: '', note: '',
    cat: '其他', glyph: '🔑', color: PALETTES[1].slice(), favorite: false
  };

  function buildEditorOptions() {
    const chips = $('catChips');
    chips.innerHTML = '';
    CATEGORIES.forEach(cat => {
      const b = document.createElement('button');
      b.className = 'chip' + (form.cat === cat ? ' active' : '');
      b.textContent = cat;
      b.dataset.cat = cat;
      b.addEventListener('click', () => {
        form.cat = cat;
        Array.prototype.forEach.call(chips.children, x => x.classList.toggle('active', x.dataset.cat === cat));
        haptic('light');
      });
      chips.appendChild(b);
    });

    const grid = $('iconGrid');
    grid.innerHTML = '';
    GLYPHS.forEach(g => {
      const b = document.createElement('button');
      b.className = 'ic' + (form.glyph === g ? ' active' : '');
      b.textContent = g;
      b.dataset.glyph = g;
      b.addEventListener('click', () => {
        form.glyph = g;
        Array.prototype.forEach.call(grid.children, x => x.classList.toggle('active', x.dataset.glyph === g));
        updatePreview();
        haptic('light');
      });
      grid.appendChild(b);
    });

    const sw = $('swatches');
    sw.innerHTML = '';
    PALETTES.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'sw' + (form.color && form.color[0] === p[0] ? ' active' : '');
      b.style.background = 'linear-gradient(135deg,' + p[0] + ',' + p[1] + ')';
      b.dataset.i = String(i);
      b.addEventListener('click', () => {
        form.color = [p[0], p[1]];
        Array.prototype.forEach.call(sw.children, x => x.classList.toggle('active', x.dataset.i === String(i)));
        $('rgbPanel').classList.add('hidden');
        updatePreview();
        haptic('light');
      });
      sw.appendChild(b);
    });

    /* 自定义 RGB 入口 */
    const custom = document.createElement('button');
    custom.className = 'sw sw-custom' + (isCustomColor(form.color[0]) ? ' active' : '');
    custom.dataset.custom = '1';
    custom.title = '自定义 RGB';
    custom.addEventListener('click', () => {
      const panel = $('rgbPanel');
      panel.classList.toggle('hidden');
      if (!panel.classList.contains('hidden')) syncRgbPanel(form.color[0]);
      haptic('light');
    });
    sw.appendChild(custom);
  }

  /* ---------- 颜色工具 ---------- */
  function hexToRgb(hex) {
    const h = String(hex || '#000000').replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(full, 16) || 0;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [clamp(r), clamp(g), clamp(b)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function shade(hex, k) {
    const { r, g, b } = hexToRgb(hex);
    return rgbToHex(r * k, g * k, b * k);
  }

  function isCustomColor(hex) {
    return !PALETTES.some(p => p[0].toUpperCase() === String(hex).toUpperCase());
  }

  function syncRgbPanel(hex) {
    const { r, g, b } = hexToRgb(hex);
    $('rgbR').value = r; $('rgbG').value = g; $('rgbB').value = b;
    updateRgbPreview();
  }

  function updateRgbPreview() {
    const r = +$('rgbR').value, g = +$('rgbG').value, b = +$('rgbB').value;
    const hex = rgbToHex(r, g, b);
    $('rgbRv').textContent = r; $('rgbGv').textContent = g; $('rgbBv').textContent = b;
    $('rgbHex').textContent = hex;
    $('rgbPreview').style.background = hex;
    $('rgbR').style.background = 'linear-gradient(90deg,#000,' + rgbToHex(255, g, b) + ')';
    $('rgbG').style.background = 'linear-gradient(90deg,#000,' + rgbToHex(r, 255, b) + ')';
    $('rgbB').style.background = 'linear-gradient(90deg,#000,' + rgbToHex(r, g, 255) + ')';
    return hex;
  }

  function updatePreview() {
    $('previewCard').style.background = grad(form.color);
    $('previewIcon').textContent = form.glyph || '🔑';
    $('previewName').textContent = form.name || '应用名称';
    const acc = form.account ? maskAccount(form.account) : '账号';
    const pw = form.password ? maskPassword(form.password) : '密码';
    $('previewLine').textContent = acc + ' · ' + pw;
    updateStrength(form.password);
  }

  function updateStrength(pw) {
    let score = 0;
    if (!pw) score = 0;
    else {
      if (pw.length >= 8) score++;
      if (pw.length >= 12) score++;
      if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
      if (/\d/.test(pw)) score++;
      if (/[^A-Za-z0-9]/.test(pw)) score++;
    }
    const pct = [0, 22, 42, 62, 82, 100][score] || 0;
    const label = ['—', '很弱', '偏弱', '一般', '较强', '很强'][score] || '—';
    const color = ['#D9DEE8', '#E5484D', '#F5A524', '#F5C518', '#34C759', '#0B9E45'][score] || '#D9DEE8';
    $('strengthFill').style.width = pct + '%';
    $('strengthFill').style.background = color;
    $('strengthText').textContent = '强度：' + label;
  }

  function openEditor(card, template) {
    editingId = card ? card.id : null;
    if (card) {
      form = {
        name: card.name, account: card.account || '', password: card.password || '',
        note: card.note || '', cat: card.cat || '其他', glyph: card.glyph || '🔑',
        color: card.color ? card.color.slice() : PALETTES[1].slice(), favorite: !!card.favorite
      };
    } else if (template) {
      form = {
        name: template.name, account: '', password: '', note: '',
        cat: template.cat || '其他', glyph: template.glyph || '🔑',
        color: template.color ? template.color.slice() : PALETTES[1].slice(), favorite: false
      };
    } else {
      form = { name: '', account: '', password: '', note: '', cat: '其他',
               glyph: '🔑', color: PALETTES[1].slice(), favorite: false };
    }
    $('editorTitle').textContent = card ? '编辑卡片' : (template ? '添加「' + template.name + '」' : '新建卡片');
    $('fName').value = form.name;
    $('fAccount').value = form.account;
    $('fAccount').placeholder = (template && template.hint) ? template.hint : '手机号 / 邮箱 / 用户名';
    $('fPassword').value = form.password;
    $('fNote').value = form.note;
    $('fFav').checked = form.favorite;
    buildEditorOptions();
    syncRgbPanel(form.color[0]);
    $('rgbPanel').classList.add('hidden');
    updatePreview();
    openOverlay('editorOverlay');
    setTimeout(() => { if (!card && !template) $('fName').focus(); }, 320);
  }

  function genPassword() {
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digit = '23456789';
    const sym = '!@#$%^&*-_=+';
    const all = lower + upper + digit + sym;
    const buf = new Uint32Array(16);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    let out = lower[buf[0] % lower.length] + upper[buf[1] % upper.length] +
              digit[buf[2] % digit.length] + sym[buf[3] % sym.length];
    for (let i = 4; i < 16; i++) out += all[buf[i] % all.length];
    return out.split('').sort(() => 0.5 - Math.random()).join('');
  }

  function bindEditor() {
    $('editorCancel').addEventListener('click', () => closeOverlay('editorOverlay'));
    $('fName').addEventListener('input', (e) => { form.name = e.target.value; updatePreview(); });
    $('fAccount').addEventListener('input', (e) => { form.account = e.target.value; updatePreview(); });
    $('fPassword').addEventListener('input', (e) => { form.password = e.target.value; updatePreview(); });
    $('fNote').addEventListener('input', (e) => { form.note = e.target.value; });
    $('fFav').addEventListener('change', (e) => { form.favorite = e.target.checked; });

    /* 自定义 RGB：三通道滑杆 + 实时预览 + 应用 */
    ['rgbR', 'rgbG', 'rgbB'].forEach(id => {
      $(id).addEventListener('input', () => {
        const hex = updateRgbPreview();
        form.color = [hex, shade(hex, 0.72)];
        updatePreview();
      });
    });

    $('rgbApply').addEventListener('click', () => {
      const hex = updateRgbPreview();
      form.color = [hex, shade(hex, 0.72)];
      $('rgbPanel').classList.add('hidden');
      Array.prototype.forEach.call($('swatches').children, x => x.classList.toggle('active', x.dataset.custom === '1'));
      updatePreview();
      haptic('medium');
      toast('已应用自定义颜色 ' + hex);
    });

    $('btnGen').addEventListener('click', () => {
      const pw = genPassword();
      form.password = pw;
      $('fPassword').value = pw;
      updatePreview();
      haptic('medium');
      toast('已生成 16 位强密码');
    });

    $('editorSave').addEventListener('click', async () => {
      form.name = $('fName').value.trim();
      form.account = $('fAccount').value.trim();
      form.password = $('fPassword').value;
      form.note = $('fNote').value.trim();
      if (!form.name) { toast('请填写应用名称'); $('fName').focus(); return; }
      const now = Date.now();
      if (editingId) {
        const card = cardById(editingId);
        if (card) {
          card.name = form.name; card.account = form.account; card.password = form.password;
          card.note = form.note; card.cat = form.cat; card.glyph = form.glyph;
          card.color = form.color.slice(); card.favorite = form.favorite; card.updatedAt = now;
        }
      } else {
        state.cards.push({
          id: uid(), name: form.name, account: form.account, password: form.password,
          note: form.note, cat: form.cat, glyph: form.glyph, color: form.color.slice(),
          favorite: form.favorite, createdAt: now, updatedAt: now
        });
      }
      await persist();
      closeOverlay('editorOverlay');
      renderAll();
      haptic('medium');
      toast(editingId ? '已保存修改' : '卡片已保存');
      editingId = null;
    });
  }

  /* ============================================================
   * 10. 模板库
   * ========================================================== */
  function renderTemplates(keyword) {
    const grid = $('templateGrid');
    const kw = (keyword || '').trim();
    grid.innerHTML = '';
    TEMPLATES.filter(t => !kw || t.name.indexOf(kw) >= 0).forEach(t => {
      const b = document.createElement('button');
      b.className = 'tpl';
      b.innerHTML = '<div class="tpl-icon" style="background:' + grad(t.color) + '">' +
        esc(t.glyph) + '</div><div class="tpl-name">' + esc(t.name) + '</div>';
      b.addEventListener('click', () => {
        closeOverlay('templateOverlay');
        haptic('light');
        setTimeout(() => openEditor(null, t), 220);
      });
      grid.appendChild(b);
    });
    if (!grid.children.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#9AA2B4;font-size:13px;padding:24px 0">没有匹配的模板</div>';
    }
  }

  function bindTemplates() {
    $('templateClose').addEventListener('click', () => closeOverlay('templateOverlay'));
    $('templateSearch').addEventListener('input', (e) => renderTemplates(e.target.value));
  }

  /* ============================================================
   * 11. 我的页交互
   * ========================================================== */
  function bindMePage() {
    $('rowPasscode').addEventListener('click', async () => {
      const has = await passcode.has();
      if (has) {
        await passcode.clear();
        toast('已关闭主密码');
        renderMe();
      } else {
        startPasscodeSetup();
      }
    });

    $('swAutoLock').addEventListener('change', (e) => {
      state.settings.autoLock = e.target.checked;
      persist();
    });

    $('rowExport').addEventListener('click', async () => {
      const payload = JSON.stringify({ app: '密码卡包', version: 1, exportedAt: new Date().toISOString(),
                                       cards: state.cards }, null, 2);
      if (hasBridge) {
        try {
          await nativeCall('share.text', { text: payload, filename: '密码卡包备份.json' });
          toast('已调起分享');
          return;
        } catch (e) {}
      }
      copyText(payload, true);
    });

    $('rowImport').addEventListener('click', async () => {
      let text = '';
      if (hasBridge) {
        try { const r = await nativeCall('clipboard.read'); text = (r && r.text) || ''; } catch (e) {}
      }
      if (!text) { toast('剪贴板里没有可导入的备份'); return; }
      try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : data.cards;
        if (!Array.isArray(list)) throw new Error('bad');
        let added = 0;
        list.forEach(item => {
          if (!item || !item.name) return;
          state.cards.push({
            id: uid(), name: String(item.name), account: String(item.account || ''),
            password: String(item.password || ''), note: String(item.note || ''),
            cat: CATEGORIES.indexOf(item.cat) >= 0 ? item.cat : '其他',
            glyph: item.glyph || '🔑',
            color: Array.isArray(item.color) && item.color.length === 2 ? item.color : PALETTES[1].slice(),
            favorite: !!item.favorite, createdAt: Date.now(), updatedAt: Date.now()
          });
          added++;
        });
        await persist();
        renderAll();
        toast('已导入 ' + added + ' 张卡片');
      } catch (e) {
        toast('备份格式不正确');
      }
    });

    $('rowClear').addEventListener('click', async () => {
      if (!state.cards.length) { toast('还没有卡片可清空'); return; }
      const ok = await confirmDialog({
        title: '清空全部卡片',
        message: '将删除全部 ' + state.cards.length + ' 张卡片，删除后无法恢复。\n建议先用「导出备份」留一份备份。',
        confirmText: '清空',
        danger: true
      });
      if (!ok) { toast('已取消'); return; }
      state.cards = [];
      await persist();
      renderAll();
      haptic('medium');
      toast('已清空全部卡片');
    });

    $('rowHelp').addEventListener('click', () => {
      openHelp();
    });
    bindUpdate();
  }

  /* 使用手册：独立页面（操作手册 + 版本日志），不再复用卡片详情 */
  function openHelp() {
    openOverlay('helpOverlay');
    $('helpOverlay').querySelector('.help-scroll').scrollTop = 0;
  }

  function bindHelp() {
    $('helpClose').addEventListener('click', () => closeOverlay('helpOverlay'));
    $('helpOverlay').addEventListener('click', (e) => {
      if (e.target === $('helpOverlay')) closeOverlay('helpOverlay');
    });
  }

  /* ============================================================
   * 12. 锁屏
   * ========================================================== */
  let lockBuffer = '';
  let lockMode = 'unlock';       // unlock | setup | confirm
  let setupFirstCode = '';

  function buildKeypad() {
    const pad = $('keypad');
    pad.innerHTML = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    keys.forEach(k => {
      const b = document.createElement('button');
      if (k === '') { b.className = 'key blank'; }
      else if (k === '⌫') { b.className = 'key fn'; b.textContent = '⌫'; }
      else { b.className = 'key'; b.textContent = k; }
      b.addEventListener('click', () => onKey(k));
      pad.appendChild(b);
    });
  }

  function renderLockDots() {
    const box = $('lockDots');
    box.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const d = document.createElement('i');
      if (i < lockBuffer.length) d.className = 'on';
      box.appendChild(d);
    }
  }

  function onKey(k) {
    if (k === '⌫') {
      lockBuffer = lockBuffer.slice(0, -1);
      renderLockDots();
      return;
    }
    if (lockBuffer.length >= 6) return;
    lockBuffer += k;
    renderLockDots();
    haptic('light');
    if (lockBuffer.length === 6) setTimeout(handleLockComplete, 120);
  }

  function shakeLock() {
    const body = el('.lock-body');
    body.classList.remove('lock-shake');
    void body.offsetWidth;
    body.classList.add('lock-shake');
  }

  async function handleLockComplete() {
    const code = lockBuffer;
    lockBuffer = '';
    renderLockDots();

    if (lockMode === 'unlock') {
      const ok = await passcode.verify(code);
      if (ok) {
        locked = false;
        $('lockScreen').classList.add('hidden');
        haptic('medium');
      } else {
        shakeLock();
        haptic('heavy');
        $('lockSub').textContent = '密码不正确，请重试';
      }
      return;
    }

    if (lockMode === 'setup') {
      setupFirstCode = code;
      lockMode = 'confirm';
      $('lockSub').textContent = '再次输入以确认';
      return;
    }

    if (lockMode === 'confirm') {
      if (code === setupFirstCode) {
        await passcode.set(code);
        locked = false;
        $('lockScreen').classList.add('hidden');
        renderMe();
        toast('主密码已开启');
        haptic('medium');
      } else {
        shakeLock();
        haptic('heavy');
        $('lockSub').textContent = '两次输入不一致，请重新设置';
        lockMode = 'setup';
        setupFirstCode = '';
      }
    }
  }

  function startPasscodeSetup() {
    lockMode = 'setup';
    setupFirstCode = '';
    lockBuffer = '';
    $('lockSub').textContent = '设置 6 位数字主密码';
    renderLockDots();
    $('lockScreen').classList.remove('hidden');
  }

  function showLockScreen() {
    lockMode = 'unlock';
    lockBuffer = '';
    $('lockSub').textContent = '输入主密码解锁';
    renderLockDots();
    $('lockScreen').classList.remove('hidden');
  }

  function bindLock() {
    $('lockForgot').addEventListener('click', () => {
      if (lockMode !== 'unlock') {
        $('lockScreen').classList.add('hidden');
        lockMode = 'unlock';
        return;
      }
      $('lockSub').textContent = '主密码仅用于本机解锁，遗忘后可在「我的」中重设';
    });
  }

  /* ============================================================
   * 13. 标签栏与初始化
   * ========================================================== */
  const PAGES = { home: 'pageHome', category: 'pageCategory', fav: 'pageFav', me: 'pageMe' };

  function switchTab(tab) {
    currentTab = tab;
    Object.keys(PAGES).forEach(k => $(PAGES[k]).classList.toggle('hidden', k !== tab));
    Array.prototype.forEach.call($('tabbar').children, b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'home') requestAnimationFrame(layoutWheel);
    if (tab === 'category') renderCategory();
    if (tab === 'fav') renderFav();
    if (tab === 'me') renderMe();
    haptic('light');
  }

  function bindChrome() {
    Array.prototype.forEach.call($('tabbar').children, b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    $('btnAdd').addEventListener('click', () => openEditor(null));
    $('emptyAdd').addEventListener('click', () => openEditor(null));
    $('btnTemplates').addEventListener('click', () => {
      renderTemplates('');
      $('templateSearch').value = '';
      openOverlay('templateOverlay');
    });

    $('btnMode').addEventListener('click', () => {
      const next = (state.settings.mode === 'wheel') ? 'list' : 'wheel';
      setMode(next);
      toast(next === 'wheel' ? '已切换到轮盘模式' : '已切换到列表模式');
    });

    $('bannerClose').addEventListener('click', () => {
      state.settings.hideBanner = true;
      $('banner').classList.add('hidden');
      persist();
    });

    bindWheelGestures();

    /* 首页搜索 */
    let searchTimer = null;
    const applySearch = (value) => {
      searchQuery = String(value || '').trim();
      $('homeSearchClear').classList.toggle('hidden', !searchQuery);
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        renderHome();
        if (searchQuery && state.settings.mode === 'wheel') {
          const first = $('wheelTrack').firstElementChild;
          if (first) first.scrollIntoView({ block: 'center' });
        }
      }, 110);
    };

    $('homeSearch').addEventListener('input', (e) => applySearch(e.target.value));
    $('homeSearchClear').addEventListener('click', () => {
      $('homeSearch').value = '';
      applySearch('');
      $('homeSearch').blur();
      haptic('light');
    });

    window.addEventListener('resize', () => requestAnimationFrame(layoutWheel));
  }

  onAppEvent = function (name) {
    if (name === 'background') {
      if (state.settings.autoLock !== false) {
        passcode.has().then(has => { if (has) locked = true; });
      }
    } else if (name === 'foreground') {
      if (locked) showLockScreen();
    }
  };

  let booted = false;
  async function boot() {
    if (booted) return;
    booted = true;
    buildKeypad();
    bindChrome();
    bindDetail();
    bindEditor();
    bindTemplates();
    bindMePage();
    bindHelp();
    bindConfirm();
    bindLock();

    const saved = await store.load();
    if (saved && Array.isArray(saved.cards)) {
      state = {
        version: 1,
        cards: saved.cards,
        settings: Object.assign({ mode: 'wheel', hideBanner: false, autoLock: true }, saved.settings || {})
      };
    } else {
      state.cards = demoCards();
      state.settings = { mode: 'wheel', hideBanner: false, autoLock: true };
      await persist();
    }

    renderAll();
    switchTab('home');

    if (hasBridge) {
      try {
        const info = await nativeCall('app.info');
        if (info && info.version) $('appVersion').textContent = 'V' + info.version;
      } catch (e) {}
    }

    if (await passcode.has()) {
      showLockScreen();
    }

    applyPreviewHook();

    // 静默检查新版本（6 小时内不重复请求；未配置更新源则直接跳过）
    if (updateFeedMode()) checkRemoteVersion(false);
  }

  /* 本地预览/截图调试钩子：仅在带 ?preview= 参数时生效，正常运行不受影响 */
  function applyPreviewHook() {
    const q = new URLSearchParams(location.search);
    const p = q.get('preview');
    if (!p) return;
    const first = sortedCards()[0];
    if (p === 'list') setMode('list', true);
    else if (p === 'detail' && first) openDetail(first.id);
    else if (p === 'editor') openEditor(first || null);
    else if (p === 'templates') { renderTemplates(''); openOverlay('templateOverlay'); }
    else if (p === 'me') switchTab('me');
    else if (p === 'category') switchTab('category');
    else if (p === 'fav') switchTab('fav');
    else if (p === 'lock') { showLockScreen(); }
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState === 'interactive' || document.readyState === 'complete') boot();
})();

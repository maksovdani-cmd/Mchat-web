// ============================================================
// ГЛОБАЛЬНЫЕ ДАННЫЕ - ПОЛЬЗОВАТЕЛЬСКИЕ ДАННЫЕ РАЗДЕЛЕНЫ
// ============================================================
let currentUser = null;
let posts = [];
let chats = [];
let messages = {};
let currentChatId = null;
let currentChatPeer = null;   // { id, username } собеседника в открытом личном чате
let currentChatPinned = null; // закреплённое сообщение открытого чата (MessageDTO | null)
let currentChatMeta = null;   // canPost/canModerate/type открытого чата
let upFriendState = { status: 'none', id: null }; // состояние дружбы в открытом чужом профиле
let replyToMsg = null;        // сообщение, на которое отвечаем (объект из messages[])
let currentLanguage = 'ru';
let myStories = [];

// Экранирование ВСЕГО, что пришло с сервера/от других пользователей, перед вставкой в innerHTML
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const VERIFIED_BADGE_HTML = ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

// Ключи для локального хранилища с привязкой к пользователю (только настройки интерфейса)
function getUserKey(baseKey) {
  return currentUser ? `${baseKey}_${currentUser.username}` : baseKey;
}

// ============================================================
// ДАННЫЕ: профиль, посты, видео, истории, репосты живут на сервере (REST /api/...).
// В браузере остаётся только минимум для быстрого старта (кто вошёл) и настройки интерфейса.
// ============================================================
const userCache = {};   // username -> { name, avatar, verified, bio, banner } — из ответов сервера
let postsByUser = {};   // username -> посты этого пользователя
let repostsByUser = {}; // username -> его репосты

function cacheUser(username, data) {
  if (!username) return;
  userCache[username] = Object.assign(userCache[username] || {}, data);
}

function saveUser() {
  if (!currentUser) return;
  try { localStorage.setItem('mchat_user', JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role })); } catch (e) {}
  if (currentUser.nameChangedAt) { try { localStorage.setItem('mchat_name_changed_' + currentUser.username, String(currentUser.nameChangedAt)); } catch (e) {} }
  cacheUser(currentUser.username, { name: currentUser.name, avatar: currentUser.avatar, verified: currentUser.verified, bio: currentUser.bio, banner: currentUser.banner });
}

function savePosts() { /* посты хранятся на сервере */ }
function saveChats() { /* чаты хранятся на сервере */ }
function saveMessages() { /* сообщения хранятся на сервере */ }
function saveStories() { /* истории хранятся на сервере */ }

function loadUserData(username) {
  const c = userCache[username] || {};
  let changedAt = 0;
  try { changedAt = Number(localStorage.getItem('mchat_name_changed_' + username)) || 0; } catch (e) {}
  return {
    avatar: c.avatar || null,
    name: c.name || username,
    bio: c.bio != null ? c.bio : '',
    nameChangedAt: changedAt,
    verified: !!c.verified,
    banner: c.banner || null,
    username: username,
    followers: 0,
    following: 0
  };
}

function loadUserPosts(username) { return postsByUser[username] || []; }

function commentFromServer(c) { return Object.assign({}, c, { time: fmtClock(c.createdAt) }); }

/** data:/blob: адрес → Blob. data: разбираем вручную (не зависит от CSP), blob: читаем через fetch. */
async function mxUrlToBlob(url) {
  if (url.startsWith('data:')) {
    const i = url.indexOf(',');
    const meta = url.slice(5, i);
    const mime = meta.split(';')[0] || 'application/octet-stream';
    const data = url.slice(i + 1);
    const bin = /;base64$/.test(meta) ? atob(data) : decodeURIComponent(data);
    const u8 = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    return new Blob([u8], { type: mime });
  }
  return (await fetch(url)).blob();
}

function postFromServer(p) {
  cacheUser(p.username, { name: p.name, avatar: p.avatar, verified: p.verified });
  return Object.assign({}, p, {
    time: fmtClock(p.createdAt),
    comments: (p.comments || []).map(commentFromServer),
    repostedBy: p.repostedBy || []
  });
}

function storyFromServer(st) {
  const b = (st.textBlocks && st.textBlocks[0]) || null;
  return Object.assign({}, st, {
    text: b ? b.text : '', textColor: b ? b.color : undefined, textFont: b ? b.font : undefined,
    textLeft: b ? b.left : undefined, textTop: b ? b.top : undefined,
    time: fmtClock(new Date(st.publishedAt).toISOString()),
    comments: (st.comments || []).map(commentFromServer)
  });
}

/** Лента: мои посты (включая архив) + публичные посты остальных — с сервера. */
async function refreshPosts() {
  if (!currentUser) return;
  try {
    const r = await MchatAPI.listPosts();
    posts = r.posts.map(postFromServer);
    postsByUser[currentUser.username] = posts.filter(p => p.username === currentUser.username);
  } catch (e) { /* остаёмся с тем, что есть */ }
  renderFeed(); updateProfileUI();
}

async function refreshMyStories() {
  if (!currentUser) return;
  try { myStories = (await MchatAPI.listStories(currentUser.username)).stories.map(storyFromServer); } catch (e) {}
  renderStories(); updateProfileUI();
}

async function fetchUserPosts(username) {
  const r = await MchatAPI.listPosts(username);
  postsByUser[username] = r.posts.map(postFromServer);
  return postsByUser[username];
}

async function fetchUserReposts(username) {
  const r = await MchatAPI.listReposts(username);
  repostsByUser[username] = r.posts.map(postFromServer);
  return repostsByUser[username];
}

/** Лайк/снятие лайка на сервере (интерфейс уже обновлён оптимистично). */
function mxSendLike(p) {
  MchatAPI.likePost(p.id, p.liked).then(r => { p.likes = r.likes; p.liked = r.liked; }).catch(e => {
    p.liked = !p.liked; p.likes = Math.max(0, (p.likes || 0) + (p.liked ? 1 : -1));
    showToast(MchatAPI.errorText(e)); renderFeed();
  });
}

// ============================================================
// ПРОСМОТР ЧУЖОГО ПРОФИЛЯ (посты и репосты другого пользователя)
// ============================================================
let upViewedUsername = null;
let upCurrentTab = 'posts';

function goToUserOrOwnProfile(username) {
  if (currentUser && username === currentUser.username) { goTo('s-profile'); return; }
  openUserProfile(username);
}

function openUserProfile(username) {
  if (!username) return;
  if (currentUser && username === currentUser.username) { goTo('s-profile'); return; }
  upViewedUsername = username;
  upCurrentTab = 'posts';
  const data = loadUserData(username);
  document.getElementById('up-header-username').textContent = '@' + username;
  document.getElementById('up-name').innerHTML = (data.name || username) + (data.verified ? ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '');
  document.getElementById('up-username').textContent = '@' + username;
  document.getElementById('up-bio').textContent = data.bio || '';
  document.getElementById('up-avatar').innerHTML = data.avatar
    ? `<img src="${data.avatar}" style="width:100%;height:100%;object-fit:cover">`
    : `<svg width="34" height="34" fill="none" stroke="var(--text2)" stroke-width="1.2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  postsByUser[username] = []; repostsByUser[username] = [];
  document.getElementById('up-posts-count').textContent = '0';
  document.getElementById('up-reposts-count').textContent = '0';
  document.getElementById('uptab-posts').click ? null : null;
  upFriendState = { status: 'none', id: null };
  mxRenderFriendButton();
  const statusEl = document.getElementById('up-status');
  if (statusEl) statusEl.textContent = '';
  switchUserProfileTab('posts');
  document.getElementById('user-profile-viewer').classList.add('active');
  // посты и репосты этого пользователя — с сервера
  Promise.all([fetchUserPosts(username), fetchUserReposts(username)]).then(() => {
    if (upViewedUsername !== username) return;
    document.getElementById('up-posts-count').textContent = postsByUser[username].filter(p => p.privacy !== 'private').length;
    document.getElementById('up-reposts-count').textContent = repostsByUser[username].length;
    renderUserProfileGrid();
  }).catch(e => { if (upViewedUsername === username) showToast(MchatAPI.errorText(e)); });
  // имя, био, аватар, галочка, статус и дружба — с сервера (локально чужих данных нет)
  MchatAPI.getUser(username).then(u => {
    if (upViewedUsername !== username) return;
    document.getElementById('up-name').innerHTML = esc(u.name || u.username) + (u.verified ? VERIFIED_BADGE_HTML : '');
    document.getElementById('up-bio').textContent = u.bio || '';
    cacheUser(username, { name: u.name, avatar: u.avatar, verified: u.verified, bio: u.bio, banner: u.banner });
    if (u.avatar) document.getElementById('up-avatar').innerHTML = `<img src="${esc(u.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">`;
    upFriendState = u.friendship || { status: 'none', id: null };
    mxRenderFriendButton();
    mxSetPresenceText('up-status', u.online, u.lastSeenAt);
  }).catch(() => {});
}

function closeUserProfile() {
  document.getElementById('user-profile-viewer').classList.remove('active');
  upViewedUsername = null;
}

function switchUserProfileTab(tab) {
  upCurrentTab = tab;
  document.getElementById('uptab-posts').classList.toggle('active', tab==='posts');
  document.getElementById('uptab-posts').style.color = tab==='posts' ? 'var(--text)' : 'var(--text2)';
  document.getElementById('uptab-posts').style.borderBottomColor = tab==='posts' ? 'var(--accent)' : 'transparent';
  document.getElementById('uptab-reposts').classList.toggle('active', tab==='reposts');
  document.getElementById('uptab-reposts').style.color = tab==='reposts' ? 'var(--text)' : 'var(--text2)';
  document.getElementById('uptab-reposts').style.borderBottomColor = tab==='reposts' ? 'var(--accent)' : 'transparent';
  renderUserProfileGrid();
}

function renderUserProfileGrid() {
  const grid = document.getElementById('up-grid');
  if (!grid || !upViewedUsername) return;
  let html = '';
  if (upCurrentTab === 'posts') {
    const userPosts = loadUserPosts(upViewedUsername).filter(p => p.privacy !== 'private' && !p.isRepost);
    if (userPosts.length === 0) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px 16px;color:var(--text2);font-size:13px">Пока нет постов</div>'; return; }
    userPosts.forEach(p => { html += foreignGridItemHtml(p, upViewedUsername); });
  } else {
    const userReposts = repostsByUser[upViewedUsername] || [];
    if (userReposts.length === 0) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px 16px;color:var(--text2);font-size:13px">Пока нет репостов</div>'; return; }
    userReposts.forEach(p => { html += foreignGridItemHtml(p, upViewedUsername); });
  }
  grid.innerHTML = html;
}

function foreignGridItemHtml(p, ownerUsername) {
  const onclick = `onclick='openForeignPostByRef(${JSON.stringify({id:p.id, username:p.username||ownerUsername}).replace(/'/g,"&#39;")})'`;
  if (p.mediaType === 'image' && p.mediaUrl) {
    return `<div class="grid-item" ${onclick}><img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover"></div>`;
  } else if (p.mediaType === 'video' && p.mediaUrl) {
    const thumb = p.thumbnail || '';
    return `<div class="grid-item" ${onclick} style="position:relative;background:var(--surf2)">${thumb?`<img src="${thumb}" style="width:100%;height:100%;object-fit:cover">`:''}<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div>`;
  }
  return `<div class="grid-item" ${onclick} style="background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px"><svg width="20" height="20" fill="none" stroke="var(--text2)" stroke-width="1.4" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div style="font-size:9px;color:var(--text2);text-align:center;padding:0 4px;overflow:hidden;max-height:24px">${p.text?p.text.slice(0,20):''}</div></div>`;
}

async function openForeignPostByRef(ref) {
  let p = (postsByUser[ref.username] || []).find(x => x.id === ref.id) || posts.find(x => x.id === ref.id);
  if (!p) for (const list of Object.values(repostsByUser)) { p = list.find(x => x.id === ref.id); if (p) break; }
  if (!p) {
    try { p = postFromServer((await MchatAPI.getPost(ref.id)).post); }
    catch (e) { showToast(MchatAPI.errorText(e)); return; }
  }
  openForeignPostViewer(p, ref.username);
}

function openForeignPostViewer(p, ownerUsername) {
  const authorData = loadUserData(p.username || ownerUsername);
  document.getElementById('fpv-av').innerHTML = authorData.avatar
    ? `<img src="${authorData.avatar}" style="width:100%;height:100%;object-fit:cover">`
    : `<svg width="18" height="18" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  document.getElementById('fpv-name').innerHTML = esc(p.name || authorData.name) + (authorData.verified ? ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '');
  document.getElementById('fpv-time').textContent = p.time || '';
  document.getElementById('fpv-caption').textContent = p.text || '';
  document.getElementById('fpv-like-count').textContent = p.likes || 0;
  document.getElementById('fpv-cmt-count').textContent = Array.isArray(p.comments) ? p.comments.length : (p.comments||0);
  const imgWrap = document.getElementById('fpv-img-wrap'), vidWrap = document.getElementById('fpv-vid-wrap');
  if (p.mediaType === 'image' && p.mediaUrl) {
    imgWrap.style.display = 'block'; vidWrap.style.display = 'none';
    document.getElementById('fpv-img').src = p.mediaUrl;
  } else if (p.mediaType === 'video' && p.mediaUrl) {
    imgWrap.style.display = 'none'; vidWrap.style.display = 'block';
    document.getElementById('fpv-vid').src = p.mediaUrl;
  } else {
    imgWrap.style.display = 'none'; vidWrap.style.display = 'none';
  }
  document.getElementById('foreign-post-viewer').classList.add('active');
}

function closeForeignPostViewer() {
  document.getElementById('foreign-post-viewer').classList.remove('active');
  const vid = document.getElementById('fpv-vid');
  if (vid) { vid.pause(); vid.src=''; }
}

// ============================================================
// ФУНКЦИИ ПОИСКА И УВЕДОМЛЕНИЙ
// ============================================================
function openSearch() {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '800';
  m.onclick = e => { if(e.target===m) m.remove(); };
  m.innerHTML = `<div style="background:var(--bg);border-radius:28px;width:340px;max-width:92vw;padding:20px;display:flex;flex-direction:column;gap:12px">
    <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:4px">Поиск</div>
    <div style="display:flex;align-items:center;background:var(--surf);border-radius:14px;padding:10px 14px;gap:8px">
      <svg width="16" height="16" fill="none" stroke="var(--text2)" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input id="search-input" placeholder="Поиск постов и пользователей..." style="background:none;border:none;outline:none;color:var(--text);font-family:var(--font);font-size:14px;flex:1" oninput="runSearch()" autofocus>
    </div>
    <div id="search-results" style="display:flex;flex-direction:column;gap:8px;max-height:300px;overflow-y:auto"></div>
    <button onclick="this.closest('.modal').remove()" style="padding:12px;border-radius:14px;border:none;background:var(--surf);color:var(--text2);font-family:var(--font);font-size:14px;cursor:pointer">Закрыть</button>
  </div>`;
  document.getElementById('app').appendChild(m);
  setTimeout(()=>{ const inp=document.getElementById('search-input'); if(inp) inp.focus(); },100);
}

let _searchSeq = 0;
async function runSearch() {
  const q = (document.getElementById('search-input')?.value||'').toLowerCase().trim();
  const res = document.getElementById('search-results');
  if (!res) return;
  if (!q) { res.innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:8px">Начни вводить запрос</div>'; return; }
  
  // пользователи ищутся на сервере (учитываются все зарегистрированные)
  const seq = ++_searchSeq;
  let matchedUsers = [];
  try { matchedUsers = (await MchatAPI.searchUsers(q)).users.map(u => ({ name: u.name, username: u.username, avatar: u.avatar })); } catch (e) {}
  if (seq !== _searchSeq) return; // пришёл более свежий запрос
  let matchedPosts = [];
  try { matchedPosts = (await MchatAPI.searchPosts(q)).posts.map(postFromServer); } catch (e) {}
  if (seq !== _searchSeq) return;
  
  let html = '';
  if (matchedUsers.length > 0) {
    html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:4px 2px">Пользователи</div>`;
    html += matchedUsers.slice(0,5).map(u=>`
      <div onclick="this.closest('.modal').remove();goToUserOrOwnProfile('${esc(u.username)}')" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surf);border-radius:12px;cursor:pointer">
        <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent),#7c3aed);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${u.avatar?`<img src="${esc(u.avatar)}" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">`:`<span style="color:#fff;font-weight:700;font-size:14px">${(u.username||'?').charAt(0).toUpperCase()}</span>`}</div>
        <div><div style="font-size:13px;font-weight:600">${esc(u.name||u.username)}</div><div style="font-size:11px;color:var(--text2)">@${esc(u.username)}</div></div>
      </div>`).join('');
  }
  if (matchedPosts.length > 0) {
    html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:4px 2px;margin-top:4px">Посты</div>`;
    html += matchedPosts.slice(0,5).map(p=>`
      <div onclick="this.closest('.modal').remove();${p.username===currentUser?.username?`openPostViewer(${p.id})`:`openForeignPostByRef({id:${p.id},username:'${p.username}'})`}" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surf);border-radius:12px;cursor:pointer">
        <div style="width:42px;height:42px;border-radius:10px;background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${p.thumbnail?`<img src="${p.thumbnail}" style="width:100%;height:100%;object-fit:cover">`:p.mediaType==='image'&&p.mediaUrl?`<img src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover">`:`<svg width="16" height="16" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`}</div>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${esc(p.name)}</div><div style="font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.text||'Без описания')}</div></div>
      </div>`).join('');
  }
  if (!html) html = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:8px">Ничего не найдено</div>';
  res.innerHTML = html;
}

function openNotifications() {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '800';
  m.onclick = e => { if(e.target===m) m.remove(); };
  const notifs = JSON.parse(localStorage.getItem('mchat_notifs')||'[]');
  const html = notifs.length === 0
    ? '<div style="color:var(--text2);font-size:13px;text-align:center;padding:20px">Уведомлений пока нет</div>'
    : notifs.slice(-20).reverse().map(n=>`<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surf);border-radius:12px"><div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></div><div style="font-size:13px;flex:1">${n.text}</div><div style="font-size:10px;color:var(--text2)">${n.time}</div></div>`).join('');
  m.innerHTML = `<div style="background:var(--bg);border-radius:28px;width:340px;max-width:92vw;padding:20px;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;justify-content:space-between"><div style="font-family:var(--font);font-size:17px;font-weight:800">Уведомления</div>${notifs.length>0?`<button onclick="localStorage.removeItem('mchat_notifs');this.closest('.modal').remove();showToast('Очищено')" style="background:none;border:none;color:var(--text2);font-size:12px;cursor:pointer">Очистить</button>`:''}</div>
    <div style="display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto">${html}</div>
    <button onclick="this.closest('.modal').remove()" style="padding:12px;border-radius:14px;border:none;background:var(--surf);color:var(--text2);font-family:var(--font);font-size:14px;cursor:pointer">Закрыть</button>
  </div>`;
  document.getElementById('app').appendChild(m);
}

function pushNotif(text) {
  const notifs = JSON.parse(localStorage.getItem('mchat_notifs')||'[]');
  notifs.push({text, time: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});
  if (notifs.length > 50) notifs.splice(0, notifs.length-50);
  localStorage.setItem('mchat_notifs', JSON.stringify(notifs));
}

function openPrivacySettings() {
  const saved = JSON.parse(localStorage.getItem('mchat_privacy')||'{"privateAccount":false,"hideOnline":false,"hideRead":false,"hidePosts":false}');
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '800';
  m.onclick = e => { if(e.target===m) m.remove(); };
  const tog = (key, label, val) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--surf);border-radius:12px">
    <div style="font-size:14px">${label}</div>
    <button class="tgl ${val?'on':''}" id="priv-${key}" onclick="togglePrivacy('${key}',this)"></button>
  </div>`;
  m.innerHTML = `<div style="background:var(--bg);border-radius:28px;width:340px;max-width:92vw;padding:20px;display:flex;flex-direction:column;gap:10px">
    <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:4px">Конфиденциальность</div>
    ${tog('privateAccount','Закрытый аккаунт',saved.privateAccount)}
    ${tog('hideOnline','Скрыть статус «онлайн»',saved.hideOnline)}
    ${tog('hideRead','Скрыть прочитанность',saved.hideRead)}
    ${tog('hidePosts','Скрыть посты от чужих',saved.hidePosts)}
    <button onclick="this.closest('.modal').remove();showToast('Настройки сохранены')" style="padding:13px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:15px;font-weight:700;cursor:pointer;margin-top:4px">Сохранить</button>
  </div>`;
  document.getElementById('app').appendChild(m);
}

function togglePrivacy(key, btn) {
  btn.classList.toggle('on');
  const saved = JSON.parse(localStorage.getItem('mchat_privacy')||'{}');
  saved[key] = btn.classList.contains('on');
  localStorage.setItem('mchat_privacy', JSON.stringify(saved));
  // hideOnline / hideRead применяются на сервере
  if (key === 'hideOnline' || key === 'hideRead') {
    MchatAPI.updateMe({ [key]: saved[key] }).catch(e => showToast(MchatAPI.errorText(e)));
  }
}

function openNotificationSettings() {
  const saved = JSON.parse(localStorage.getItem('mchat_notif_settings')||'{"messages":true,"likes":true,"comments":true,"stories":false}');
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '800';
  m.onclick = e => { if(e.target===m) m.remove(); };
  const tog = (key, label, val) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:var(--surf);border-radius:12px">
    <div style="font-size:14px">${label}</div>
    <button class="tgl ${val?'on':''}" id="ns-${key}" onclick="toggleNotifSetting('${key}',this)"></button>
  </div>`;
  m.innerHTML = `<div style="background:var(--bg);border-radius:28px;width:340px;max-width:92vw;padding:20px;display:flex;flex-direction:column;gap:10px">
    <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:4px">Уведомления</div>
    ${tog('messages','Сообщения',saved.messages)}
    ${tog('likes','Лайки',saved.likes)}
    ${tog('comments','Комментарии',saved.comments)}
    ${tog('stories','Истории',saved.stories)}
    <button onclick="this.closest('.modal').remove();showToast('Настройки сохранены')" style="padding:13px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:15px;font-weight:700;cursor:pointer;margin-top:4px">Сохранить</button>
  </div>`;
  document.getElementById('app').appendChild(m);
}

function toggleNotifSetting(key, btn) {
  btn.classList.toggle('on');
  const saved = JSON.parse(localStorage.getItem('mchat_notif_settings')||'{}');
  saved[key] = btn.classList.contains('on');
  localStorage.setItem('mchat_notif_settings', JSON.stringify(saved));
  if (key === 'messages') {
    MchatAPI.updateMe({ notifyMessages: saved[key] }).catch(e => showToast(MchatAPI.errorText(e)));
    if (saved[key]) {
      // включили — просим разрешение и подписываем устройство на Web Push (это действие пользователя)
      MchatAPI.enablePush().then(() => showToast('Push-уведомления включены'))
        .catch(e => showToast(MchatAPI.errorText(e)));
    }
  }
}

function captureGridThumb(videoEl, postId) {
  try {
    videoEl.currentTime = 0.5;
    videoEl.addEventListener('seeked', function onSeeked() {
      videoEl.removeEventListener('seeked', onSeeked);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth || 200;
        canvas.height = videoEl.videoHeight || 200;
        canvas.getContext('2d').drawImage(videoEl, 0, 0);
        const thumb = canvas.toDataURL('image/jpeg', 0.8);
        const p = posts.find(x=>x.id===postId);
        if (p && !p.thumbnail) {
          p.thumbnail = thumb;
          savePosts();
          const container = document.getElementById('grid-vid-'+postId);
          if (container) {
            const icon = container.querySelector('div');
            const img = document.createElement('img');
            img.src = thumb;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0';
            container.insertBefore(img, container.firstChild);
            const vid = container.querySelector('video');
            if (vid) vid.remove();
          }
        }
      } catch(e) {}
    }, {once:true});
  } catch(e) {}
}

function setIslandTheme(theme, element) {
  document.querySelectorAll('.island-theme-item').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  const navs = document.querySelectorAll('.island-nav');
  navs.forEach(nav => {
    nav.classList.remove('default', 'frost', 'liquid');
    nav.classList.add(theme);
  });
  localStorage.setItem('mchat_island_theme', theme);
}

// ============================================================
// INIT
// ============================================================
function init() {
  const sl = localStorage.getItem('mchat_lang');
  const si = localStorage.getItem('mchat_island_theme');
  if (sl) currentLanguage = sl;

  if (si) {
    const navs = document.querySelectorAll('.island-nav');
    navs.forEach(nav => { nav.classList.remove('default', 'frost', 'liquid'); nav.classList.add(si); });
    document.querySelectorAll('.island-theme-item').forEach(el => {
      el.classList.remove('active');
      if (el.querySelector('span').textContent.includes({'default':'Обычный','frost':'Матовое','liquid':'Liquid Glass'}[si])) el.classList.add('active');
    });
  }

  bindRealtimeHandlers();
  bindTypingInput();
  bootSession();
}

// ============================================================
// СЕССИЯ / ВХОД (бэкенд: Google OAuth + JWT в httpOnly cookie)
// ============================================================
async function bootSession() {
  const params = new URLSearchParams(location.search);
  const authErr = params.get('auth_error');
  const wantsCode = params.get('auth') === 'code';
  const openChatId = params.get('chat');
  if (authErr || wantsCode || openChatId) history.replaceState(null, '', '/'); // чистим адресную строку

  // Возврат из Google на НОВОМ устройстве → нужен код
  if (wantsCode) { showCodeScreen(); return; }

  // Быстрый старт из кэша, пока сервер проверяет сессию (без «мигания» экрана входа)
  const cached = localStorage.getItem('mchat_user');
  if (cached && !authErr) {
    try {
      const su = JSON.parse(cached);
      currentUser = { id: su.id, username: su.username, name: su.username, bio: '', avatar: null,
        nameChangedAt: loadUserData(su.username).nameChangedAt, verified: false, role: su.role, banner: null, followers: 0, following: 0 };
      posts = []; myStories = [];
      updateProfileUI(); renderFeed(); goTo('s-feed');
    } catch (e) { currentUser = null; }
  }

  try {
    const me = await MchatAPI.me();
    await onLoggedIn(me);
    if (openChatId) openChatById(openChatId);
  } catch (e) {
    if (e && e.status === 401) {
      resetSessionState();
      goTo('s-login');
      if (authErr) document.getElementById('auth-err').textContent = MchatAPI.errorText(authErr);
    } else if (!currentUser) {
      goTo('s-login');
      showToast('Нет связи с сервером');
    }
  }
}

async function onLoggedIn(me) {
  currentUser = {
    id: me.id,
    username: me.username,
    name: me.name || me.username,
    bio: me.bio != null ? me.bio : '',
    avatar: me.avatar || null, // загруженный аватар или фото из Google — оба приходят с сервера
    nameChangedAt: loadUserData(me.username).nameChangedAt,
    verified: !!me.verified,
    role: me.role,
    banner: me.banner || null,
    followers: 0,
    following: 0
  };
  saveUser();
  updateProfileUI(); renderFeed();
  refreshPosts(); refreshMyStories(); // посты, видео и истории — с сервера
  MchatAPI.connect();
  await refreshChats();
  MchatAPI.syncPush();
  const active = document.querySelector('.screen.active');
  if (!active || active.id === 's-login' || active.id === 's-code') goTo('s-feed');
}

function resetSessionState() {
  MchatAPI.disconnect();
  currentUser = null;
  localStorage.removeItem('mchat_user');
  posts = []; chats = []; messages = {}; myStories = []; currentChatId = null;
}

function bindRealtimeHandlers() {
  const h = MchatAPI.handlers;
  h.onMessage = onIncomingMessage;
  h.onRead = (p) => {
    if (!currentUser || p.userId !== currentUser.id) return; // нас интересует чтение с другого нашего устройства
    const ch = chats.find(c => c.id === p.chatId);
    if (ch && ch.unread) { ch.unread = 0; renderChats(); }
  };
  h.onTyping = (p) => {
    if (!currentUser || p.userId === currentUser.id || p.chatId !== currentChatId) return;
    const el = document.getElementById('chat-status');
    if (!el) return;
    clearTimeout(window._typingClear);
    if (p.isTyping) {
      el.textContent = 'печатает…'; el.style.color = 'var(--accent2)';
      window._typingClear = setTimeout(() => { const c = chats.find(x => x.id === currentChatId); if (c) updateChatStatus(c); }, 4000);
    } else { const c = chats.find(x => x.id === currentChatId); if (c) updateChatStatus(c); }
  };
  h.onPresence = (p) => {
    chats.forEach(c => { if (c.peer && c.peer.id === p.userId) { c.peer.online = p.online; c.peer.lastSeenAt = p.at; } });
    const cur = chats.find(c => c.id === currentChatId);
    if (cur && cur.peer && cur.peer.id === p.userId) updateChatStatus(cur);
    if (document.getElementById('user-profile-viewer').classList.contains('active') && currentChatPeer && currentChatPeer.id === p.userId) {
      // на всякий случай ничего — presence в открытом чужом профиле обновится при следующем заходе
    }
  };
  h.onEdited = (m) => {
    const list = messages[m.chatId]; if (!list) return;
    const idx = list.findIndex(x => x.id === m.id);
    if (idx >= 0) { list[idx] = msgFromServer(m); if (currentChatId === m.chatId) renderMessages(m.chatId); }
    const ch = chats.find(c => c.id === m.chatId);
    if (ch) { ch.lastMessage = msgPreview(m); renderChats(); }
  };
  h.onDeleted = (p) => {
    const list = messages[p.chatId]; if (!list) return;
    messages[p.chatId] = list.filter(x => x.id !== p.id);
    if (currentChatId === p.chatId) renderMessages(p.chatId);
  };
  h.onReactions = (p) => {
    const list = messages[p.chatId]; if (!list) return;
    const msg = list.find(x => x.id === p.id);
    if (msg) { msg.reactions = p.reactions || []; if (currentChatId === p.chatId) renderMessages(p.chatId); }
  };
  h.onPinned = (p) => {
    if (currentChatId === p.chatId) renderPinnedBar(p.message || null);
    const ch = chats.find(c => c.id === p.chatId);
    if (ch) ch.pinned = p.message || null;
  };
  h.onFriendUpdate = (p) => {
    if (upViewedUsername && p.user && p.user.username === upViewedUsername) {
      upFriendState = { status: p.status, id: p.id };
      mxRenderFriendButton();
    }
    if (p.status === 'incoming') showToast((p.user && p.user.name ? p.user.name : 'Пользователь') + ' хочет добавить вас в друзья');
    if (p.status === 'friends') showToast((p.user && p.user.name ? p.user.name : 'Пользователь') + ' принял(а) заявку в друзья');
  };
  h.onLoginCode = showLoginCodeModal;
  h.onNewDevice = (d) => showToast('Новый вход в аккаунт: ' + (d && d.label ? d.label : 'устройство'));
  h.onUnauthorized = () => { resetSessionState(); goTo('s-login'); showToast('Сессия завершена. Войди снова'); };
  h.onChatChanged = () => { refreshChats().then(mxApplyChatBackground); };
  h.onCallIncoming = mxOnCallIncoming; h.onCallEnded = mxOnCallEnded; h.onCallHandled = mxOnCallHandled;
  h.onReconnect = () => { refreshChats(); if (currentChatId) loadChatHistory(currentChatId); };
  h.onOpenChat = openChatById;
}

function bindTypingInput() {
  const inp = document.getElementById('message-input');
  if (inp) inp.addEventListener('input', () => { if (currentChatId) MchatAPI.sendTyping(currentChatId); });
}

function pruneExpiredStories() {
  const now = Date.now();
  myStories = myStories.filter(s => (now - (s.publishedAt||0)) < 24*60*60*1000);
}

// ============================================================
// AUTH
// ============================================================
// ============================================================
// ВХОД: ник + Google. Новое устройство → код.
// ============================================================
function authAction() {
  const raw = document.getElementById('login-username').value.trim().replace(/^@/, '');
  const errEl = document.getElementById('auth-err');
  errEl.textContent = '';
  // Ник нужен только при регистрации; пустой — допустим (вход в существующий аккаунт)
  if (raw && !/^[A-Za-z0-9_]{3,20}$/.test(raw)) {
    errEl.textContent = raw.length < 3 ? 'Ник: минимум 3 символа' : 'Ник: 3–20 символов, латиница, цифры и _';
    return;
  }
  const btn = document.getElementById('auth-btn');
  btn.disabled = true;
  document.getElementById('auth-btn-text').textContent = 'Переходим в Google…';
  MchatAPI.startGoogle(raw);
}
// вернулись кнопкой «назад» из Google — снова включаем кнопку
window.addEventListener('pageshow', (e) => {
  if (!e.persisted) return;
  const btn = document.getElementById('auth-btn');
  if (btn) { btn.disabled = false; document.getElementById('auth-btn-text').textContent = 'Войти через Google'; }
});

async function showCodeScreen() {
  goTo('s-code');
  const err = document.getElementById('code-err');
  const input = document.getElementById('code-input');
  err.textContent = ''; input.value = '';
  try {
    const p = await MchatAPI.pending();
    document.getElementById('code-hint').textContent = p.emailSent
      ? 'Мы отправили код на ' + p.emailMasked
      : 'Это новое устройство. Мы отправили код на твои устройства, где ты уже вошёл в Mchat';
    document.getElementById('code-email-row').style.display = p.canSendEmail ? 'block' : 'none';
    setTimeout(() => input.focus(), 250);
  } catch (e) {
    cancelCodeLogin();
    document.getElementById('auth-err').textContent = MchatAPI.errorText('code_expired');
  }
}

async function submitLoginCode() {
  const input = document.getElementById('code-input');
  const err = document.getElementById('code-err');
  const btn = document.getElementById('code-btn');
  const code = input.value.trim();
  err.textContent = '';
  if (!/^\d{6}$/.test(code)) { err.textContent = 'Введи 6 цифр'; return; }
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await MchatAPI.verifyCode(code);
    const me = await MchatAPI.me();
    await onLoggedIn(me);
  } catch (e) {
    if (e.code === 'invalid_code') {
      const left = e.data && typeof e.data.attemptsLeft === 'number' ? e.data.attemptsLeft : null;
      err.textContent = 'Неверный код' + (left !== null ? '. Осталось попыток: ' + left : '');
      input.value = ''; input.focus();
    } else if (e.status === 410 || e.status === 401) {
      cancelCodeLogin();
      document.getElementById('auth-err').textContent = MchatAPI.errorText('code_expired');
    } else {
      err.textContent = MchatAPI.errorText(e);
    }
  } finally { btn.disabled = false; }
}

async function sendCodeByEmail() {
  try {
    await MchatAPI.sendEmailCode();
    document.getElementById('code-email-row').style.display = 'none';
    document.getElementById('code-hint').textContent = 'Мы отправили новый код на твою почту из Google-аккаунта';
    showToast('Код отправлен на почту');
  } catch (e) { document.getElementById('code-err').textContent = MchatAPI.errorText(e); }
}

function cancelCodeLogin() { history.replaceState(null, '', '/'); goTo('s-login'); }

// Уже вошедшее устройство получает код нового входа (Socket.IO) — как в Telegram
function showLoginCodeModal(d) {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '950';
  m.innerHTML = `<div class="modal-box" style="text-align:center">
    <h3>Вход с нового устройства</h3>
    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">${esc(d.label)}</div>
    <div style="font-family:var(--font);font-size:36px;font-weight:800;letter-spacing:8px;margin:10px 0 14px">${esc(d.code)}</div>
    <div style="font-size:12px;color:var(--text2);margin-bottom:16px;line-height:1.5">Введи этот код на новом устройстве. Если это не ты — никому не сообщай код.</div>
    <button onclick="this.closest('.modal').remove()" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:15px;font-weight:700;cursor:pointer">Понятно</button>
  </div>`;
  document.getElementById('app').appendChild(m);
}

function logout() {
  showConfirm('Выйти из аккаунта?', async () => {
    try { await MchatAPI.logout(); } catch (e) { /* даже если сети нет — локально выходим */ }
    resetSessionState();
    goTo('s-login');
    showToast('Вы вышли из аккаунта');
  });
}

// ============================================================
// PROFILE
// ============================================================
function updateProfileUI() {
  if (!currentUser) return;
  document.getElementById('profile-name').innerHTML = esc(currentUser.name || currentUser.username) + (currentUser.verified ? ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '');
  document.getElementById('profile-username').innerHTML = '@'+currentUser.username;
  document.getElementById('profile-bio').textContent = currentUser.bio || '';
  document.getElementById('posts-count').textContent = posts.filter(p=>p.username===currentUser.username).length;
  document.getElementById('followers-count').textContent = currentUser.followers||0;
  document.getElementById('following-count').textContent = currentUser.following||0;
  if (currentUser.avatar) {
    document.getElementById('avatar-container').innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    document.getElementById('avatar-container').innerHTML = `<svg width="36" height="36" fill="none" stroke="var(--text2)" stroke-width="1.2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  }
  const composerAv = document.getElementById('composer-avatar');
  if (composerAv) {
    composerAv.innerHTML = currentUser.avatar
      ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`
      : `<svg width="20" height="20" fill="none" stroke="var(--text2)" stroke-width="1.4" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  }
  const composerUsername = document.getElementById('composer-username');
  if (composerUsername) composerUsername.textContent = currentUser.name || ('@' + currentUser.username);
  
  const statusBadges = document.getElementById('profile-status-badges');
  const statuses = [
    '<svg width="10" height="10" viewBox="0 0 10 10" fill="#4ade80"><circle cx="5" cy="5" r="4"/></svg> Онлайн',
    '<svg width="10" height="10" fill="none" stroke="#8888a8" stroke-width="1.8" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg> Работаю'
  ];
  statusBadges.innerHTML = statuses.map(status => `<div class="profile-status-badge">${status}</div>`).join('');
  
  const cover = document.getElementById('cover-image');
  if (currentUser.banner) {
    cover.style.backgroundImage = `url('${currentUser.banner}')`;
    cover.style.backgroundSize = 'cover';
    cover.style.backgroundPosition = 'center';
  } else {
    const theme = localStorage.getItem('mchat_island_theme') || 'default';
    if (theme === 'frost') {
      cover.style.background = 'linear-gradient(135deg,rgba(74,74,240,.2),rgba(184,105,255,.2))';
      cover.style.backdropFilter = 'blur(10px)';
    } else if (theme === 'liquid') {
      cover.style.background = 'linear-gradient(135deg,rgba(74,74,240,.3),rgba(184,105,255,.3))';
      cover.style.backdropFilter = 'blur(20px)';
    } else {
      cover.style.background = 'linear-gradient(135deg,#1a1a50,#2d1b4e,#0f2d40)';
      cover.style.backdropFilter = 'none';
    }
  }
  
  const ring = document.getElementById('story-ring');
  if (ring) {
    ring.style.display = myStories.length > 0 ? 'flex' : 'none';
    ring.classList.toggle('has-story', myStories.length > 0);
    if (myStories.length > 0) ring.style.border = '3px solid #f43f5e';
  }
  
  const adminItem = document.getElementById('admin-panel-item');
  if (adminItem) adminItem.style.display = (currentUser.role === 'ADMIN') ? 'flex' : 'none';
  
  renderStories();
  renderProfileGrid();
}

function avatarTap() {
  if (myStories.length > 0) {
    svCurrentIdx = 0;
    _openStoryViewer();
  } else {
    editProfile();
  }
}

function avatarLongPress(e) {
  e.preventDefault();
  if (currentUser && currentUser.avatar) {
    document.getElementById('avatar-full-img').src = currentUser.avatar;
    document.getElementById('avatar-fullscreen').classList.add('active');
  }
}

function closeAvatarFull() {
  document.getElementById('avatar-fullscreen').classList.remove('active');
}

let longPressTimer = null;
document.addEventListener('DOMContentLoaded',()=>{
  const wrap = document.getElementById('profile-av-wrap');
  if(!wrap) return;
  wrap.addEventListener('touchstart',()=>{ longPressTimer = setTimeout(()=>{ if(currentUser&&currentUser.avatar){document.getElementById('avatar-full-img').src=currentUser.avatar;document.getElementById('avatar-fullscreen').classList.add('active');} },600); });
  wrap.addEventListener('touchend',()=>clearTimeout(longPressTimer));
  wrap.addEventListener('touchmove',()=>clearTimeout(longPressTimer));
});

function editProfile() {
  const m = document.getElementById('modal-avatar');
  if (currentUser.avatar) m.innerHTML = `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  else m.innerHTML = `<svg width="24" height="24" fill="none" stroke="var(--text2)" stroke-width="1.4" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  document.getElementById('edit-name').value = currentUser.name||'';
  document.getElementById('edit-username').value = currentUser.username||'';
  document.getElementById('edit-bio').value = currentUser.bio||'';
  const canChange = !currentUser.nameChangedAt || (Date.now()-currentUser.nameChangedAt > 7*24*60*60*1000);
  document.getElementById('name-warning').style.display = canChange?'none':'block';
  document.getElementById('edit-name').disabled = !canChange;
  
  // Reset modal state completely to fix repeated-open bug
  const editModal = document.getElementById('edit-modal');
  editModal.classList.remove('active');
  void editModal.offsetWidth; // force reflow
  
  const verifyBtn = document.getElementById('verify-request-btn');
  if (verifyBtn) {
    if (currentUser.verified) {
      verifyBtn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="display:inline;vertical-align:middle;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg> Верифицирован';
      verifyBtn.disabled = true;
      verifyBtn.style.opacity = '0.6';
      verifyBtn.onclick = null;
    } else {
      verifyBtn.innerHTML = '<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="display:inline;vertical-align:middle;margin-right:4px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Запросить верификацию';
      verifyBtn.disabled = false;
      verifyBtn.style.opacity = '1';
      verifyBtn.onclick = requestVerification;
    }
  }
  
  editModal.classList.add('active');
}

function pickAvatar() {
  document.getElementById('avatar-input').click();
}

let avatarCropperData = { img: null, x: 0, y: 0, scale: 1 };

function setupAvatarCropper(imageUrl) {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '950';
  m.onclick = (e) => { if(e.target === m) m.remove(); };
  m.innerHTML = `<div class="modal-box" style="width:380px;max-width:90vw;padding:0">
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;border-bottom:1px solid var(--border)">
      <div style="font-family:var(--font);font-size:17px;font-weight:800">Кадрировать аватар</div>
      <button onclick="this.closest('.modal').remove()" style="background:none;border:none;color:var(--text2);cursor:pointer;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
      <div id="avatar-cropper-container" style="width:100%;aspect-ratio:1;border-radius:50%;overflow:hidden;background:var(--surf2);position:relative;display:flex;align-items:center;justify-content:center">
        <img id="avatar-cropper-img" src="${imageUrl}" style="width:150%;height:150%;object-fit:cover;position:absolute;cursor:grab;user-select:none">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:12px;color:var(--text2);min-width:60px">Масштаб:</span>
        <input id="avatar-cropper-scale" type="range" min="1" max="3" step="0.1" value="1" style="flex:1;cursor:pointer" oninput="updateAvatarCropperScale()">
      </div>
    </div>
    <div style="display:flex;gap:8px;padding:14px;border-top:1px solid var(--border);background:var(--bg2)">
      <button onclick="this.closest('.modal').remove()" style="flex:1;padding:12px;border-radius:14px;border:none;background:var(--surf);color:var(--text);font-family:var(--font);font-size:14px;cursor:pointer">Отмена</button>
      <button onclick="applyAvatarCrop()" style="flex:1;padding:12px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:14px;font-weight:600;cursor:pointer">Применить</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(m);
  setupAvatarDrag();
  centerAvatarCropper();
}

function centerAvatarCropper() {
  const container = document.getElementById('avatar-cropper-container');
  const img = document.getElementById('avatar-cropper-img');
  if (!container || !img) return;
  const apply = () => {
    const cw = container.offsetWidth, ch = container.offsetHeight;
    const iw = img.offsetWidth, ih = img.offsetHeight;
    img.style.left = ((cw - iw) / 2) + 'px';
    img.style.top = ((ch - ih) / 2) + 'px';
  };
  if (img.complete && img.naturalWidth) apply();
  else img.addEventListener('load', apply, {once:true});
  // На случай если модалка ещё не отрисована в момент вызова
  setTimeout(apply, 50);
}

function setupAvatarDrag() {
  const img = document.getElementById('avatar-cropper-img');
  if (!img) return;
  let isDragging = false;
  let startX = 0, startY = 0;
  let offsetX = 0, offsetY = 0;
  
  img.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    offsetX = parseFloat(img.style.left) || 0;
    offsetY = parseFloat(img.style.top) || 0;
    img.style.cursor = 'grabbing';
    e.preventDefault();
  });
  
  document.addEventListener('pointermove', (e) => {
    if (!isDragging || !img) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    img.style.left = (offsetX + dx) + 'px';
    img.style.top = (offsetY + dy) + 'px';
  });
  
  document.addEventListener('pointerup', () => {
    isDragging = false;
    if (img) img.style.cursor = 'grab';
  });
  
  img.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isDragging = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      offsetX = parseFloat(img.style.left) || 0;
      offsetY = parseFloat(img.style.top) || 0;
    }
  }, {passive: false});
  
  document.addEventListener('touchmove', (e) => {
    if (!isDragging || !img || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    img.style.left = (offsetX + dx) + 'px';
    img.style.top = (offsetY + dy) + 'px';
    e.preventDefault();
  }, {passive: false});
  
  document.addEventListener('touchend', () => { isDragging = false; });
}

function updateAvatarCropperScale() {
  const slider = document.getElementById('avatar-cropper-scale');
  const img = document.getElementById('avatar-cropper-img');
  if (!slider || !img) return;
  const scale = parseFloat(slider.value);
  // Держим точку, на которую сейчас смотрит пользователь (центр круга), неподвижной при зуме
  const oldW = img.offsetWidth, oldH = img.offsetHeight;
  const oldLeft = parseFloat(img.style.left) || 0;
  const oldTop = parseFloat(img.style.top) || 0;
  const centerX = oldLeft + oldW / 2;
  const centerY = oldTop + oldH / 2;
  img.style.width = (150 * scale) + '%';
  img.style.height = (150 * scale) + '%';
  const newW = img.offsetWidth, newH = img.offsetHeight;
  img.style.left = (centerX - newW / 2) + 'px';
  img.style.top = (centerY - newH / 2) + 'px';
  avatarCropperData.scale = scale;
}

function applyAvatarCrop() {
  const container = document.getElementById('avatar-cropper-container');
  const img = document.getElementById('avatar-cropper-img');
  if (!container || !img) return;
  
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  
  ctx.beginPath();
  ctx.arc(100, 100, 100, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fill();
  ctx.clip();
  
  // Видимый круг (в пикселях контейнера) — квадратная область, которую нужно перенести на канвас
  const C = container.offsetWidth;
  const boxW = img.offsetWidth, boxH = img.offsetHeight;
  const left = parseFloat(img.style.left) || 0;
  const top = parseFloat(img.style.top) || 0;
  
  const tempImg = new Image();
  tempImg.crossOrigin = 'anonymous';
  tempImg.onload = () => {
    const naturalW = tempImg.naturalWidth || tempImg.width;
    const naturalH = tempImg.naturalHeight || tempImg.height;
    // img отображается с object-fit:cover внутри рамки boxW x boxH — считаем реальное
    // положение и масштаб исходного изображения внутри этой рамки
    const coverScale = Math.max(boxW / naturalW, boxH / naturalH);
    const renderedW = naturalW * coverScale, renderedH = naturalH * coverScale;
    const cropX = (renderedW - boxW) / 2;
    const cropY = (renderedH - boxH) / 2;
    const visibleNaturalX = cropX / coverScale;
    const visibleNaturalY = cropY / coverScale;
    
    // Переводим видимую область круга (0..C, 0..C в координатах контейнера)
    // в координаты исходного изображения
    const sx = visibleNaturalX - left / coverScale;
    const sy = visibleNaturalY - top / coverScale;
    const sSize = C / coverScale;
    
    ctx.drawImage(tempImg, sx, sy, sSize, sSize, 0, 0, canvas.width, canvas.height);
    
    const croppedUrl = canvas.toDataURL('image/jpeg', 0.92);
    const prevAvatar = currentUser.avatar;
    currentUser.avatar = croppedUrl; // сразу показываем, параллельно грузим на сервер
    canvas.toBlob(async blob => {
      try {
        const up = await MchatAPI.uploadMedia('image', blob, {});
        await MchatAPI.updateMe({ avatarMediaId: up.id });
        currentUser.avatar = up.url; saveUser(); updateProfileUI();
      } catch (e) {
        currentUser.avatar = prevAvatar; updateProfileUI();
        showToast('Аватар не сохранён: ' + MchatAPI.errorText(e));
      }
    }, 'image/jpeg', 0.92);
    
    const modal = document.querySelector('.modal.active');
    if (modal) modal.remove();
    
    document.getElementById('modal-avatar').innerHTML = `<img src="${croppedUrl}" style="width:100%;height:100%;object-fit:cover">`;
    document.getElementById('avatar-container').innerHTML = `<img src="${croppedUrl}" style="width:100%;height:100%;object-fit:cover">`;
    updateProfileUI();
    showToast('Аватар обновлён');
  };
  tempImg.src = img.src;
}

function avatarChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { setupAvatarCropper(ev.target.result); };
  reader.readAsDataURL(file);
}

function saveProfile() {
  const name = document.getElementById('edit-name').value.trim().slice(0, 40);
  const bio  = document.getElementById('edit-bio').value.trim().slice(0, 160);
  if (/[<>]/.test(name)) { showToast('В имени нельзя использовать < и >'); return; }
  const canChange = !currentUser.nameChangedAt || (Date.now()-currentUser.nameChangedAt > 7*24*60*60*1000);
  if (name && canChange) { currentUser.name = name; currentUser.nameChangedAt = Date.now(); }
  if (bio !== undefined) currentUser.bio = bio;
  saveUser(); updateProfileUI(); closeModal();
  MchatAPI.updateMe({ name: currentUser.name || currentUser.username, bio: currentUser.bio || '' }).catch(e => showToast(MchatAPI.errorText(e)));
}

function closeModal() { document.getElementById('edit-modal').classList.remove('active'); }

function renderProfileGrid() {
  if (currentProfileTab && currentProfileTab !== 'posts') { renderProfileTabContent(); return; }
  const grid = document.getElementById('profile-grid');
  if (!grid) return;
  const myPosts = posts.filter(p=>p.username===currentUser.username);
  let html = '';
  myPosts.forEach(p => {
    if (p.mediaType === 'image' && p.mediaUrl) {
      html += `<div class="grid-item" onclick="openPostViewer(${p.id})"><img src="${p.mediaUrl}"></div>`;
    } else if (p.mediaType === 'video' && p.mediaUrl) {
      const thumb = p.thumbnail || '';
      if (thumb) {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="position:relative"><img src="${thumb}" style="width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div>`;
      } else {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="position:relative;background:var(--surf2)" id="grid-vid-${p.id}"><video src="${p.mediaUrl}" style="width:100%;height:100%;object-fit:cover" muted playsinline preload="metadata" onloadeddata="captureGridThumb(this,${p.id})"></video><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div>`;
      }
    } else {
      html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:4px"><svg width="20" height="20" fill="none" stroke="var(--text2)" stroke-width="1.4" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div style="font-size:9px;color:var(--text2);text-align:center;padding:0 4px;overflow:hidden;max-height:24px">${p.text?p.text.slice(0,20):''}</div></div>`;
    }
  });
  html += `<div class="grid-item grid-add" onclick="addPostWithMedia()"><svg width="28" height="28" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></div>`;
  grid.innerHTML = html;
}

// ============================================================
// STORIES
// ============================================================
function renderStories() {
  const row = document.getElementById('stories-row');
  if (!row) return;
  pruneExpiredStories();
  let html = '';
  if (myStories.length > 0) {
    html += `<div class="si" onclick="viewStoryAt(0)" style="position:relative">
      <div class="sring has-story" style="position:relative">
        <div class="sinner">
          ${currentUser&&currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<svg width="24" height="24" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`}
        </div>
        <div style="position:absolute;bottom:2px;left:50%;transform:translateX(-50%);display:flex;gap:2px">
          ${myStories.map((_, i) => `<div style="width:4px;height:2px;border-radius:1px;background:${i === 0 ? '#fff' : 'rgba(255,255,255,.4)'}"></div>`).join('')}
        </div>
      </div>
      <div class="sname" style="font-weight:600">Мои истории</div>
    </div>`;
    html += `<div class="si" onclick="openStoryCreator()">
      <div class="sring you" style="position:relative">
        <div class="sinner">
          ${currentUser&&currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<svg width="24" height="24" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`}
          <div class="sadd"><svg width="10" height="10" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
        </div>
      </div>
      <div class="sname">Добавить</div>
    </div>`;
  } else {
    html += `<div class="si" onclick="openStoryCreator()">
      <div class="sring you" style="position:relative">
        <div class="sinner">
          ${currentUser&&currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<svg width="24" height="24" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`}
          <div class="sadd"><svg width="10" height="10" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div>
        </div>
      </div>
      <div class="sname">Добавить</div>
    </div>`;
  }
  row.innerHTML = html;
}

let svCurrentIdx = 0;
function _stopStoryInterval() {
  const viewer = document.getElementById('story-viewer');
  if (viewer && viewer._iv) { clearInterval(viewer._iv); viewer._iv = null; }
}

function viewStoryAt(idx) {
  svCurrentIdx = idx;
  _openStoryViewer();
}

function _openStoryViewer() {
  _stopStoryInterval();
  const story = myStories[svCurrentIdx];
  if (!story) return;
  if (!story.likes) story.likes = 0;
  if (!story.liked) story.liked = false;
  if (!story.comments) story.comments = [];

  const bg = document.getElementById('sv-bg');
  bg.querySelectorAll('.sv-text-overlay').forEach(el => el.remove());
  const oldVid = document.getElementById('sv-video');
  if (oldVid) { oldVid.pause(); oldVid.remove(); }

  if (story.video) {
    bg.style.background = '#000';
    const vid = document.createElement('video');
    vid.id = 'sv-video';
    vid.src = story.video;
    vid.autoplay = true; vid.loop = true; vid.muted = false; vid.playsInline = true;
    vid.preload = 'metadata';
    vid.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:1;background:#000';
    vid.onerror = () => { console.log('Video load error'); };
    bg.insertBefore(vid, bg.firstChild);
    document.getElementById('sv-content').innerHTML = '';
    vid.play().catch(err => { vid.muted = true; vid.play(); });
    const existingMuteBtn = document.getElementById('sv-mute-btn');
    if (existingMuteBtn) existingMuteBtn.remove();
    const muteBtn = document.createElement('button');
    muteBtn.id = 'sv-mute-btn';
    muteBtn.style.cssText = 'position:absolute;top:max(90px,env(safe-area-inset-top)+50px);right:12px;width:34px;height:34px;border-radius:50%;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:15;color:#fff;flex-shrink:0';
    muteBtn.innerHTML = vid.muted ? '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' : '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>';
    muteBtn.onclick = (e) => { e.stopPropagation(); vid.muted = !vid.muted; muteBtn.innerHTML = vid.muted ? '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>' : '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>'; };
    bg.appendChild(muteBtn);
  } else if (story.img) {
    bg.style.background = '#000';
    const imgEl = document.createElement('img');
    imgEl.src = story.img;
    imgEl.className = 'sv-story-img';
    imgEl.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1;touch-action:pinch-zoom;background:#000;';
    document.getElementById('sv-content').innerHTML = '';
    bg.querySelectorAll('.sv-story-img').forEach(el => el.remove());
    bg.insertBefore(imgEl, bg.firstChild);
    setTimeout(()=>setupPinchZoom(imgEl), 100);
  } else {
    bg.style.background = story.bg || 'linear-gradient(135deg,#4a4af0,#7c3aed)';
    document.getElementById('sv-content').innerHTML = '';
  }

  // Рендерим все текстовые блоки
  const blocksToRender = (story.textBlocks && story.textBlocks.length > 0) ? story.textBlocks
    : story.text ? [{text:story.text, color:story.textColor||'#fff', font:story.textFont||'Syne', left:story.textLeft||'50%', top:story.textTop||'45%', fontSize:26}]
    : [];
  blocksToRender.forEach(blk => {
    const fontFamily = blk.font === 'Syne' ? "var(--font)" : blk.font === 'DM Sans' ? "var(--font)" : (blk.font || "var(--font)");
    const textEl = document.createElement('div');
    textEl.className = 'sv-text-overlay';
    textEl.style.cssText = `position:absolute;left:${blk.left||'50%'};top:${blk.top||'45%'};transform:translate(-50%,-50%);color:${blk.color||'#fff'};font-size:${blk.fontSize||26}px;font-weight:700;font-family:${fontFamily};text-align:center;padding:8px 14px;text-shadow:0 2px 16px rgba(0,0,0,.5);word-break:break-word;max-width:85%;z-index:5;pointer-events:none;border-radius:8px`;
    textEl.textContent = blk.text;
    bg.appendChild(textEl);
  });

  const hoursLeft = Math.max(0, Math.ceil((24*60*60*1000 - (Date.now() - story.publishedAt)) / (60*60*1000)));
  document.getElementById('sv-username').textContent = currentUser.username;
  document.getElementById('sv-time').textContent = `${hoursLeft}ч осталось`;
  const av = document.getElementById('sv-avatar');
  av.innerHTML = currentUser.avatar ? `<img src="${currentUser.avatar}" style="width:100%;height:100%;object-fit:cover">` : `<span style="color:#fff;font-weight:700">${currentUser.username.charAt(0).toUpperCase()}</span>`;

  svRenderLike();
  svRenderComments();

  const barsEl = document.getElementById('sv-bars');
  barsEl.innerHTML = myStories.map((s, i) => `<div class="sv-bar"><div class="sv-bar-fill" id="sv-fill-${i}" style="width:${i < svCurrentIdx ? '100%' : '0%'}"></div></div>`).join('');

  document.getElementById('story-viewer').classList.add('active');

  if (document.getElementById('story-viewer')._iv) clearInterval(document.getElementById('story-viewer')._iv);

  let pct = 0;
  const duration = story.video ? 300 : 150;
  const iv = setInterval(() => {
    if (document.activeElement === document.getElementById('sv-comment-input')) return;
    if (svLongPressActive) return;
    pct += 100 / duration;
    const fill = document.getElementById(`sv-fill-${svCurrentIdx}`);
    if (fill) fill.style.width = pct + '%';
    if (pct >= 100) {
      clearInterval(iv);
      if (svCurrentIdx + 1 < myStories.length) { svCurrentIdx++; setTimeout(_openStoryViewer, 150); }
      else { setTimeout(closeStoryViewer, 300); }
    }
  }, 100);
  document.getElementById('story-viewer')._iv = iv;
  setupStoryLongPress();
}

function svTapLeft() { if (svCurrentIdx > 0) { svCurrentIdx--; _openStoryViewer(); } }
function svTapRight() { if (svCurrentIdx + 1 < myStories.length) { svCurrentIdx++; _openStoryViewer(); } else { closeStoryViewer(); } }

let svLongPressActive = false;
let svLongPressTimer = null;

function setupStoryLongPress() {
  const viewer = document.getElementById('story-viewer');
  if (!viewer) return;
  const bg = document.getElementById('sv-bg');
  const vid = document.getElementById('sv-video');
  function startLongPress() {
    svLongPressActive = true;
    if (vid) vid.pause();
    const av = document.getElementById('sv-avatar');
    if (av) {
      av.style.position = 'absolute';
      av.style.left = '50%';
      av.style.top = '50%';
      av.style.transform = 'translate(-50%, -50%)';
      av.style.width = '80px';
      av.style.height = '80px';
      av.style.opacity = '0';
      av.style.zIndex = '10';
      av.style.transition = 'opacity 0.3s ease';
      setTimeout(() => { av.style.opacity = '1'; }, 50);
    }
  }
  function endLongPress() {
    if (!svLongPressActive) return;
    svLongPressActive = false;
    if (vid) vid.play();
    const av = document.getElementById('sv-avatar');
    if (av) {
      av.style.opacity = '0';
      setTimeout(() => {
        av.style.position = 'absolute';
        av.style.left = '16px';
        av.style.top = 'max(56px, calc(env(safe-area-inset-top) + 16px))';
        av.style.width = '40px';
        av.style.height = '40px';
        av.style.transform = 'none';
        av.style.zIndex = '5';
      }, 300);
    }
  }
  bg.addEventListener('mousedown', () => { svLongPressTimer = setTimeout(startLongPress, 500); });
  bg.addEventListener('mouseup', () => { clearTimeout(svLongPressTimer); endLongPress(); });
  bg.addEventListener('mouseleave', () => { clearTimeout(svLongPressTimer); endLongPress(); });
  bg.addEventListener('touchstart', () => { svLongPressTimer = setTimeout(startLongPress, 500); });
  bg.addEventListener('touchend', () => { clearTimeout(svLongPressTimer); endLongPress(); });
  bg.addEventListener('touchcancel', () => { clearTimeout(svLongPressTimer); endLongPress(); });
}

function svRenderLike() {
  const story = myStories[svCurrentIdx];
  if (!story) return;
  const ico = document.getElementById('sv-like-ico');
  ico.setAttribute('fill', story.liked ? '#f43f5e' : 'none');
  ico.setAttribute('stroke', story.liked ? '#f43f5e' : '#fff');
  document.getElementById('sv-like-count').textContent = story.likes || 0;
}

function svToggleLike() {
  const story = myStories[svCurrentIdx];
  if (!story) return;
  story.liked = !story.liked;
  story.likes = (story.likes || 0) + (story.liked ? 1 : -1);
  MchatAPI.likeStory(story.id, story.liked).then(r => { story.likes = r.likes; story.liked = r.liked; svRenderLike(); }).catch(() => {});
  svRenderLike();
  if (story.liked) {
    const h = document.getElementById('sv-heart-anim');
    h.style.opacity = '1';
    setTimeout(() => { h.style.opacity = '0'; }, 700);
  }
}

function svRenderComments() {
  const story = myStories[svCurrentIdx];
  const el = document.getElementById('sv-comments-list');
  if (!story || !story.comments || story.comments.length === 0) { el.innerHTML = ''; return; }
  const last = story.comments.slice(-3);
  el.innerHTML = last.map(c => `<div style="display:flex;align-items:center;gap:8px"><span style="color:rgba(255,255,255,.7);font-size:12px;font-weight:600">@${esc(c.username)}</span><span style="color:#fff;font-size:13px">${esc(c.text)}</span></div>`).join('');
}

async function svSendComment() {
  const input = document.getElementById('sv-comment-input');
  const text = input.value.trim();
  const story = myStories[svCurrentIdx];
  if (!text || !story) return;
  try {
    const r = await MchatAPI.commentStory(story.id, text);
    if (!story.comments) story.comments = [];
    story.comments.push(commentFromServer(r.comment));
    input.value = '';
    svRenderComments();
    showToast('Реакция отправлена');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

function deleteCurrentStory() {
  showConfirm('Удалить историю?', async () => {
    const story = myStories[svCurrentIdx];
    if (story) { try { await MchatAPI.deleteStory(story.id); } catch (e) { showToast(MchatAPI.errorText(e)); return; } }
    myStories.splice(svCurrentIdx, 1);
    closeStoryViewer();
    updateProfileUI();
    showToast('История удалена');
  });
}

function showConfirm(message, onYes) {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '900';
  m.innerHTML = `<div class="modal-box" style="text-align:center">
    <div style="font-size:22px;margin-bottom:10px"><svg width="28" height="28" fill="none" stroke="#f43f5e" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
    <div style="font-family:var(--font);font-size:16px;font-weight:700;margin-bottom:6px">${message}</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:20px">Это действие нельзя отменить</div>
    <div class="mbtns">
      <button class="mbtn-cancel" id="confirm-no" onclick="this.closest('.modal').remove()">Нет</button>
      <button style="flex:1;padding:12px;border-radius:14px;border:none;cursor:pointer;background:#f43f5e;color:#fff;font-weight:600;font-size:14px" id="confirm-yes">Да, удалить</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(m);
  m.querySelector('#confirm-yes').onclick = () => { m.remove(); onYes(); };
}

function confirmDeleteAccount() {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '900';
  let countdown = 5;
  m.innerHTML = `<div class="modal-box" style="text-align:center">
    <div style="font-size:22px;margin-bottom:10px"><svg width="28" height="28" fill="none" stroke="#f43f5e" stroke-width="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
    <div style="font-family:var(--font);font-size:16px;font-weight:700;margin-bottom:6px">Удалить аккаунт?</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">Все данные будут удалены навсегда</div>
    <div id="da-countdown" style="font-size:28px;font-weight:800;font-family:var(--font);color:#f43f5e;margin:14px 0">${countdown}</div>
    <div class="mbtns">
      <button class="mbtn-cancel" onclick="this.closest('.modal').remove()">Отмена</button>
      <button id="da-confirm-btn" disabled style="flex:1;padding:12px;border-radius:14px;border:none;background:#f43f5e44;color:#f43f5e88;font-weight:600;font-size:14px;cursor:not-allowed">Удалить (${countdown})</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(m);
  const iv = setInterval(() => {
    countdown--;
    const el = m.querySelector('#da-countdown');
    const btn = m.querySelector('#da-confirm-btn');
    if (!el || !m.isConnected) { clearInterval(iv); return; }
    if (countdown <= 0) {
      clearInterval(iv);
      el.textContent = '!';
      btn.disabled = false;
      btn.style.background = '#f43f5e';
      btn.style.color = '#fff';
      btn.style.cursor = 'pointer';
      btn.textContent = 'Удалить навсегда';
      btn.onclick = () => { m.remove(); deleteAccount(); };
    } else {
      el.textContent = countdown;
      btn.textContent = `Удалить (${countdown})`;
    }
  }, 1000);
}

async function deleteAccount() {
  try {
    await MchatAPI.deleteMe(); // сервер стирает аккаунт, диалоги и сессии
  } catch (e) {
    showToast('Не удалось удалить аккаунт: ' + MchatAPI.errorText(e));
    return;
  }
  resetSessionState();
  goTo('s-login');
  showToast('Аккаунт удалён');
}

function closeStoryViewer() {
  const v = document.getElementById('story-viewer');
  if (v._iv) clearInterval(v._iv);
  v.classList.remove('active');
  const vid = document.getElementById('sv-video');
  if (vid) { vid.pause(); vid.remove(); }
  const muteBtn = document.getElementById('sv-mute-btn');
  if (muteBtn) muteBtn.remove();
  const bg = document.getElementById('sv-bg');
  if (bg) bg.querySelectorAll('.sv-story-img').forEach(el => el.remove());
}

// ============================================================
// STORY CREATOR
// ============================================================
const scBgs = ['linear-gradient(135deg,#4a4af0,#7c3aed)','linear-gradient(135deg,#f43f5e,#f97316)','linear-gradient(135deg,#10b981,#06b6d4)','linear-gradient(135deg,#f59e0b,#eab308)','linear-gradient(135deg,#6366f1,#ec4899)','linear-gradient(135deg,#111,#333)'];
let scBgIdx = 0, scMediaUrl = null, scMediaType = null, scTextColor = '#ffffff', scFont = 'Syne';
let scTexts = []; // массив текстовых блоков {id, text, color, font, left, top, fontSize}
let scSelectedTextId = null;
let scCameraStream = null, scCameraFacing = 'user', scMediaRecorder = null, scRecChunks = [], scRecTimer = null, scRecSecs = 0;

function openStoryCreator() {
  scMediaUrl = null; scMediaType = null; scBgIdx = 0; scTextColor = '#ffffff'; scFont = 'Syne';
  scTexts = []; scSelectedTextId = null;
  document.getElementById('sc-text').value = '';
  // Очищаем все текстовые блоки
  document.querySelectorAll('.sc-text-block').forEach(el => el.remove());
  const dt = document.getElementById('sc-drag-text');
  dt.textContent = ''; dt.style.display = 'none'; dt.style.color = '#fff';
  dt.style.fontFamily = "var(--font)"; dt.style.fontSize = '26px';
  dt.style.top = '45%'; dt.style.left = '50%';
  dt.style.transform = 'translate(-50%,-50%)';
  document.getElementById('sc-preview-img').style.display = 'none';
  document.getElementById('sc-preview-vid').style.display = 'none';
  document.getElementById('sc-preview-vid').src = '';
  document.getElementById('sc-preview').style.background = scBgs[0];
  document.getElementById('sc-bg-btn').style.display = '';
  document.getElementById('sc-text-editor').style.display = 'none';
  document.getElementById('sc-style-panel').style.display = 'none';
  document.getElementById('sc-hint').style.display = 'block';
  document.getElementById('sc-bottom').style.display = 'none';
  document.getElementById('sc-rec-badge').style.display = 'none';
  document.getElementById('story-creator').classList.add('active');
  setupDrag();
  setTimeout(setupTextPinchScale, 100);
  scStartCamera();
}

async function scStartCamera() {
  try {
    if (scCameraStream) scCameraStream.getTracks().forEach(t=>t.stop());
    scCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: scCameraFacing, width:{ideal:1280}, height:{ideal:720} },
      audio: true
    });
    const cam = document.getElementById('sc-camera');
    cam.srcObject = scCameraStream;
    cam.style.display = 'block';
    cam.style.transform = scCameraFacing === 'user' ? 'scaleX(-1)' : 'none';
    document.getElementById('sc-preview').style.background = 'transparent';
    document.getElementById('sc-bg-btn').style.display = 'none';
    document.getElementById('sc-cam-controls').style.display = 'flex';
    document.getElementById('sc-hint').style.display = 'none';
  } catch(e) {
    document.getElementById('sc-cam-controls').style.display = 'none';
    document.getElementById('sc-preview').style.background = scBgs[0];
    document.getElementById('sc-bottom').style.display = 'block';
    document.getElementById('sc-hint').style.display = 'block';
  }
}

function scFlipCamera() {
  scCameraFacing = scCameraFacing === 'user' ? 'environment' : 'user';
  scStartCamera();
}

function scExitCamera() {
  if (scCameraStream) { scCameraStream.getTracks().forEach(t => t.stop()); scCameraStream = null; }
  const cam = document.getElementById('sc-camera');
  cam.srcObject = null;
  cam.style.display = 'none';
  document.getElementById('sc-cam-controls').style.display = 'none';
  document.getElementById('sc-preview').style.background = scBgs[scBgIdx];
  document.getElementById('sc-bg-btn').style.display = '';
  document.getElementById('sc-bottom').style.display = 'block';
  document.getElementById('sc-hint').style.display = 'block';
}

let scRecordCanvas = null, scRecordCtx = null, scRecordRAF = null;

function scStartRecord(e) {
  if (e) e.preventDefault();
  if (!scCameraStream) return;
  scRecChunks = []; scRecSecs = 0;
  const inner = document.getElementById('sc-record-inner');
  inner.style.borderRadius = '4px'; inner.style.width = '22px'; inner.style.height = '22px';
  const badge = document.getElementById('sc-rec-badge');
  badge.style.display = 'flex';
  const ring = document.getElementById('sc-rec-ring');
  const circumference = 213.6;

  const cam = document.getElementById('sc-camera');
  let recordStream = scCameraStream;
  // Для фронтальной камеры записываем через канвас, чтобы видео получилось зеркальным (как в превью)
  if (scCameraFacing === 'user' && cam && cam.videoWidth) {
    try {
      scRecordCanvas = document.createElement('canvas');
      scRecordCanvas.width = cam.videoWidth;
      scRecordCanvas.height = cam.videoHeight;
      scRecordCtx = scRecordCanvas.getContext('2d');
      const drawFrame = () => {
        if (!scRecordCtx) return;
        scRecordCtx.save();
        scRecordCtx.translate(scRecordCanvas.width, 0);
        scRecordCtx.scale(-1, 1);
        scRecordCtx.drawImage(cam, 0, 0, scRecordCanvas.width, scRecordCanvas.height);
        scRecordCtx.restore();
        scRecordRAF = requestAnimationFrame(drawFrame);
      };
      drawFrame();
      const canvasStream = scRecordCanvas.captureStream(30);
      scCameraStream.getAudioTracks().forEach(t => canvasStream.addTrack(t));
      recordStream = canvasStream;
    } catch(err) {
      recordStream = scCameraStream;
      scRecordCanvas = null; scRecordCtx = null;
    }
  }

  try {
    scMediaRecorder = new MediaRecorder(recordStream, {mimeType:'video/webm;codecs=vp8,opus'});
  } catch(e) {
    scMediaRecorder = new MediaRecorder(recordStream);
  }
  scMediaRecorder.ondataavailable = e => { if(e.data.size>0) scRecChunks.push(e.data); };
  scMediaRecorder.onstop = () => {
    if (scRecordRAF) { cancelAnimationFrame(scRecordRAF); scRecordRAF = null; }
    scRecordCanvas = null; scRecordCtx = null;
    const blob = new Blob(scRecChunks, {type:'video/webm'});
    const url = URL.createObjectURL(blob);
    scSetVideoPreview(url);
  };
  scMediaRecorder.start(100);
  scRecTimer = setInterval(() => {
    scRecSecs++;
    document.getElementById('sc-rec-secs').textContent = scRecSecs + 's / 20s';
    const offset = circumference - (scRecSecs / 20) * circumference;
    ring.style.strokeDashoffset = Math.max(0, offset);
    if (scRecSecs >= 20) scStopRecord();
  }, 1000);
}

function scStopRecord() {
  clearInterval(scRecTimer);
  if (scMediaRecorder && scMediaRecorder.state !== 'inactive') scMediaRecorder.stop();
  const inner = document.getElementById('sc-record-inner');
  inner.style.borderRadius = '50%'; inner.style.width = '28px'; inner.style.height = '28px';
  document.getElementById('sc-rec-badge').style.display = 'none';
  document.getElementById('sc-rec-ring').style.strokeDashoffset = '213.6';
}

function scSetVideoPreview(url) {
  scMediaUrl = url; scMediaType = 'video';
  if (scCameraStream) { scCameraStream.getTracks().forEach(t=>t.stop()); scCameraStream = null; }
  document.getElementById('sc-camera').style.display = 'none';
  document.getElementById('sc-cam-controls').style.display = 'none';
  document.getElementById('sc-bg-btn').style.display = 'none';
  const vid = document.getElementById('sc-preview-vid');
  vid.src = url; vid.style.display = 'block';
  document.getElementById('sc-bottom').style.display = 'block';
  document.getElementById('sc-hint').style.display = 'none';
}

function setupDrag() {
  const el = document.getElementById('sc-drag-text');
  const fresh = el.cloneNode(true);
  el.parentNode.replaceChild(fresh, el);
  const nel = document.getElementById('sc-drag-text');
  let ox=0,oy=0,ex=0,ey=0,moved=false;
  function onMove(e) {
    e.preventDefault();
    moved = true;
    const cx = e.touches?e.touches[0].clientX:e.clientX;
    const cy = e.touches?e.touches[0].clientY:e.clientY;
    const dx = cx-ox, dy = cy-oy;
    const p = nel.parentElement.getBoundingClientRect();
    const pct_x = ((ex + dx) / p.width)*100;
    const pct_y = ((ey + dy) / p.height)*100;
    nel.style.transform = 'translate(-50%,-50%)';
    nel.style.left = Math.max(5,Math.min(95,pct_x))+'%';
    nel.style.top  = Math.max(5,Math.min(95,pct_y))+'%';
  }
  function onEnd() {
    document.removeEventListener('mousemove',onMove);
    document.removeEventListener('mouseup',onEnd);
    document.removeEventListener('touchmove',onMove);
    document.removeEventListener('touchend',onEnd);
  }
  function onStart(e) {
    moved = false;
    const cx = e.touches?e.touches[0].clientX:e.clientX;
    const cy = e.touches?e.touches[0].clientY:e.clientY;
    ox = cx; oy = cy;
    const p = nel.parentElement.getBoundingClientRect();
    ex = (parseFloat(nel.style.left)/100)*p.width;
    ey = (parseFloat(nel.style.top)/100)*p.height;
    document.addEventListener('mousemove',onMove);
    document.addEventListener('mouseup',onEnd);
    document.addEventListener('touchmove',onMove,{passive:false});
    document.addEventListener('touchend',onEnd);
  }
  nel.addEventListener('mousedown',onStart);
  nel.addEventListener('touchstart',onStart,{passive:true});
}

function scTapZoneClick(e) {
  // Снять выделение с блоков если кликнули на пустую зону
  scSelectedTextId = null;
  document.querySelectorAll('.sc-text-block').forEach(el => {
    el.style.outline = 'none';
    const d = el.querySelector('.sc-text-delete-btn');
    if (d) d.style.display = 'none';
  });
  // Если текстовый редактор открыт — скрыть его; иначе открыть для нового текста
  const ed = document.getElementById('sc-text-editor');
  if (ed.style.display !== 'none') {
    scConfirmText();
  } else {
    scFocusText();
  }
}

function scFocusText() {
  // Снять выделение со всех блоков
  scSelectedTextId = null;
  document.querySelectorAll('.sc-text-block').forEach(el => {
    el.style.outline = 'none';
    el.querySelector('.sc-text-delete-btn') && (el.querySelector('.sc-text-delete-btn').style.display = 'none');
  });
  document.getElementById('sc-text').value = '';
  document.getElementById('sc-text-editor').style.display = 'block';
  setTimeout(()=>document.getElementById('sc-text').focus(),50);
}

function scUpdateText() {
  const t = document.getElementById('sc-text').value;
  if (scSelectedTextId !== null) {
    // Редактируем существующий блок
    const block = document.querySelector('.sc-text-block[data-id="'+scSelectedTextId+'"]');
    if (block) {
      const span = block.querySelector('.sc-text-span');
      if (span) span.textContent = t;
      const obj = scTexts.find(x=>x.id===scSelectedTextId);
      if (obj) obj.text = t;
    }
  } else {
    // Live preview в sc-drag-text (старый блок, используем как preview для нового)
    const dt = document.getElementById('sc-drag-text');
    if (t) {
      dt.textContent = t;
      dt.style.display = 'block';
      dt.style.color = scTextColor;
      dt.style.fontFamily = scFont === 'Syne' ? "var(--font)" : scFont === 'DM Sans' ? "var(--font)" : scFont;
      document.getElementById('sc-hint').style.display = 'none';
    } else {
      dt.style.display = 'none';
      if (scTexts.length === 0) document.getElementById('sc-hint').style.display = 'block';
    }
  }
}

function scConfirmText() {
  const t = document.getElementById('sc-text').value.trim();
  if (scSelectedTextId !== null) {
    // Сохраняем правку существующего блока
    const obj = scTexts.find(x=>x.id===scSelectedTextId);
    if (obj) {
      obj.color = scTextColor;
      obj.font = scFont;
      const block = document.querySelector('.sc-text-block[data-id="'+scSelectedTextId+'"]');
      if (block) {
        const span = block.querySelector('.sc-text-span');
        if (span) {
          span.style.color = scTextColor;
          const ff = scFont==='Syne'?"var(--font)":scFont==='DM Sans'?"var(--font)":scFont;
          span.style.fontFamily = ff;
        }
      }
    }
    scSelectedTextId = null;
    document.getElementById('sc-text').value = '';
  } else if (t) {
    // Создаём новый текстовый блок
    const id = Date.now();
    const obj = {id, text: t, color: scTextColor, font: scFont, left: 50, top: 45, fontSize: 26};
    scTexts.push(obj);
    scCreateTextBlock(obj);
    // Скрываем drag-text preview
    const dt = document.getElementById('sc-drag-text');
    dt.style.display = 'none'; dt.textContent = '';
    document.getElementById('sc-hint').style.display = 'none';
    document.getElementById('sc-text').value = '';
  }
  document.getElementById('sc-text-editor').style.display = 'none';
  document.getElementById('sc-style-panel').style.display = 'none';
  document.getElementById('sc-bottom').style.display = 'block';
}

function scCreateTextBlock(obj) {
  const preview = document.getElementById('sc-preview');
  const el = document.createElement('div');
  el.className = 'sc-text-block';
  el.setAttribute('data-id', obj.id);
  el.style.cssText = 'position:absolute;z-index:7;cursor:pointer;touch-action:none;user-select:none;';
  el.style.left = obj.left + '%';
  el.style.top = obj.top + '%';
  el.style.transform = 'translate(-50%,-50%)';
  const ff = obj.font==='Syne'?"var(--font)":obj.font==='DM Sans'?"var(--font)":obj.font;
  el.innerHTML = '<span class="sc-text-span" style="display:block;color:'+obj.color+';font-size:'+(obj.fontSize||26)+'px;font-weight:700;font-family:'+ff+';text-align:center;text-shadow:0 2px 12px rgba(0,0,0,.5);word-break:break-word;max-width:200px;padding:4px 8px;border-radius:6px;">'+obj.text+'</span><button class="sc-text-delete-btn" style="display:none;position:absolute;top:-12px;right:-12px;width:22px;height:22px;border-radius:50%;background:#f43f5e;border:none;color:#fff;font-size:14px;cursor:pointer;z-index:8;align-items:center;justify-content:center;line-height:1">×</button>';
  
  el.querySelector('.sc-text-delete-btn').onclick = (e) => {
    e.stopPropagation();
    scTexts = scTexts.filter(x=>x.id!==obj.id);
    el.remove();
    if (scTexts.length === 0) document.getElementById('sc-hint').style.display = 'block';
  };
  
  // Клик: выделить для редактирования
  el.onclick = (e) => {
    e.stopPropagation();
    // Снять выделение с других
    document.querySelectorAll('.sc-text-block').forEach(b => {
      b.style.outline = 'none';
      const d = b.querySelector('.sc-text-delete-btn');
      if (d) d.style.display = 'none';
    });
    el.style.outline = '2px dashed rgba(255,255,255,.6)';
    el.style.outlineOffset = '4px';
    const del = el.querySelector('.sc-text-delete-btn');
    if (del) del.style.display = 'flex';
    scSelectedTextId = obj.id;
    scTextColor = obj.color;
    scFont = obj.font;
    document.getElementById('sc-text').value = obj.text;
    document.getElementById('sc-text-editor').style.display = 'block';
    setTimeout(()=>document.getElementById('sc-text').focus(),50);
  };
  
  // Перетаскивание
  let ox=0,oy=0,ex=0,ey=0,moved=false,dragging=false;
  function onDragMove(e) {
    const cx=e.touches?e.touches[0].clientX:e.clientX;
    const cy=e.touches?e.touches[0].clientY:e.clientY;
    const dx=cx-ox,dy=cy-oy;
    if (!dragging && (Math.abs(dx)>5||Math.abs(dy)>5)) dragging=true;
    if (!dragging) return;
    e.preventDefault();
    moved=true;
    const p=el.parentElement.getBoundingClientRect();
    const px=Math.max(5,Math.min(95,((ex+dx)/p.width)*100));
    const py=Math.max(5,Math.min(95,((ey+dy)/p.height)*100));
    el.style.left=px+'%'; el.style.top=py+'%';
    obj.left=px; obj.top=py;
  }
  function onDragEnd(e) {
    document.removeEventListener('mousemove',onDragMove);
    document.removeEventListener('mouseup',onDragEnd);
    document.removeEventListener('touchmove',onDragMove);
    document.removeEventListener('touchend',onDragEnd);
    dragging=false;
  }
  function onDragStart(e) {
    dragging=false; moved=false;
    ox=e.touches?e.touches[0].clientX:e.clientX;
    oy=e.touches?e.touches[0].clientY:e.clientY;
    const p=el.parentElement.getBoundingClientRect();
    ex=(parseFloat(el.style.left)/100)*p.width;
    ey=(parseFloat(el.style.top)/100)*p.height;
    document.addEventListener('mousemove',onDragMove);
    document.addEventListener('mouseup',onDragEnd);
    document.addEventListener('touchmove',onDragMove,{passive:false});
    document.addEventListener('touchend',onDragEnd);
  }
  el.addEventListener('mousedown',onDragStart);
  el.addEventListener('touchstart',onDragStart,{passive:true});
  
  preview.appendChild(el);
}

function scToggleStylePanel() {
  const p = document.getElementById('sc-style-panel');
  p.style.display = p.style.display === 'none' ? 'block' : 'none';
}

function scSetColor(c) {
  scTextColor = c;
  document.getElementById('sc-drag-text').style.color = c;
  // Обновляем цвет редактируемого блока
  if (scSelectedTextId !== null) {
    const block = document.querySelector('.sc-text-block[data-id="'+scSelectedTextId+'"]');
    if (block) { const sp = block.querySelector('.sc-text-span'); if (sp) sp.style.color = c; }
    const obj = scTexts.find(x=>x.id===scSelectedTextId);
    if (obj) obj.color = c;
  }
  document.querySelectorAll('.sc-color-dot').forEach(d=>d.classList.remove('sel'));
  event.target.classList.add('sel');
}

function scSetFont(f) {
  scFont = f;
  const dt = document.getElementById('sc-drag-text');
  const ff = f==='Syne'?"var(--font)":f==='DM Sans'?"var(--font)":f;
  dt.style.fontFamily = ff;
  // Обновляем шрифт редактируемого блока
  if (scSelectedTextId !== null) {
    const block = document.querySelector('.sc-text-block[data-id="'+scSelectedTextId+'"]');
    if (block) { const sp = block.querySelector('.sc-text-span'); if (sp) sp.style.fontFamily = ff; }
    const obj = scTexts.find(x=>x.id===scSelectedTextId);
    if (obj) obj.font = f;
  }
  document.querySelectorAll('.sc-font-btn').forEach(b=>b.classList.remove('sel'));
  event.target.classList.add('sel');
  scUpdateText();
}

function closeStoryCreator() {
  document.getElementById('story-creator').classList.remove('active');
  document.getElementById('sc-preview-vid').pause();
  clearInterval(scRecTimer);
  if (scMediaRecorder && scMediaRecorder.state !== 'inactive') scMediaRecorder.stop();
  if (scCameraStream) { scCameraStream.getTracks().forEach(t=>t.stop()); scCameraStream = null; }
  document.getElementById('sc-camera').style.display = 'none';
  renderStories();
  renderFeed();
}

function scPickBg() {
  if (scMediaUrl) return;
  scBgIdx = (scBgIdx+1) % scBgs.length;
  document.getElementById('sc-preview').style.background = scBgs[scBgIdx];
  document.getElementById('sc-bottom').style.display = 'block';
}

function scPickMedia() {
  document.getElementById('sc-media-input').click();
}

function scMediaChosen(e) {
  const file = e.target.files[0];
  if (!file) return;
  const isVideo = file.type.startsWith('video/');
  scMediaType = isVideo ? 'video' : 'image';
  if (scCameraStream) { scCameraStream.getTracks().forEach(t=>t.stop()); scCameraStream = null; }
  document.getElementById('sc-camera').style.display = 'none';
  document.getElementById('sc-cam-controls').style.display = 'none';
  const reader = new FileReader();
  reader.onload = ev => {
    scMediaUrl = ev.target.result;
    if (isVideo) {
      const vid = document.getElementById('sc-preview-vid');
      vid.src = scMediaUrl; vid.style.display = 'block';
      document.getElementById('sc-preview-img').style.display = 'none';
      document.getElementById('sc-bg-btn').style.display = 'none';
      document.getElementById('sc-preview').style.background = '#000';
    } else {
      const img = document.getElementById('sc-preview-img');
      img.src = scMediaUrl; img.style.display = 'block';
      document.getElementById('sc-preview-vid').style.display = 'none';
      document.getElementById('sc-bg-btn').style.display = 'none';
    }
    document.getElementById('sc-bottom').style.display = 'block';
    document.getElementById('sc-hint').style.display = 'none';
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

async function publishStory() {
  const t = document.getElementById('sc-text').value.trim();
  if (!t && !scMediaUrl) { showToast('Добавь текст или медиа'); return; }

  const today = new Date().toDateString();
  const todayStories = myStories.filter(s => new Date(s.publishedAt).toDateString() === today);
  if (todayStories.length >= 6) {
    showToast('Максимум 6 историй в день. Лимит исчерпан.');
    return;
  }

  const btn = document.getElementById('sc-publish-btn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.style.opacity = '0.4';
  btn.textContent = 'Публикую…';

  const dt = document.getElementById('sc-drag-text');
  const textLeft = dt.style.left || '50%';
  const textTop = dt.style.top || '45%';

  const allTextBlocks = scTexts.length > 0 ? scTexts.map(obj => ({
    text: obj.text, color: obj.color, font: obj.font,
    left: obj.left+'%', top: obj.top+'%', fontSize: obj.fontSize||26
  })) : (t ? [{text: t, color: scTextColor, font: scFont, left: textLeft, top: textTop, fontSize: 26}] : []);

  try {
    let mediaId;
    if (scMediaUrl) {
      const blob = await mxUrlToBlob(scMediaUrl);
      mediaId = (await MchatAPI.uploadMedia(scMediaType === 'video' ? 'video' : 'image', blob, {})).id;
    }
    const r = await MchatAPI.createStory({ mediaId: mediaId, bg: scBgs[scBgIdx], textBlocks: allTextBlocks });
    myStories.push(storyFromServer(r.story));
    closeStoryCreator();
    updateProfileUI();
    renderStories();
    renderFeed();
    showToast('История опубликована');
  } catch (e) {
    showToast(MchatAPI.errorText(e));
  } finally {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = originalText;
  }
}

// ============================================================
// POST CREATION
// ============================================================
let pendingPostMedia = null;

function addPostWithMedia() {
  document.getElementById('post-media-sheet').classList.add('active');
}

function closePostMediaSheet() {
  document.getElementById('post-media-sheet').classList.remove('active');
}

function pickPostPhoto() {
  closePostMediaSheet();
  document.getElementById('post-photo-input').click();
}

function pickPostVideo() {
  closePostMediaSheet();
  document.getElementById('post-video-input').click();
}

function postPhotoChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingPostMedia = {type:'image', url: URL.createObjectURL(file), file: file};
  openPostCreatorModal();
}

function postVideoChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  pendingPostMedia = {type:'video', url: URL.createObjectURL(file), file: file};
  openPostCreatorModal();
}

function pcHighlightHashtags(textarea) {
  const val = textarea.value;
  const row = document.getElementById('pc-hashtag-row');
  if (row) row.style.display = val.includes('#') || val.length === 0 ? 'block' : 'none';
}

function pcAddTag(tag) {
  const ta = document.getElementById('pc-caption');
  if (!ta) return;
  const v = ta.value;
  ta.value = v + (v && !v.endsWith(' ') ? ' ' : '') + tag + ' ';
  ta.focus();
  document.getElementById('pc-hashtag-row').style.display = 'block';
}

let pcIsPublic = true;
function pcTogglePrivacy(btn) {
  btn.classList.toggle('on');
  pcIsPublic = btn.classList.contains('on');
  pcUpdatePrivacyUI(pcIsPublic);
}
function pcUpdatePrivacyUI(isPublic) {
  pcIsPublic = isPublic;
  const label = document.getElementById('pc-privacy-label');
  const sub = document.getElementById('pc-privacy-sub');
  const ico = document.getElementById('pc-privacy-ico');
  if (label) label.textContent = isPublic ? 'Для всех' : 'Только для меня';
  if (sub) sub.textContent = isPublic ? 'Виден всем пользователям' : 'Только ты видишь этот пост';
  if (ico) {
    ico.setAttribute('stroke', isPublic ? 'var(--text2)' : '#f43f5e');
    ico.innerHTML = isPublic ? '<circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/>' : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>';
  }
}

function openCoverSelector() {
  const sel = document.getElementById('pc-video-cover-selector');
  if (!sel) return;
  sel.style.display = 'flex';
  const slider = document.getElementById('pc-video-slider');
  if (slider) slider.value = 0;
  if (pendingPostMedia?.url) {
    extractVideoThumbnail(pendingPostMedia.url, 0).then(thumb => {
      if (thumb) { const p = document.getElementById('pc-cover-preview'); if(p) p.src = thumb; }
    });
  }
}

let currentProfileTab = 'posts';
function switchProfileTab(tab) {
  currentProfileTab = tab;
  document.querySelectorAll('.ptab').forEach(b => {
    const isActive = b.id === 'ptab-' + tab;
    b.style.color = isActive ? 'var(--text)' : 'var(--text2)';
    b.style.borderBottomColor = isActive ? 'var(--accent)' : 'transparent';
    b.style.fontWeight = isActive ? '600' : '500';
  });
  renderProfileTabContent();
}

function renderProfileTabContent() {
  const cont = document.getElementById('profile-tab-content');
  if (!cont || !currentUser) return;
  
  if (currentProfileTab === 'posts') {
    cont.innerHTML = '<div class="profile-grid" id="profile-grid"></div>';
    renderProfileGrid();
    return;
  }
  
  if (currentProfileTab === 'likes') {
    const liked = posts.filter(p => p.liked);
    if (liked.length === 0) {
      cont.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text2);font-size:14px">Ты ещё не лайкал посты</div>';
      return;
    }
    let html = '<div class="profile-grid">';
    liked.forEach(p => {
      if (p.mediaType === 'image' && p.mediaUrl) {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})"><img src="${p.mediaUrl}"></div>`;
      } else if (p.mediaType === 'video' && p.thumbnail) {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="position:relative"><img src="${p.thumbnail}" style="width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><svg width="12" height="12" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div>`;
      } else {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="background:var(--surf2);display:flex;align-items:center;justify-content:center"><svg width="20" height="20" fill="#f43f5e" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg></div>`;
      }
    });
    html += '</div>';
    cont.innerHTML = html;
    return;
  }
  
  if (currentProfileTab === 'activity') {
    const myReposts = (repostsByUser[currentUser.username] || []).map(r => ({
      postId: r.id, fromUser: r.username, time: r.time, postText: r.text, mediaUrl: r.mediaUrl, mediaType: r.mediaType, thumbnail: r.thumbnail }));
    if (!repostsByUser[currentUser.username]) fetchUserReposts(currentUser.username).then(() => { if (currentProfileTab === 'activity') renderProfileTabContent(); }).catch(() => {});
    const myComments = [];
    posts.forEach(p => {
      if (Array.isArray(p.comments)) {
        p.comments.filter(c => c.username === currentUser.username).forEach(c => {
          myComments.push({postId: p.id, postName: p.name, text: c.text, time: c.time});
        });
      }
    });
    if (myComments.length === 0 && myReposts.length === 0) {
      cont.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text2);font-size:14px">Нет активности. Прокомментируй или репостни посты!</div>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:8px;padding:12px 0">';
    if (myReposts.length > 0) {
      html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:4px 2px;margin-bottom:4px">Репосты</div>`;
      myReposts.slice(0,10).forEach(r => {
        // Превью медиа
        let mediaPrev = '';
        if (r.mediaType === 'image' && r.mediaUrl) {
          mediaPrev = `<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0"><img src="${r.mediaUrl}" style="width:100%;height:100%;object-fit:cover"></div>`;
        } else if (r.mediaType === 'video' && r.thumbnail) {
          mediaPrev = `<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0;position:relative"><img src="${r.thumbnail}" style="width:100%;height:100%;object-fit:cover"><div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center"><div style="width:18px;height:18px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center"><svg width="8" height="8" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div></div>`;
        } else if (r.mediaType === 'video' && r.mediaUrl) {
          mediaPrev = `<div style="width:48px;height:48px;border-radius:8px;background:var(--surf2);flex-shrink:0;display:flex;align-items:center;justify-content:center"><svg width="18" height="18" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg></div>`;
        }
        const postText = r.postText && r.postText.trim() ? r.postText : '';
        html += `<div onclick="openPostViewer(${r.postId})" style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surf);border-radius:12px;margin:0 0 2px;cursor:pointer">
          <svg width="16" height="16" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          ${mediaPrev}
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:var(--text2);margin-bottom:2px">@${esc(r.fromUser)} · ${esc(r.time)}</div>
            ${postText ? `<div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(postText)}</div>` : '<div style="font-size:12px;color:var(--text2)">Медиа-контент</div>'}
          </div>
        </div>`;
      });
    }
    if (myComments.length > 0) {
      html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:8px 2px 4px;margin-top:4px">Комментарии</div>`;
      myComments.slice(-20).reverse().forEach(c => {
        html += `<div onclick="openPostViewer(${c.postId})" style="display:flex;align-items:flex-start;gap:10px;padding:12px;background:var(--surf);border-radius:12px;cursor:pointer;margin:0 0 2px">
          <svg width="16" height="16" fill="none" stroke="var(--text2)" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:2px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:var(--text2);margin-bottom:3px">${esc(c.postName)} · ${esc(c.time)}</div>
            <div style="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.text)}</div>
          </div>
        </div>`;
      });
    }
    html += '</div>';
    cont.innerHTML = html;
    return;
  }
  
  if (currentProfileTab === 'archive') {
    const archived = posts.filter(p => p.username === currentUser.username && p.privacy === 'private');
    if (archived.length === 0) {
      cont.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--text2);font-size:14px">Архив пуст</div>';
      return;
    }
    let html = '<div class="profile-grid">';
    archived.forEach(p => {
      if (p.mediaType === 'image' && p.mediaUrl) {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="opacity:.7"><img src="${p.mediaUrl}"></div>`;
      } else {
        html += `<div class="grid-item" onclick="openPostViewer(${p.id})" style="background:var(--surf2);display:flex;align-items:center;justify-content:center;opacity:.7"><svg width="20" height="20" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>`;
      }
    });
    html += '</div>';
    cont.innerHTML = html;
  }
}

function openPostCreatorModal() {
  if (!pendingPostMedia) return;
  const modal = document.getElementById('post-creator-modal');
  const preview = document.getElementById('pc-media-preview');
  const imgEl = document.getElementById('pc-media-img');
  const vidEl = document.getElementById('pc-media-vid');
  const coverOverlay = document.getElementById('pc-cover-overlay');
  
  if (pendingPostMedia.type === 'image') {
    imgEl.src = pendingPostMedia.url;
    imgEl.style.display = 'block';
    vidEl.style.display = 'none';
    if (coverOverlay) coverOverlay.style.display = 'none';
  } else {
    vidEl.src = pendingPostMedia.url;
    vidEl.style.display = 'block';
    imgEl.style.display = 'none';
    extractVideoThumbnail(pendingPostMedia.url, 0).then(thumb => {
      if (thumb) {
        pcVideoCoverData = thumb;
        pendingPostMedia.thumbnail = thumb;
        const coverImgPreview = document.getElementById('pc-cover-img-preview');
        if (coverImgPreview) { coverImgPreview.src = thumb; coverImgPreview.style.display = 'block'; }
        if (coverOverlay) coverOverlay.style.display = 'flex';
        vidEl.style.opacity = '0';
      }
    });
  }
  preview.style.display = 'block';
  document.getElementById('pc-caption').value = '';
  document.getElementById('pc-upload-bar').style.display = 'none';
  document.getElementById('pc-hashtag-row').style.display = 'none';
  const tgl = document.getElementById('pc-privacy-tgl');
  if (tgl) { tgl.classList.add('on'); }
  pcUpdatePrivacyUI(true);
  modal.classList.add('active');
}

function closePostCreator() {
  document.getElementById('post-creator-modal').classList.remove('active');
  pendingPostMedia = null;
}

async function pcPublishPost() {
  const caption = document.getElementById('pc-caption').value.trim();
  if (!caption && !pendingPostMedia) { showToast('Добавь описание или медиа'); return; }

  const btn = document.getElementById('pc-submit-btn');
  const isPublic = document.getElementById('pc-privacy-tgl')?.classList.contains('on') ?? true;
  btn.disabled = true;
  btn.style.opacity = '.5';

  const uploadBar = document.getElementById('pc-upload-bar');
  const uploadFill = document.getElementById('pc-upload-fill');
  const uploadPct = document.getElementById('pc-upload-pct');
  const uploadLabel = document.getElementById('pc-upload-label');
  const setProgress = (pct) => { uploadFill.style.width = pct + '%'; uploadPct.textContent = Math.floor(pct) + '%'; };
  uploadBar.style.display = 'block';
  setProgress(0);

  const media = pendingPostMedia;
  try {
    let mediaId, thumbId;
    if (media && media.file) {
      uploadLabel.textContent = media.type === 'video' ? 'Загрузка видео...' : 'Загрузка фото...';
      const up = await MchatAPI.uploadMedia(media.type === 'video' ? 'video' : 'image', media.file, { onProgress: pct => setProgress(pct * 0.95) });
      mediaId = up.id;
      if (media.type === 'video' && media.thumbnail) {
        const thumbBlob = await mxUrlToBlob(media.thumbnail);
        thumbId = (await MchatAPI.uploadMedia('image', thumbBlob, {})).id;
      }
    }
    uploadLabel.textContent = 'Публикация...';
    const r = await MchatAPI.createPost({ text: caption, mediaId: mediaId, thumbId: thumbId, privacy: isPublic ? 'public' : 'private' });
    setProgress(100);
    posts.unshift(postFromServer(r.post));
    postsByUser[currentUser.username] = posts.filter(p => p.username === currentUser.username);
    if (media && media.url && media.url.startsWith('blob:')) URL.revokeObjectURL(media.url);
    closePostCreator();
    document.getElementById('new-post-text').value = '';
    renderFeed(); updateProfileUI();
    showToast('Пост опубликован!');
  } catch (e) {
    uploadBar.style.display = 'none';
    showToast(MchatAPI.errorText(e));
  } finally {
    btn.disabled = false; btn.style.opacity = '1';
  }
}

async function addPost() {
  const text = document.getElementById('new-post-text').value.trim();
  if (!text) return;
  try {
    const r = await MchatAPI.createPost({ text: text, privacy: 'public' });
    posts.unshift(postFromServer(r.post));
    document.getElementById('new-post-text').value = '';
    renderFeed(); updateProfileUI();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

function renderFeed() {
  const container = document.getElementById('posts-container');
  if (!container) return;
  if (posts.length===0) { container.innerHTML='<div style="text-align:center;padding:40px 20px;color:var(--text2)">Нет постов. Напиши первый!</div>'; return; }
  let html = '';
  posts.forEach(post => {
    if (post.privacy === 'private' && post.username !== currentUser?.username) return;
    // Скрываем старые дубликаты-репосты (isRepost=true) — они больше не нужны
    if (post.isRepost) return;
    const av = post.avatar ? `<img src="${post.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : `<svg width="18" height="18" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    // Показываем метку репоста если текущий пользователь репостнул этот пост
    const repostedByMe = post.repostedBy && post.repostedBy.includes(currentUser?.username);
    const repostBadge = repostedByMe ? `<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);padding:4px 16px 0"><svg width="13" height="13" fill="none" stroke="var(--accent)" stroke-width="2" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> <span style="color:var(--accent)">Ты репостнул</span></div>` : '';
    const media = post.mediaType==='image'&&post.mediaUrl
      ? `<div class="post-img-wrap" style="position:relative" onclick="handlePostMediaClick(${post.id},event)"><img src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover"></div>`
      : post.mediaType==='video'&&post.mediaUrl
      ? `<div class="post-img-wrap" style="position:relative" onclick="handlePostMediaClick(${post.id},event)"><video src="${post.mediaUrl}" style="width:100%;height:100%;object-fit:cover" muted playsinline loop autoplay></video><div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;pointer-events:none"><svg width="18" height="18" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div></div>`
      : '';
    const cmtCount = Array.isArray(post.comments)?post.comments.length:post.comments||0;
    html += `<div class="post-item">
      ${repostBadge}
      <div class="post-head" onclick="goToUserOrOwnProfile('${post.username}')" style="cursor:pointer">
        <div class="post-av"><div class="post-avi">${av}</div></div>
        <div><div style="font-weight:500;font-size:14px;display:flex;align-items:center;gap:5px">${esc(post.name)}${post.verified ? ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : ''}</div><div style="font-size:11px;color:var(--text2)">${post.time}</div></div>
      </div>
      ${media}
      ${post.text?`<div class="post-caption"><span>${esc(post.text)}</span></div>`:''}
      <div class="post-actions">
        <button class="ab ${post.liked?'liked':''}" onclick="toggleLike(${post.id})">
          <svg fill="${post.liked?'currentColor':'none'}" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
          <span>${post.likes}</span>
        </button>
        <button class="ab" onclick="openPostViewer(${post.id})">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          <span>${cmtCount}</span>
        </button>
        <button class="ab ${repostedByMe?'liked':''}" onclick="sharePostFromFeed(${post.id})" style="${repostedByMe?'color:var(--accent)':''}">
          <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        </button>
      </div>
    </div>`;
  });
  container.innerHTML = html;
}

let _postMediaClickTimers = {};
function handlePostMediaClick(id, event) {
  const wrap = event ? event.currentTarget : null;
  if (_postMediaClickTimers[id]) {
    clearTimeout(_postMediaClickTimers[id]);
    _postMediaClickTimers[id] = null;
    doubleTapLike(id, wrap);
  } else {
    _postMediaClickTimers[id] = setTimeout(() => {
      _postMediaClickTimers[id] = null;
      openPostViewer(id);
    }, 280);
  }
}

function doubleTapLike(id, wrap) {
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  if (!p.liked) toggleLike(id);
  showHeartBurst(wrap);
}

function showHeartBurst(wrap) {
  if (!wrap) return;
  const heart = document.createElement('div');
  heart.className = 'heart-burst';
  heart.innerHTML = `<svg width="80" height="80" fill="#fff" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>`;
  wrap.appendChild(heart);
  setTimeout(() => heart.remove(), 800);
}

function toggleLike(id) {
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  p.liked = !p.liked; p.likes += p.liked?1:-1;
  if (p.liked) pushNotif('Вам понравился пост от ' + (p.name||p.username));
  mxSendLike(p); renderFeed();
  if (document.getElementById('post-viewer').classList.contains('active') && pvCurrentId===id) {
    document.getElementById('pv-like-count').textContent = p.likes;
    document.getElementById('pv-like-ico').setAttribute('fill', p.liked?'#f43f5e':'none');
    document.getElementById('pv-like-btn').className = 'ab '+(p.liked?'liked':'');
  }
  if (document.getElementById('s-video-reels').classList.contains('active') && reelsCurrentId===id) {
    document.getElementById('reels-like-count').textContent = p.likes;
    const likeIco = document.getElementById('reels-like-ico');
    likeIco.setAttribute('fill', p.liked?'#f43f5e':'none');
    likeIco.setAttribute('stroke', p.liked?'#f43f5e':'#fff');
  }
}

function sharePostFromFeed(postId) {
  const p = posts.find(x=>x.id===postId);
  if (!p) return;
  const sheet = document.createElement('div');
  sheet.className = 'sheet active';
  sheet.style.zIndex = '800';
  sheet.onclick = e => { if(e.target===sheet) sheet.remove(); };
  sheet.innerHTML = `<div class="sheet-body">
    <div style="width:36px;height:4px;background:var(--surf2);border-radius:4px;margin:0 auto 16px"></div>
    <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:14px">Поделиться</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:16px">
      <div onclick="this.closest('.sheet').remove();repostFromFeed(${postId})" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
        <div style="width:52px;height:52px;border-radius:16px;background:#4a4af022;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" fill="none" stroke="#4a4af0" stroke-width="2" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
        </div>
        <div style="font-size:11px;color:var(--text2)">Репост</div>
      </div>
      <div onclick="this.closest('.sheet').remove();navigator.clipboard&&navigator.clipboard.writeText('mchat://post/'+${p.id}).catch(()=>{});showToast('Ссылка скопирована')" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
        <div style="width:52px;height:52px;border-radius:16px;background:#10b98122;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" fill="none" stroke="#10b981" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
        </div>
        <div style="font-size:11px;color:var(--text2)">Скопировать</div>
      </div>
      <div onclick="this.closest('.sheet').remove();showShareInChat(${postId})" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
        <div style="width:52px;height:52px;border-radius:16px;background:#2196F322;display:flex;align-items:center;justify-content:center">
          <svg width="22" height="22" fill="none" stroke="#2196F3" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <div style="font-size:11px;color:var(--text2)">В чат</div>
      </div>
    </div>
    <button onclick="this.closest('.sheet').remove()" style="width:100%;padding:13px;border-radius:14px;border:none;background:var(--surf);color:var(--text2);font-family:var(--font);font-size:15px;cursor:pointer">Отмена</button>
  </div>`;
  document.getElementById('app').appendChild(sheet);
}

async function mxDoRepost(p) {
  if (!p) return;
  if (p.username === currentUser.username) { showToast('Нельзя репостить свой пост'); return; }
  if (p.repostedBy && p.repostedBy.includes(currentUser.username)) { showToast('Ты уже репостил этот пост'); return; }
  try { await MchatAPI.repostPost(p.id); }
  catch (e) { showToast(MchatAPI.errorText(e)); return; }
  if (!p.repostedBy) p.repostedBy = [];
  p.repostedBy.push(currentUser.username);
  repostsByUser[currentUser.username] = [p].concat(repostsByUser[currentUser.username] || []);
  renderFeed(); updateProfileUI();
  showToast('Репост опубликован!');
}
function repostFromFeed(postId) { mxDoRepost(posts.find(x => x.id === postId)); }

let pvCurrentId = null;
let reelsCurrentId = null;
let reelsMediaURL = null;
let reelsIsSoundOn = true;
let reelsIsPaused = false;

function getVideoDuration(videoUrl) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.onloadedmetadata = () => { resolve(video.duration || 0); };
    video.onerror = () => resolve(60);
  });
}

function openPostViewer(id) {
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  if (p.mediaType === 'video' && p.mediaUrl) {
    openVideoReels(id);
  } else {
    openPhotoPostViewer(id);
  }
}

function openVideoReels(id) {
  const p = posts.find(x=>x.id===id);
  if (!p || !p.mediaUrl) return;
  
  reelsCurrentId = id;
  reelsMediaURL = p.mediaUrl;
  reelsIsSoundOn = true;
  reelsIsPaused = false;
  
  const vid = document.getElementById('reels-video');
  vid.pause();
  vid.removeAttribute('src');
  vid.load();
  vid.src = p.mediaUrl;
  vid.muted = false;
  vid.currentTime = 0;
  
  const reelsScreen = document.getElementById('s-video-reels');
  
  vid.onloadeddata = () => {
    const loadingEl = document.getElementById('reels-loading');
    if (loadingEl) loadingEl.remove();
    vid.play().catch(() => { showReelsTapToPlay(); });
  };
  vid.onerror = () => {
    const loadingEl = document.getElementById('reels-loading');
    if (loadingEl) loadingEl.remove();
    const wrapper = document.querySelector('#s-video-reels > div');
    if (!document.getElementById('reels-no-video')) {
      const ph = document.createElement('div');
      ph.id = 'reels-no-video';
      ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#111;z-index:3;pointer-events:none';
      ph.innerHTML = '<svg width="48" height="48" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="1.5" viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg><div style="color:rgba(255,255,255,.4);font-size:13px">Видео недоступно</div>';
      wrapper.appendChild(ph);
    }
  };
  vid.load();
  
  document.getElementById('reels-name').textContent = p.name || '@' + p.username;
  document.getElementById('reels-time').textContent = p.time || '—';
  document.getElementById('reels-caption').textContent = p.text || '—';
  document.getElementById('reels-like-count').textContent = p.likes || 0;
  document.getElementById('reels-cmt-count').textContent = (Array.isArray(p.comments) ? p.comments.length : 0);
  
  const likeIco = document.getElementById('reels-like-ico');
  likeIco.setAttribute('fill', p.liked ? '#f43f5e' : 'none');
  likeIco.setAttribute('stroke', p.liked ? '#f43f5e' : '#fff');
  
  document.getElementById('reels-delete').style.display = (currentUser && p.username === currentUser.username) ? 'flex' : 'none';
  
  reelsRenderComments();
  goTo('s-video-reels');
  // Сбрасываем флаг чтобы свайп переregistrировался
  const reelsScreenEl = document.getElementById('s-video-reels');
  if (reelsScreenEl) reelsScreenEl._swipeReady = false;
  setupReelsSwipe();
  
  const wrapper = document.querySelector('#s-video-reels > div');
  const oldLoading = document.getElementById('reels-loading');
  if (oldLoading) oldLoading.remove();
  const oldNoVid = document.getElementById('reels-no-video');
  if (oldNoVid) oldNoVid.remove();
  const loadingDiv = document.createElement('div');
  loadingDiv.id = 'reels-loading';
  loadingDiv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:4;background:rgba(0,0,0,.5);pointer-events:none';
  loadingDiv.innerHTML = '<div style="width:44px;height:44px;border:3px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite"></div>';
  if (!document.querySelector('#app style[data-spin]')) {
    const st = document.createElement('style');
    st.setAttribute('data-spin','1');
    st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
  }
  wrapper.appendChild(loadingDiv);
  
  // Добавляем обработчик для паузы по клику (не перекрываем кнопки справа и вверху)
  const videoOverlay = document.createElement('div');
  videoOverlay.id = 'reels-pause-overlay';
  // Занимаем только левую/центральную часть, правые 80px оставляем для кнопок
  videoOverlay.style.cssText = 'position:absolute;top:60px;left:0;right:80px;bottom:100px;z-index:5;cursor:pointer';
  let reelsTapCount = 0;
  let reelsTapTimer = null;
  videoOverlay.onclick = (e) => {
    e.stopPropagation();
    reelsTapCount++;
    if (reelsTapCount === 1) {
      reelsTapTimer = setTimeout(() => {
        reelsTapCount = 0;
        // Одиночный тап — пауза/воспроизведение
        const videoEl = document.getElementById('reels-video');
        if (reelsIsPaused) {
          videoEl.play();
          reelsIsPaused = false;
          const pauseIcon = document.getElementById('reels-pause-icon');
          if (pauseIcon) pauseIcon.remove();
        } else {
          videoEl.pause();
          reelsIsPaused = true;
          const icon = document.createElement('div');
          icon.id = 'reels-pause-icon';
          icon.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:50%;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:6;pointer-events:none';
          icon.innerHTML = '<svg width="32" height="32" fill="#fff" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
          document.querySelector('#s-video-reels > div').appendChild(icon);
          setTimeout(() => { if(icon) icon.remove(); }, 500);
        }
      }, 300);
    } else if (reelsTapCount === 2) {
      clearTimeout(reelsTapTimer);
      reelsTapCount = 0;
      // Двойной тап — лайк с анимацией сердечка
      const p = posts.find(x=>x.id===reelsCurrentId);
      if (p && !p.liked) {
        p.liked = true;
        p.likes = (p.likes || 0) + 1;
        mxSendLike(p);
        document.getElementById('reels-like-count').textContent = p.likes;
        const likeIco = document.getElementById('reels-like-ico');
        likeIco.setAttribute('fill', '#f43f5e');
        likeIco.setAttribute('stroke', '#f43f5e');
      }
      // Анимация большого сердца
      const heart = document.createElement('div');
      heart.style.cssText = `position:absolute;left:${e.offsetX-40}px;top:${e.offsetY-40}px;pointer-events:none;z-index:20;transition:transform .4s ease,opacity .5s ease;transform:scale(0);opacity:1`;
      heart.innerHTML = '<svg width="80" height="80" fill="#f43f5e" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>';
      document.querySelector('#s-video-reels > div').appendChild(heart);
      requestAnimationFrame(() => { heart.style.transform = 'scale(1.2)'; });
      setTimeout(() => { heart.style.opacity = '0'; heart.style.transform = 'scale(1.4)'; }, 300);
      setTimeout(() => { heart.remove(); }, 800);
    }
  };
  wrapper.appendChild(videoOverlay);
  
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      vid.play().catch(() => showReelsTapToPlay());
    });
  });
}

function showReelsTapToPlay() {
  const existing = document.getElementById('reels-tap-play');
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.id = 'reels-tap-play';
  overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:6;cursor:pointer;background:rgba(0,0,0,.2)';
  overlay.innerHTML = '<div style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.2);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center"><svg width="28" height="28" fill="#fff" viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21"/></svg></div>';
  overlay.onclick = () => {
    const vid = document.getElementById('reels-video');
    vid.play().catch(()=>{});
    overlay.remove();
  };
  document.querySelector('#s-video-reels > div').appendChild(overlay);
}

function setupReelsSwipe() {
  const screen = document.getElementById('s-video-reels');
  if (!screen || screen._swipeReady) return;
  screen._swipeReady = true;
  let startY = 0, startX = 0;
  screen.addEventListener('touchstart', e => {
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
  }, {passive:true});
  screen.addEventListener('touchend', e => {
    const dy = startY - e.changedTouches[0].clientY;
    const dx = Math.abs(startX - e.changedTouches[0].clientX);
    if (Math.abs(dy) < 60 || dx > Math.abs(dy)) return;
    const myVidPosts = posts.filter(p => p.mediaType === 'video' && p.mediaUrl && p.privacy !== 'private');
    const idx = myVidPosts.findIndex(p => p.id === reelsCurrentId);
    // свайп вверх (dy > 0) — следующее видео (вниз по списку)
    // свайп вниз (dy < 0) — предыдущее видео (вверх по списку)
    if (dy > 0 && idx < myVidPosts.length - 1) openVideoReels(myVidPosts[idx+1].id);
    else if (dy < 0 && idx > 0) openVideoReels(myVidPosts[idx-1].id);
    else if (dy < 0 && idx === 0) showToast('Это первое видео');
  }, {passive:true});
}

function reelsShare() {
  const p = posts.find(x=>x.id===reelsCurrentId);
  if (!p) return;
  if (navigator.share) {
    navigator.share({ title: p.name, text: p.text || 'Смотри это видео в Mchat!' }).catch(()=>{});
  } else {
    const sheet = document.createElement('div');
    sheet.className = 'sheet active';
    sheet.style.zIndex = '800';
    sheet.onclick = e => { if(e.target===sheet) sheet.remove(); };
    sheet.innerHTML = `<div class="sheet-body">
      <div style="width:36px;height:4px;background:var(--surf2);border-radius:4px;margin:0 auto 16px"></div>
      <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:14px">Поделиться</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
        <div onclick="this.closest('.sheet').remove();reelsRepost()" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
          <div style="width:52px;height:52px;border-radius:16px;background:#4a4af022;display:flex;align-items:center;justify-content:center">
            <svg width="22" height="22" fill="none" stroke="#4a4af0" stroke-width="2" viewBox="0 0 24 24"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
          </div>
          <div style="font-size:11px;color:var(--text2)">Репост</div>
        </div>
        <div onclick="this.closest('.sheet').remove();navigator.clipboard&&navigator.clipboard.writeText('mchat://post/'+${p.id}).catch(()=>{});showToast('Ссылка скопирована')" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
          <div style="width:52px;height:52px;border-radius:16px;background:#10b98122;display:flex;align-items:center;justify-content:center">
            <svg width="22" height="22" fill="none" stroke="#10b981" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          </div>
          <div style="font-size:11px;color:var(--text2)">Скопировать</div>
        </div>
        <div onclick="this.closest('.sheet').remove();showShareInChat(${p.id})" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
          <div style="width:52px;height:52px;border-radius:16px;background:#2196F322;display:flex;align-items:center;justify-content:center">
            <svg width="22" height="22" fill="none" stroke="#2196F3" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </div>
          <div style="font-size:11px;color:var(--text2)">В чат</div>
        </div>
        <div onclick="this.closest('.sheet').remove();reelsDownload()" style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer">
          <div style="width:52px;height:52px;border-radius:16px;background:#8b5cf622;display:flex;align-items:center;justify-content:center">
            <svg width="22" height="22" fill="none" stroke="#8b5cf6" stroke-width="2" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div style="font-size:11px;color:var(--text2)">Скачать</div>
        </div>
      </div>
      <button onclick="this.closest('.sheet').remove()" style="width:100%;padding:13px;border-radius:14px;border:none;background:var(--surf);color:var(--text2);font-family:var(--font);font-size:15px;cursor:pointer">Отмена</button>
    </div>`;
    document.getElementById('app').appendChild(sheet);
  }
}

function showShareInChat(postId) {
  const p = posts.find(x=>x.id===postId);
  if (!p) return;
  if (chats.length === 0) { showToast('Нет активных чатов'); return; }
  const sheet = document.createElement('div');
  sheet.className = 'sheet active';
  sheet.style.zIndex = '800';
  sheet.onclick = e => { if(e.target===sheet) sheet.remove(); };
  let chatHtml = chats.slice(0,8).map(ch => `
    <div onclick="this.closest('.sheet').remove();sendPostToChat('${ch.id}',${postId})" style="display:flex;align-items:center;gap:12px;padding:10px;background:var(--surf);border-radius:12px;cursor:pointer;margin-bottom:6px">
      <div style="width:42px;height:42px;border-radius:50%;background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">${ch.avatar?`<img src="${esc(ch.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">`:
      `<svg width="20" height="20" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`}</div>
      <div style="font-size:14px;font-weight:500">${esc(ch.name)}</div>
    </div>`).join('');
  sheet.innerHTML = `<div class="sheet-body">
    <div style="width:36px;height:4px;background:var(--surf2);border-radius:4px;margin:0 auto 16px"></div>
    <div style="font-family:var(--font);font-size:17px;font-weight:800;margin-bottom:14px">Отправить в чат</div>
    <div style="max-height:280px;overflow-y:auto">${chatHtml}</div>
    <button onclick="this.closest('.sheet').remove()" style="width:100%;padding:13px;border-radius:14px;border:none;background:var(--surf);color:var(--text2);font-family:var(--font);font-size:15px;cursor:pointer;margin-top:8px">Отмена</button>
  </div>`;
  document.getElementById('app').appendChild(sheet);
}

async function sendPostToChat(chatId, postId) {
  const p = posts.find(x=>x.id===postId);
  if (!p) return;
  const text = ('[Пост] от @'+p.username+': '+( p.text||'[медиа]')).slice(0, 1000);
  try {
    const m = await MchatAPI.sendMessage(chatId, text, MchatAPI.newClientId());
    onIncomingMessage(m);
    showToast('Пост отправлен в чат');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

function reelsDownload() {
  const p = posts.find(x=>x.id===reelsCurrentId);
  if (!p || !p.mediaUrl) { showToast('Нет видео для скачивания'); return; }
  try {
    const a = document.createElement('a');
    a.href = p.mediaUrl;
    a.download = 'mchat_video_' + Date.now() + '.mp4';
    a.click();
    showToast('Скачивание началось');
  } catch(e) {
    showToast('Не удалось скачать видео');
  }
}

function reelsRepost() { mxDoRepost(posts.find(x => x.id === reelsCurrentId)); }

function closeVideoReels() {
  const vid = document.getElementById('reels-video');
  if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
  const tapPlay = document.getElementById('reels-tap-play');
  if (tapPlay) tapPlay.remove();
  const loadingEl = document.getElementById('reels-loading');
  if (loadingEl) loadingEl.remove();
  const noVidEl = document.getElementById('reels-no-video');
  if (noVidEl) noVidEl.remove();
  const pauseOverlay = document.getElementById('reels-pause-overlay');
  if (pauseOverlay) pauseOverlay.remove();
  const pauseIcon = document.getElementById('reels-pause-icon');
  if (pauseIcon) pauseIcon.remove();
  reelsCurrentId = null;
  goTo('s-feed');
}

function reelsToggleLike() {
  const p = posts.find(x=>x.id===reelsCurrentId);
  if (!p) return;
  p.liked = !p.liked;
  p.likes = (p.likes || 0) + (p.liked ? 1 : -1);
  mxSendLike(p);
  document.getElementById('reels-like-count').textContent = p.likes;
  const likeIco = document.getElementById('reels-like-ico');
  likeIco.setAttribute('fill', p.liked ? '#f43f5e' : 'none');
  likeIco.setAttribute('stroke', p.liked ? '#f43f5e' : '#fff');
}

function reelsToggleSound() {
  const vid = document.getElementById('reels-video');
  reelsIsSoundOn = !reelsIsSoundOn;
  vid.muted = !reelsIsSoundOn;
  const soundBtn = document.getElementById('reels-sound-ico');
  soundBtn.style.opacity = reelsIsSoundOn ? '1' : '0.5';
}

function reelsOpenComments() {
  document.getElementById('reels-comments-sheet').classList.add('active');
}

function closeReelsComments() {
  document.getElementById('reels-comments-sheet').classList.remove('active');
}

function reelsRenderComments() {
  const p = posts.find(x=>x.id===reelsCurrentId);
  if (!p) return;
  const cmts = Array.isArray(p.comments) ? p.comments : [];
  const el = document.getElementById('reels-comments-list');
  if (cmts.length === 0) {
    el.innerHTML = '<div style="color:var(--text2);font-size:13px">Пока нет комментариев. Будь первым!</div>';
    return;
  }
  el.innerHTML = cmts.map(c => `
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">${c.username.charAt(0).toUpperCase()}</div>
      <div style="flex:1;background:var(--surf);border-radius:14px;padding:8px 12px">
        <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:2px">@${esc(c.username)}</div>
        <div style="font-size:13px;line-height:1.4">${esc(c.text)}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:3px">${c.time}</div>
      </div>
    </div>`).join('');
}

async function reelsSendComment() {
  const input = document.getElementById('reels-comment-input');
  const text = input.value.trim();
  if (!text || !reelsCurrentId) return;
  const p = posts.find(x=>x.id===reelsCurrentId);
  if (!p) return;
  try {
    const r = await MchatAPI.commentPost(p.id, text);
    if (!Array.isArray(p.comments)) p.comments = [];
    p.comments.push(commentFromServer(r.comment));
    reelsRenderComments();
    input.value = '';
    showToast('Комментарий отправлен');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

function reelsDelete() {
  showConfirm('Удалить пост?', async () => {
    const id = reelsCurrentId;
    try { await MchatAPI.deletePost(id); } catch (e) { showToast(MchatAPI.errorText(e)); return; }
    posts = posts.filter(p => p.id !== id);
    closeVideoReels();
    renderFeed();
    updateProfileUI();
    showToast('Пост удалён');
  });
}

function openPhotoPostViewer(id) {
  pvCurrentId = id;
  const p = posts.find(x=>x.id===id);
  if (!p) return;
  const av = p.avatar ? `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover">` : `<svg width="18" height="18" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  document.getElementById('pv-av').innerHTML = av;
  document.getElementById('pv-name').textContent = p.name;
  document.getElementById('pv-time').textContent = p.time;
  document.getElementById('pv-delete-btn').style.display = (currentUser && p.username === currentUser.username) ? 'flex' : 'none';
  const iw = document.getElementById('pv-img-wrap');
  const vw = document.getElementById('pv-vid-wrap');
  const vid = document.getElementById('pv-vid');
  if (p.mediaType==='image' && p.mediaUrl) {
    iw.style.display='block'; vw.style.display='none';
    document.getElementById('pv-img').src = p.mediaUrl;
    vid.pause(); vid.src='';
    setTimeout(()=>setupPinchZoom(document.getElementById('pv-img')),100);
  } else {
    iw.style.display='none'; vw.style.display='none';
    vid.pause(); vid.src='';
  }
  let cap = '';
  if (p.text) cap += `<div style="margin-bottom:6px"><b style="color:var(--text)">${esc(p.name)}</b> <span style="color:var(--text2)">${esc(p.text)}</span></div>`;
  document.getElementById('pv-caption').innerHTML = cap;
  document.getElementById('pv-like-count').textContent = p.likes;
  document.getElementById('pv-like-ico').setAttribute('fill', p.liked?'#f43f5e':'none');
  document.getElementById('pv-like-btn').className = 'ab '+(p.liked?'liked':'');
  pvRenderComments();
  document.getElementById('post-viewer').classList.add('active');
}

function closePostViewer() {
  document.getElementById('post-viewer').classList.remove('active');
  const vid = document.getElementById('pv-vid');
  if (vid) { vid.pause(); vid.src=''; }
  pvCurrentId = null;
}

function confirmDeletePost() {
  showConfirm('Удалить пост?', async () => {
    const id = pvCurrentId;
    try { await MchatAPI.deletePost(id); } catch (e) { showToast(MchatAPI.errorText(e)); return; }
    posts = posts.filter(p => p.id !== id);
    closePostViewer(); renderFeed(); updateProfileUI();
    showToast('Пост удалён');
  });
}

function pvToggleLike() { if(pvCurrentId) toggleLike(pvCurrentId); }

function pvRenderComments() {
  const p = posts.find(x=>x.id===pvCurrentId);
  if (!p) return;
  const cmts = Array.isArray(p.comments)?p.comments:[];
  const el = document.getElementById('pv-comments');
  if (cmts.length===0) { el.innerHTML='<div style="color:var(--text2);font-size:13px">Пока нет комментариев. Будь первым!</div>'; return; }
  el.innerHTML = cmts.map(c=>`
    <div style="display:flex;gap:10px;align-items:flex-start">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--surf2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px">${c.username.charAt(0).toUpperCase()}</div>
      <div style="flex:1;background:var(--surf);border-radius:14px;padding:8px 12px">
        <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:2px">@${esc(c.username)}</div>
        <div style="font-size:13px;line-height:1.4">${esc(c.text)}</div>
        <div style="font-size:10px;color:var(--text2);margin-top:3px">${c.time}</div>
      </div>
    </div>`).join('');
}

async function pvSendComment() {
  const input = document.getElementById('pv-comment-input');
  const text = input.value.trim();
  if (!text||!pvCurrentId) return;
  const p = posts.find(x=>x.id===pvCurrentId);
  if (!p) return;
  try {
    const r = await MchatAPI.commentPost(p.id, text);
    if (!Array.isArray(p.comments)) p.comments = [];
    p.comments.push(commentFromServer(r.comment));
    pvRenderComments(); renderFeed();
    input.value='';
    showToast('Комментарий отправлен');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// CHATS
// ============================================================
function fmtClock(iso) { return new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }
function fmtChatTime(iso) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? fmtClock(iso) : d.toLocaleDateString([], {day:'2-digit', month:'2-digit'});
}
const AVATAR_SVG_LIST = '<svg width="24" height="24" fill="none" stroke="var(--text2)" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';
const AVATAR_SVG_OPEN = '<svg width="22" height="22" fill="none" stroke="var(--text2)" stroke-width="1.4" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>';

// серверный формат → формат, который ждёт твой UI
function chatFromServer(c) {
  return {
    id: c.id, type: c.type, name: c.name, description: c.description, avatar: c.avatar, peer: c.peer,
    unread: c.unread || 0, role: c.role, canPost: c.canPost !== false, canModerate: !!c.canModerate, muted: !!c.muted, isPublic: !!c.isPublic,
    memberCount: c.memberCount || 0, inviteCode: c.inviteCode || null, pinned: c.pinned || null, background: c.background || null,
    lastMessage: c.lastMessage ? c.lastMessage.text : '',
    time: c.lastMessage ? fmtChatTime(c.lastMessage.createdAt) : '',
    lastMessageAt: c.lastMessageAt
  };
}
function msgFromServer(m) {
  return {
    id: m.id, clientId: m.clientId, chatId: m.chatId, senderId: m.senderId,
    senderName: m.senderName, senderUsername: m.senderUsername,
    kind: m.kind || 'TEXT', text: m.text, mediaUrl: m.mediaUrl, fileName: m.fileName, fileSize: m.fileSize, durationSec: m.durationSec,
    replyTo: m.replyTo, forwardedFrom: m.forwardedFrom,
    reactions: m.reactions || [], editedAt: m.editedAt,
    time: fmtClock(m.createdAt), createdAt: m.createdAt,
    outgoing: !!currentUser && m.senderId === currentUser.id, pending: false
  };
}

async function refreshChats() {
  try {
    const r = await MchatAPI.listChats();
    const local = chats.filter(c => !r.chats.some(s => s.id === c.id) && c.fresh); // только что созданные, ещё без сообщений
    chats = r.chats.map(chatFromServer).concat(local);
  } catch (e) { /* остаёмся с тем, что есть */ }
  renderChats();
}

let mxGlobalSeq = 0, mxGlobalTimer = null, mxGlobalResults = [];
function mxGlobalBox() {
  const list = document.getElementById('chats-list');
  let box = document.getElementById('mx-global-channels');
  if (!box || box.parentNode !== list) {
    box = document.createElement('div');
    box.id = 'mx-global-channels';
    list.appendChild(box);
  }
  return box;
}
function mxSearchGlobalChannels(q) {
  clearTimeout(mxGlobalTimer);
  if (!q || q.trim().length < 2) { mxGlobalResults = []; mxRefreshGlobalChannels(); return; }
  mxGlobalTimer = setTimeout(async () => {
    const seq = ++mxGlobalSeq;
    try {
      const r = await MchatAPI.searchChannels(q.trim());
      if (seq !== mxGlobalSeq) return;
      mxGlobalResults = r.channels;
      mxRefreshGlobalChannels();
    } catch (e) { /* поиск необязателен */ }
  }, 300);
}
function mxRefreshGlobalChannels() {
  if (!document.getElementById('chats-list')) return;
  const box = mxGlobalBox();
  if (!mxGlobalResults.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;padding:14px 16px 6px">Каналы</div>` + mxGlobalResults.map(c => {
    const mine = chats.find(x => x.id === c.id);
    const joined = c.joined || !!mine;
    const muted = mine ? !!mine.muted : !!c.muted;
    const av = c.avatar ? `<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover">` : esc((c.name || '?').charAt(0).toUpperCase());
    return `<div style="margin:0 12px 10px;background:var(--surf);border-radius:16px;padding:12px">
      <div style="display:flex;gap:12px;align-items:center;${joined ? 'cursor:pointer' : ''}" ${joined ? `onclick="openChat('${esc(c.id)}')"` : ''}>
        <div style="width:46px;height:46px;border-radius:50%;background:var(--surf2);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px">${av}</div>
        <div style="min-width:0;flex:1"><div style="font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
        <div style="font-size:12px;color:var(--text2)">${mxPlural(c.memberCount, ['подписчик','подписчика','подписчиков'])}${c.description ? ' · ' + esc(c.description.slice(0, 50)) : ''}</div></div>
      </div>
      ${joined
        ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding:10px 12px;border-radius:12px;background:var(--surf2);opacity:.9"><div style="font-size:14px">Уведомления: <b>${muted ? 'Выкл' : 'Вкл'}</b></div>${mxSwitchHtml(!muted, `mxToggleChannelMute('${esc(c.id)}')`)}</div>`
        : `<button onclick="mxJoinChannel('${esc(c.id)}')" style="width:100%;margin-top:10px;padding:11px;border:none;border-radius:12px;background:var(--accent);color:#fff;font-family:var(--font);font-size:14px;font-weight:700;cursor:pointer">Присоединиться</button>`}
    </div>`;
  }).join('');
}
async function mxJoinChannel(id) {
  try {
    const r = await MchatAPI.joinChannel(id);
    const ch = chatFromServer(r.chat);
    if (!chats.some(c => c.id === ch.id)) chats.unshift(ch);
    const g = mxGlobalResults.find(x => x.id === id); if (g) { g.joined = true; g.memberCount = ch.memberCount; }
    renderChats(document.getElementById('chat-search').value.toLowerCase());
    mxRefreshGlobalChannels();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxToggleChannelMute(id) {
  const mine = chats.find(x => x.id === id);
  const g = mxGlobalResults.find(x => x.id === id);
  const muted = !(mine ? mine.muted : g && g.muted);
  try { await MchatAPI.muteChat(id, muted); if (mine) mine.muted = muted; if (g) g.muted = muted; mxRefreshGlobalChannels(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}

function filterChats() {
  const q = document.getElementById('chat-search').value.toLowerCase();
  renderChats(q);
  mxSearchGlobalChannels(q);
}

function chatAvatarHtml(ch) {
  if (ch.avatar) return `<img src="${esc(ch.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">`;
  if (ch.type && ch.type !== 'DIRECT') {
    return `<div class="mx-letter-av${ch.type === 'CHANNEL' ? ' channel' : ''}">${esc((ch.name || '#').charAt(0).toUpperCase())}</div>`;
  }
  return AVATAR_SVG_LIST;
}
function renderChats(q='') {
  _renderChatsInner(q);
  mxRefreshGlobalChannels(); // результаты глобального поиска каналов — внутри прокручиваемого списка
}
function _renderChatsInner(q='') {
  const c = document.getElementById('chats-list');
  if (!c) return;
  const filtered = chats.filter(ch => (ch.name || '').toLowerCase().includes(q));
  if (filtered.length===0) { c.innerHTML=`<div style="text-align:center;padding:40px 20px;color:var(--text2)">${q?'Не найдено':'Нет чатов'}</div>`; return; }
  c.innerHTML = filtered.map(ch=>`
    <div class="chat-item" onclick="openChat('${esc(ch.id)}')">
      <div class="chat-avatar">${chatAvatarHtml(ch)}</div>
      <div class="chat-info"><div class="chat-name">${esc(ch.name)}</div><div class="chat-last">${esc(ch.lastMessage||'')}</div></div>
      <div class="chat-time">${esc(ch.time||'')}</div>
      ${ch.unread>0?'<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;margin-left:8px"></div>':''}
    </div>`).join('');
  updateNavBadge();
}

function mxPlural(n, forms) {
  n = n || 0;
  const a = n % 10, b = n % 100;
  return n + ' ' + (a === 1 && b !== 11 ? forms[0] : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? forms[1] : forms[2]);
}
function updateChatStatus(ch) {
  const el = document.getElementById('chat-status');
  if (!el) return;
  if (ch && ch.type === 'GROUP') { el.textContent = mxPlural(ch.memberCount, ['участник', 'участника', 'участников']); el.style.color = 'var(--text2)'; return; }
  if (ch && ch.type === 'CHANNEL') { el.textContent = mxPlural(ch.memberCount, ['подписчик', 'подписчика', 'подписчиков']); el.style.color = 'var(--text2)'; return; }
  const peer = ch && ch.peer;
  if (peer && peer.online === true) { el.textContent = 'онлайн'; el.style.color = '#4ade80'; }
  else if (peer && peer.online === false && peer.lastSeenAt) { el.textContent = 'был(а) ' + fmtChatTime(peer.lastSeenAt); el.style.color = 'var(--text2)'; }
  else { el.textContent = ''; }
}

async function openChat(id) {
  const ch = chats.find(c=>c.id===id);
  if (!ch) return;
  currentChatId = id;
  currentChatPeer = ch.peer || null;
  currentChatMeta = { type: ch.type, canPost: ch.canPost !== false, canModerate: !!ch.canModerate };
  // звонить можно в личных чатах и группах (в каналах — нет)
  ['mx-call-btn','mx-vcall-btn'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = ch.type === 'CHANNEL' ? 'none' : ''; });
  mxCancelCompose();
  document.getElementById('chat-name').textContent = ch.name;
  document.getElementById('chat-open-av').innerHTML = ch.avatar
    ? `<img src="${esc(ch.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">`
    : (ch.type && ch.type !== 'DIRECT' ? `<div class="mx-letter-av${ch.type === 'CHANNEL' ? ' channel' : ''}">${esc((ch.name||'#').charAt(0).toUpperCase())}</div>` : AVATAR_SVG_OPEN);
  updateChatStatus(ch);
  mxApplyChatBackground();
  renderPinnedBar(ch.pinned || null);
  const inputRow = document.getElementById('mx-input-row');
  const readonlyRow = document.getElementById('mx-readonly');
  const canPost = ch.canPost !== false;
  if (inputRow) inputRow.style.display = canPost ? 'flex' : 'none';
  if (readonlyRow) readonlyRow.style.display = canPost ? 'none' : 'flex';
  renderMessages(id);
  goTo('s-chat-open');
  await loadChatHistory(id);
  markCurrentChatRead();
}

async function openChatById(id) {
  if (!chats.find(c => c.id === id)) await refreshChats();
  if (chats.find(c => c.id === id)) openChat(id);
}

async function loadChatHistory(id) {
  try {
    const r = await MchatAPI.listMessages(id);
    messages[id] = r.messages.map(msgFromServer);
    if (currentChatId === id) renderMessages(id);
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

function markCurrentChatRead() {
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch) return;
  if (ch.unread > 0) { ch.unread = 0; renderChats(); }
  MchatAPI.markRead(currentChatId);
}

function fmtDur(sec) {
  sec = Math.round(sec || 0);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function reactionsHtml(m) {
  if (!m.reactions || m.reactions.length === 0) return '';
  const mine = currentUser && currentUser.id;
  return `<div class="mx-reactions">${m.reactions.map(r => `
    <span class="mx-chip${r.userIds.includes(mine)?' mine':''}" onclick="event.stopPropagation();mxPickReaction('${esc(m.id)}','${esc(r.emoji)}')">${r.emoji}<b>${r.userIds.length}</b></span>
  `).join('')}</div>`;
}
function replyQuoteHtml(m) {
  if (!m.replyTo) return '';
  const label = m.replyTo.deleted ? 'Сообщение удалено' : (m.replyTo.kind === 'VOICE' ? '🎤 Голосовое' : m.replyTo.kind === 'VIDEO_NOTE' ? '🎥 Видеосообщение' : m.replyTo.kind === 'IMAGE' ? '📷 Фото' : m.replyTo.text);
  return `<div class="mx-quote" onclick="event.stopPropagation();mxScrollToMessage('${esc(m.replyTo.id)}')">
    <div class="mx-quote-name">${esc(m.replyTo.senderName || 'Собеседник')}</div><div class="mx-quote-text">${esc(label)}</div>
  </div>`;
}
function bubbleBodyHtml(m) {
  if (m.kind === 'VOICE') {
    return `<div class="mx-voice" data-audio-url="${esc(m.mediaUrl||'')}">
      <button class="mx-vplay" onclick="event.stopPropagation();mxVoicePlayToggle(this,'${esc(m.id)}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg></button>
      <div class="mx-prog" onclick="event.stopPropagation();mxVoiceSeek(event,this)"><div class="mx-prog-fill"></div></div>
      <span class="mx-vdur">${esc(fmtDur(m.durationSec))}</span>
    </div>`;
  }
  if (m.kind === 'VIDEO_NOTE') {
    return `<div class="mx-vn-wrap" onclick="event.stopPropagation();mxVideoNoteToggle(this)">
      <video src="${esc(m.mediaUrl||'')}" playsinline muted loop preload="metadata" onloadedmetadata="mxFixWebmDuration(this)"></video>
      <div class="mx-vn-ico"><svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><polygon points="7 4 20 12 7 20 7 4"/></svg></div>
      <div class="mx-vn-dur">${esc(fmtDur(m.durationSec))}</div>
    </div>`;
  }
  if (m.kind === 'IMAGE') {
    return `<img class="mx-img" src="${esc(m.mediaUrl||'')}" onerror="mxMediaLost(this)" onclick="event.stopPropagation();mxOpenImage('${esc(m.mediaUrl||'')}')">${mxUploadBar(m)}`;
  }
  if (m.kind === 'VIDEO') {
    if (!m.mediaUrl) return `<div class="mx-lost">Отправка видео…</div>${mxUploadBar(m)}`;
    return `<video class="mx-video" src="${esc(m.mediaUrl)}" controls playsinline preload="metadata" onerror="mxMediaLost(this)" onclick="event.stopPropagation()"></video>`;
  }
  if (m.kind === 'FILE') {
    const href = m.mediaUrl ? ` href="${esc(m.mediaUrl)}" download="${esc(m.fileName||'file')}"` : '';
    return `<a class="mx-file"${href} onclick="event.stopPropagation()"><div class="mx-file-ico"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><div class="mx-file-info"><div class="mx-file-name">${esc(m.fileName||'Файл')}</div><div class="mx-file-size">${esc(mxFmtSize(m.fileSize))}</div>${mxUploadBar(m)}</div></a>`;
  }
  return `<div class="mx-txt">${esc(m.text)}</div>`;
}
function mxFmtSize(n) {
  if (!n) return '';
  return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' КБ' : (n / 1024 / 1024).toFixed(1) + ' МБ';
}
function mxUploadBar(m) {
  return m.pending ? `<div class="mx-upbar"><i style="width:${m.progress || 0}%"></i></div>` : '';
}
function mxMediaLost(el) {
  const box = document.createElement('div');
  box.className = 'mx-lost';
  box.textContent = 'Файл недоступен';
  el.replaceWith(box);
}
function renderMessages(id) {
  const c = document.getElementById('messages-container');
  const msgs = messages[id]||[];
  const isGroup = currentChatMeta && currentChatMeta.type !== 'DIRECT';
  c.innerHTML = msgs.map(m => {
    const cls = ['msg', m.outgoing?'mo':'mi'];
    if (m.kind === 'VIDEO_NOTE') cls.push('mx-vn');
    if (m.kind === 'IMAGE') cls.push('mx-photo');
    if (m.kind === 'VIDEO') cls.push('mx-media');
    const senderHtml = (isGroup && !m.outgoing && m.senderName) ? `<div class="mx-sender">${esc(m.senderName)}</div>` : '';
    const fwdHtml = m.forwardedFrom ? `<div class="mx-fwd">Переслано от ${esc(m.forwardedFrom)}</div>` : '';
    const editedHtml = m.editedAt ? '<span class="mx-edited">ред.</span>' : '';
    return `<div class="${cls.join(' ')}" data-id="${esc(m.id)}"${m.pending?' style="opacity:.6"':''} onclick="mxOpenReactions('${esc(m.id)}', event)" oncontextmenu="event.preventDefault();mxOpenContextMenu('${esc(m.id)}', event)">${senderHtml}${fwdHtml}${replyQuoteHtml(m)}${bubbleBodyHtml(m)}${reactionsHtml(m)}<div class="mt">${editedHtml}${esc(m.time)}</div></div>`;
  }).join('');
  c.scrollTop = c.scrollHeight;
}
function mxScrollToMessage(id) {
  const el = document.querySelector(`#messages-container .msg[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('mx-flash');
  setTimeout(() => el.classList.remove('mx-flash'), 1300);
}
function mxOpenImage(url) {
  if (!url) return;
  document.getElementById('avatar-full-img').src = url;
  document.getElementById('avatar-fullscreen').classList.add('active');
}

const msgPreview = (m) => m.kind === 'VOICE' ? '🎤 Голосовое сообщение' : m.kind === 'VIDEO_NOTE' ? '🎥 Видеосообщение' : m.kind === 'IMAGE' ? '📷 Фото' : m.kind === 'VIDEO' ? '🎬 Видео' : m.kind === 'FILE' ? '📎 ' + (m.fileName || 'Файл') : m.text;

// Новое сообщение (по сокету): своё с другого устройства, либо от собеседника
function onIncomingMessage(m) {
  if (!currentUser) return;
  const list = (messages[m.chatId] = messages[m.chatId] || []);
  const existing = list.find(x => x.id === m.id || (m.clientId && x.clientId === m.clientId));
  if (existing) Object.assign(existing, msgFromServer(m)); else list.push(msgFromServer(m));

  const ch = chats.find(c => c.id === m.chatId);
  if (!ch) { refreshChats(); return; } // новый диалог — подтягиваем список
  ch.lastMessage = msgPreview(m); ch.time = fmtChatTime(m.createdAt); ch.lastMessageAt = m.createdAt; ch.fresh = false;

  const mine = m.senderId === currentUser.id;
  const open = currentChatId === m.chatId && document.getElementById('s-chat-open').classList.contains('active');
  const appVisible = document.visibilityState === 'visible';
  if (!mine) {
    if (open && appVisible) MchatAPI.markRead(m.chatId);
    else {
      ch.unread = (ch.unread || 0) + 1;
      if (!open || !appVisible) mxNotifyIncoming(ch, m); // тост + звук, если человек не смотрит именно в этот чат
    }
  }
  chats.sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0));
  if (open) renderMessages(m.chatId);
  renderChats();
}

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text||!currentChatId) return;
  const chatId = currentChatId;
  if (window._mxEditingId) {
    const editId = window._mxEditingId;
    window._mxEditingId = null;
    input.value = '';
    mxOnComposeInput();
    mxCancelCompose();
    try {
      const saved = await MchatAPI.editMessage(editId, text);
      const list = messages[chatId];
      if (list) { const i = list.findIndex(m => m.id === editId); if (i >= 0) list[i] = msgFromServer(saved); renderMessages(chatId); }
    } catch (e) { showToast(MchatAPI.errorText(e)); }
    return;
  }
  const clientId = MchatAPI.newClientId();
  const replyToId = replyToMsg ? replyToMsg.id : undefined;
  input.value = '';
  mxOnComposeInput();
  mxCancelCompose();
  // оптимистично показываем сразу, дальше сервер подтвердит
  const local = { id: clientId, clientId, kind: 'TEXT', text, reactions: [], time: fmtClock(new Date().toISOString()), outgoing: true, pending: true };
  (messages[chatId] = messages[chatId] || []).push(local);
  renderMessages(chatId);
  try {
    const extra = replyToId ? { replyToId } : undefined;
    const saved = await MchatAPI.sendMessage(chatId, text, clientId, extra);
    Object.assign(local, msgFromServer(saved));
    onIncomingMessage(saved);
  } catch (e) {
    messages[chatId] = messages[chatId].filter(x => x !== local); // не отправилось — убираем и возвращаем текст
    if (currentChatId === chatId) { renderMessages(chatId); input.value = text; }
    showToast(MchatAPI.errorText(e));
  }
}

// «Написать» на профиле пользователя
async function startChatWithUser(username) {
  if (!username) return;
  try {
    const r = await MchatAPI.startDirectChat(username);
    let ch = chats.find(c => c.id === r.chat.id);
    if (!ch) { ch = chatFromServer(r.chat); ch.fresh = true; chats.unshift(ch); }
    await openChat(ch.id);
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}


function openChatSheet() { document.getElementById('chat-sheet').classList.add('active'); }
function closeChatSheet() { document.getElementById('chat-sheet').classList.remove('active'); }

function openSupport() {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.innerHTML = `<div class="modal-box" style="text-align:center">
    <h3>Техническая поддержка</h3>
    <div style="background:var(--surf);border-radius:14px;padding:16px;margin-bottom:10px;text-align:left">
      <div style="font-size:13px;color:var(--text2)">Напиши нам если что-то не работает:</div>
      <div style="margin-top:8px;font-size:14px;color:var(--accent);font-weight:600">admin@mchat.app</div>
    </div>
    <div style="background:var(--surf);border-radius:14px;padding:12px;margin-bottom:16px;text-align:left;font-size:12px;color:var(--text2)">Время ответа: до 24 часов</div>
    <button onclick="this.closest('.modal').remove()" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-family:var(--font);font-size:15px;font-weight:700;cursor:pointer">Понятно</button>
  </div>`;
  document.getElementById('app').appendChild(m);
}

setInterval(() => {
  const feed = document.getElementById('s-feed');
  if (currentUser && !document.hidden && feed && feed.classList.contains('active')) refreshPosts();
}, 45000);

function goTo(id) {
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('active');
  const navMap = {'s-feed':0,'s-chats':1,'s-profile':2,'s-settings':3};
  const activeIdx = navMap[id];
  document.querySelectorAll('.island-nav').forEach(nav=>{
    nav.querySelectorAll('.nb').forEach(b=>b.classList.remove('active'));
    if (activeIdx !== undefined) {
      const btns = nav.querySelectorAll('.nb');
      if (btns[activeIdx]) btns[activeIdx].classList.add('active');
    }
  });
  if(id==='s-feed') renderFeed();
  if(id==='s-chats') renderChats();
  if(id==='s-profile') updateProfileUI();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.style.cssText='position:absolute;bottom:100px;left:50%;transform:translateX(-50%);background:#4a4af0;color:#fff;padding:11px 20px;border-radius:20px;font-size:13px;font-weight:600;z-index:9999;white-space:nowrap;animation:fu .3s ease';
  t.textContent = msg;
  document.getElementById('app').appendChild(t);
  setTimeout(()=>t.remove(),2500);
}

function switchLanguage() {
  currentLanguage = currentLanguage==='ru'?'en':'ru';
  localStorage.setItem('mchat_lang',currentLanguage);
  const isEn = currentLanguage === 'en';
  document.getElementById('current-language').textContent = isEn ? 'English' : 'Русский';
  const t = {
    'feed-title': ['Feed','Mchat'],
    'chats-title': ['Chats','Чаты'],
    'profile-title': ['Profile','Профиль'],
    'settings-title': ['Settings','Настройки'],
    'account-label': ['Account','Аккаунт'],
    'appearance-label': ['Appearance','Внешний вид'],
    'language-label': ['Language','Язык'],
    'language-item': ['Language','Язык'],
    'session-label': ['Session','Сессия'],
    'logout-item': ['Log out','Выйти'],
    'profile-item': ['Profile','Профиль'],
    'privacy-item': ['Privacy','Конфиденциальность'],
    'notifications-item': ['Notifications','Уведомления'],
    'theme-item': ['Theme','Тема'],
    'animations-item': ['Animations','Анимации'],
    'auth-title': ['Sign in','Войти'],
    'auth-btn-text': ['Sign in with Google','Войти через Google'],
  };
  for (const [id, [en, ru]] of Object.entries(t)) {
    const el = document.getElementById(id);
    if (el) el.textContent = isEn ? en : ru;
  }
  const lp = document.getElementById('login-username');
  if (lp) lp.placeholder = isEn ? '@username' : '@username';
  const chatSearch = document.getElementById('chat-search');
  if (chatSearch) chatSearch.placeholder = isEn ? 'Search' : 'Поиск';
  const msgInput = document.getElementById('message-input');
  if (msgInput) msgInput.placeholder = isEn ? 'Message...' : 'Сообщение...';
  const newPostInp = document.getElementById('new-post-text');
  if (newPostInp) newPostInp.placeholder = isEn ? "What's new?" : 'Что нового?';
}

function setTheme(theme, el) {
  const themes={dark:['#18181f','#1f1f28','#262632','#2e2e3e'],navy:['#0a0e1a','#0f1625','#1a2540','#202d4d'],purple:['#0f0a1a','#181025','#281a3a','#301f45']};
  const [bg,bg2,surf,surf2]=themes[theme];
  const r=document.documentElement.style;
  r.setProperty('--bg',bg);r.setProperty('--bg2',bg2);r.setProperty('--surf',surf);r.setProperty('--surf2',surf2);
  document.querySelectorAll('.tchip').forEach(c=>c.classList.remove('sel'));
  el.classList.add('sel');
}


function setupPinchZoom(el) {
  if (!el || el._pinchReady) return;
  el._pinchReady = true;
  let scale = 1, startDist = 0, startScale = 1;
  let tx = 0, ty = 0, startTx = 0, startTy = 0, startMidX = 0, startMidY = 0;
  function dist(t) { return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }
  function mid(t) { return {x:(t[0].clientX+t[1].clientX)/2, y:(t[0].clientY+t[1].clientY)/2}; }
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      startDist = dist(e.touches);
      startScale = scale;
      const m = mid(e.touches);
      startMidX = m.x; startMidY = m.y;
      startTx = tx; startTy = ty;
    }
  }, {passive:false});
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const newDist = dist(e.touches);
      scale = Math.min(5, Math.max(1, startScale * newDist / startDist));
      const m = mid(e.touches);
      tx = startTx + (m.x - startMidX);
      ty = startTy + (m.y - startMidY);
      el.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
      el.style.transformOrigin = 'center center';
    }
  }, {passive:false});
  el.addEventListener('touchend', e => {
    if (e.touches.length < 2 && scale <= 1) {
      scale = 1; tx = 0; ty = 0;
      el.style.transform = '';
    }
  });
  let lastTap = 0;
  el.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTap < 300) { scale=1; tx=0; ty=0; el.style.transform=''; }
    lastTap = now;
  });
}

function setupTextPinchScale() {
  const el = document.getElementById('sc-drag-text');
  if (!el || el._scaleReady) return;
  el._scaleReady = true;
  let textScale = 1, startDist = 0, startScale = 1;
  function dist(t) { return Math.hypot(t[0].clientX-t[1].clientX, t[0].clientY-t[1].clientY); }
  el.addEventListener('touchstart', e => {
    if (e.touches.length === 2) { e.preventDefault(); startDist = dist(e.touches); startScale = textScale; }
  }, {passive:false});
  el.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      e.preventDefault();
      textScale = Math.min(4, Math.max(0.5, startScale * dist(e.touches) / startDist));
      el.style.fontSize = (26 * textScale) + 'px';
    }
  }, {passive:false});
}

let pcVideoCoverData = null;

function extractVideoThumbnail(videoUrl, timePercent = 0) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.src = videoUrl;
    video.crossOrigin = 'anonymous';
    video.onloadedmetadata = () => {
      video.currentTime = (timePercent / 100) * video.duration;
    };
    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0);
      const thumbnail = canvas.toDataURL('image/jpeg', 0.9);
      video.pause();
      resolve(thumbnail);
    };
    video.play().catch(() => resolve(null));
  });
}

function updateVideoCoverPreview() {
  if (!pendingPostMedia || pendingPostMedia.type !== 'video') return;
  const slider = document.getElementById('pc-video-slider');
  if (!slider) return;
  const timePercent = parseFloat(slider.value);
  extractVideoThumbnail(pendingPostMedia.url, timePercent).then(thumbnail => {
    if (thumbnail) {
      const preview = document.getElementById('pc-cover-preview');
      preview.src = thumbnail;
      pcVideoCoverData = thumbnail;
    }
  });
}

function closeCoverSelector() {
  document.getElementById('pc-video-cover-selector').style.display = 'none';
}

function confirmVideoCover() {
  if (pcVideoCoverData) {
    pendingPostMedia.thumbnail = pcVideoCoverData;
    showToast('Обложка выбрана');
  }
  document.getElementById('pc-video-cover-selector').style.display = 'none';
}

const VERIFY_DAYS = [[5, '5 дней'], [10, '10 дней'], [15, '15 дней'], [30, '30 дней'], [null, 'Навсегда']];
function fmtDate(iso) { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

async function openAdminPanel() {
  document.querySelectorAll('.modal.mx-admin').forEach(x => x.remove());
  const m = document.createElement('div');
  m.className = 'modal active mx-admin';
  m.style.zIndex = '900';
  m.onclick = e => { if (e.target === m) m.remove(); };
  m.innerHTML = '<div class="modal-box" style="max-width:380px"><div style="text-align:center;padding:30px;color:var(--text2)">Загрузка…</div></div>';
  document.getElementById('app').appendChild(m);

  let data;
  try { data = await MchatAPI.verifyAdmin(); }
  catch (e) { m.remove(); showToast(MchatAPI.errorText(e)); return; }

  const btn = 'flex:1;min-width:64px;padding:8px 6px;border-radius:8px;border:none;color:#fff;cursor:pointer;font-size:12px;';
  const cardHead = (u, sub) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      ${u.avatar ? `<img src="${esc(u.avatar)}" style="width:32px;height:32px;border-radius:50%;object-fit:cover" referrerpolicy="no-referrer">` : ''}
      <div><div style="font-weight:600;font-size:14px">${esc(u.name)} (@${esc(u.username)})</div>
      <div style="font-size:11px;color:var(--text2)">${sub}</div></div></div>`;

  const pending = data.requests.filter(r => r.status === 'PENDING');
  const decided = data.requests.filter(r => r.status !== 'PENDING');
  let html = `<div class="modal-box" style="max-width:380px">
    <h3 style="margin-bottom:16px">👑 Админ панель верификации</h3>
    <div style="max-height:440px;overflow-y:auto">`;

  html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin-bottom:6px">Новые запросы (${pending.length})</div>`;
  if (!pending.length) html += '<div style="text-align:center;padding:14px;color:var(--text2)">Нет новых запросов</div>';
  pending.forEach(r => {
    html += `<div style="background:var(--surf);border-radius:12px;padding:12px;margin-bottom:8px">
      ${cardHead(r.user, '⏳ ' + fmtDate(r.createdAt))}
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px;padding:8px;background:var(--bg);border-radius:8px">${esc(r.reason)}</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:6px">Выдать галочку на:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">
        ${VERIFY_DAYS.map(([d, label]) => `<button onclick="verifyApprove(${r.id},${d === null ? 'null' : d})" style="${btn}background:var(--accent)">${label}</button>`).join('')}
      </div>
      <button onclick="verifyReject(${r.id})" style="${btn}width:100%;background:#dc2626">Отклонить</button>
    </div>`;
  });

  html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px">Действующие галочки (${data.verified.length})</div>`;
  if (!data.verified.length) html += '<div style="text-align:center;padding:14px;color:var(--text2)">Пока никому не выдана</div>';
  data.verified.forEach(u => {
    const info = u.verifiedAt
      ? `Выдана ${fmtDate(u.verifiedAt)} · ${u.verifiedUntil ? 'исчезнет ' + fmtDate(u.verifiedUntil) : 'навсегда'}`
      : 'Выдана';
    html += `<div style="background:var(--surf);border-radius:12px;padding:12px;margin-bottom:8px">
      ${cardHead(u, info)}
      <button onclick="verifyRevoke('${esc(u.id)}')" style="${btn}width:100%;background:#dc2626">Снять галочку досрочно</button>
    </div>`;
  });

  if (decided.length) {
    html += `<div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin:14px 0 6px">История</div>`;
    decided.slice(0, 30).forEach(r => {
      const st = r.status === 'APPROVED' ? '✓ одобрено' + (r.days ? ' на ' + r.days + ' дн.' : ' навсегда') : '✗ отклонено';
      html += `<div style="font-size:12px;color:var(--text2);padding:6px 2px">@${esc(r.user.username)} — ${st} · ${fmtDate(r.decidedAt || r.createdAt)}</div>`;
    });
  }

  html += `</div>
    <button onclick="this.closest('.modal').remove()" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--surf);color:var(--text);margin-top:12px;cursor:pointer">Закрыть</button>
  </div>`;
  m.innerHTML = html;
}

async function verifyApprove(id, days) {
  try { await MchatAPI.verifyApprove(id, days); showToast(days === null ? 'Галочка выдана навсегда' : 'Галочка выдана на ' + days + ' дн.'); openAdminPanel(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function verifyReject(id) {
  try { await MchatAPI.verifyReject(id); showToast('Запрос отклонён'); openAdminPanel(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
function verifyRevoke(userId) {
  showConfirm('Снять галочку досрочно?', async () => {
    try { await MchatAPI.verifyRevoke(userId); showToast('Галочка снята'); openAdminPanel(); }
    catch (e) { showToast(MchatAPI.errorText(e)); }
  });
}

function editProfileBanner() {
  // Use the profile-level banner input if exists, else fall back to edit-modal one
  const inp = document.getElementById('profile-banner-input') || document.getElementById('banner-input');
  if (inp) inp.click();
}

async function bannerChosen(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const cover = document.getElementById('cover-image');
  const prev = currentUser.banner;
  const localUrl = URL.createObjectURL(file);
  cover.style.backgroundImage = `url('${localUrl}')`;
  cover.style.backgroundSize = 'cover';
  cover.style.backgroundPosition = 'center';
  try {
    const up = await MchatAPI.uploadMedia('image', file, {});
    await MchatAPI.updateMe({ bannerMediaId: up.id });
    currentUser.banner = up.url; saveUser();
    showToast('Баннер обновлен!');
  } catch (err) {
    currentUser.banner = prev; updateProfileUI();
    showToast('Баннер не сохранён: ' + MchatAPI.errorText(err));
  }
}

function requestVerification() {
  const m = document.createElement('div');
  m.className = 'modal active';
  m.style.zIndex = '900';
  m.onclick = e => { if(e.target===m) m.remove(); };
  m.innerHTML = `<div class=\"modal-box\" style=\"max-width:340px\">
    <h3 style=\"margin-bottom:16px;display:flex;align-items:center;gap:8px\"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Запрос верификации</h3>
    <div style="font-size:13px;color:var(--text2);margin-bottom:12px;line-height:1.5">Галочка выдаётся по запросу администратором. Расскажи, почему ты достоин верификации.</div>
    <textarea class=\"minput\" id=\"verify-reason\" placeholder=\"Причина для верификации...\" style=\"height:100px;resize:vertical;margin-bottom:12px\"></textarea>
    <div class=\"mbtns\">
      <button class=\"mbtn-cancel\" onclick=\"this.closest('.modal').remove()\">Отмена</button>
      <button class=\"mbtn-save\" onclick=\"submitVerificationRequest()\">Отправить</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(m);
}

async function submitVerificationRequest() {
  const reason = document.getElementById('verify-reason').value.trim();
  if (reason.length < 3) { showToast('Заполни поле причины'); return; }
  try {
    await MchatAPI.requestVerification(reason);
    document.querySelector('.modal.active').remove();
    showToast('Запрос отправлен администраторам!');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

let scTapStartTime = 0;
function scHandleRecordStart(e) { scTapStartTime = Date.now(); scStartRecord(e); }
function scHandleRecordEnd() {
  const elapsed = Date.now() - scTapStartTime;
  if (elapsed < 300) { scStopRecord(); scTakePhoto(); }
  else { scStopRecord(); }
}

function scTakePhoto() {
  if (!scCameraStream) { showToast('Камера недоступна'); return; }
  const cam = document.getElementById('sc-camera');
  if (!cam || !cam.videoWidth) { showToast('Камера еще загружается'); return; }
  const canvas = document.createElement('canvas');
  canvas.width = cam.videoWidth;
  canvas.height = cam.videoHeight;
  const ctx = canvas.getContext('2d');
  if (scCameraFacing === 'user') {
    // Зеркалим фронтальную камеру так же, как она выглядит в превью
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(cam, 0, 0);
  const photoUrl = canvas.toDataURL('image/jpeg', 0.9);
  scMediaUrl = photoUrl;
  scMediaType = 'image';
  const img = document.getElementById('sc-preview-img');
  img.src = photoUrl;
  img.style.display = 'block';
  document.getElementById('sc-preview-vid').style.display = 'none';
  if (scCameraStream) { scCameraStream.getTracks().forEach(t=>t.stop()); scCameraStream = null; }
  document.getElementById('sc-camera').style.display = 'none';
  document.getElementById('sc-cam-controls').style.display = 'none';
  document.getElementById('sc-bottom').style.display = 'block';
  document.getElementById('sc-hint').style.display = 'none';
  showToast('Фото сделано!');
}


// ============================================================
// MEDIA FEATURES: Tracks, Audio, Follows
// ============================================================

// --- Global state ---
let savedTracks = [];
let audioRegistry = {}; // audioId -> {title, artist, originalUploader, avatar, url}
let follows = {};       // username -> Set of followed usernames
let currentReelsAudioId = null;

// --- Storage helpers ---
function getTracksKey() { return currentUser ? 'mchat_tracks_' + currentUser.username : 'mchat_tracks_guest'; }
function getFollowsKey() { return currentUser ? 'mchat_follows_' + currentUser.username : 'mchat_follows_guest'; }
function getPinnedTracksKey() { return currentUser ? 'mchat_pinned_tracks_' + currentUser.username : 'mchat_pinned_tracks_guest'; }
function getAudioRegistryKey() { return 'mchat_audio_registry'; }

function loadSavedTracks() {
  if (!currentUser) return;
  try { savedTracks = JSON.parse(localStorage.getItem(getTracksKey()) || '[]'); } catch(e) { savedTracks = []; }
}
function saveSavedTracks() {
  if (!currentUser) return;
  localStorage.setItem(getTracksKey(), JSON.stringify(savedTracks));
}
function loadFollows() {
  if (!currentUser) return;
  try { follows = JSON.parse(localStorage.getItem(getFollowsKey()) || '{}'); } catch(e) { follows = {}; }
}
function saveFollows() {
  if (!currentUser) return;
  localStorage.setItem(getFollowsKey(), JSON.stringify(follows));
}
function loadPinnedTracks() {
  if (!currentUser) return [];
  try { return JSON.parse(localStorage.getItem(getPinnedTracksKey()) || '[]'); } catch(e) { return []; }
}
function savePinnedTracks(pinned) {
  if (!currentUser) return;
  localStorage.setItem(getPinnedTracksKey(), JSON.stringify(pinned));
}
function loadAudioRegistry() {
  try { audioRegistry = JSON.parse(localStorage.getItem(getAudioRegistryKey()) || '{}'); } catch(e) { audioRegistry = {}; }
}
function saveAudioRegistry() {
  localStorage.setItem(getAudioRegistryKey(), JSON.stringify(audioRegistry));
}

// --- Follow logic ---
function followUser(username) {
  if (!currentUser || username === currentUser.username) return;
  if (!follows[currentUser.username]) follows[currentUser.username] = [];
  if (!follows[currentUser.username].includes(username)) {
    follows[currentUser.username].push(username);
    saveFollows();
  }
}
function unfollowUser(username) {
  if (!currentUser || !follows[currentUser.username]) return;
  follows[currentUser.username] = follows[currentUser.username].filter(u => u !== username);
  saveFollows();
}
function isFollowing(username) {
  if (!currentUser || !follows[currentUser.username]) return false;
  return follows[currentUser.username].includes(username);
}
function toggleFollowFromReels() {
  const p = posts.find(x => x.id === reelsCurrentId);
  if (!p || p.username === currentUser?.username) return;
  const btn = document.getElementById('reels-follow-btn');
  if (isFollowing(p.username)) {
    unfollowUser(p.username);
    btn.textContent = 'Подписаться';
    btn.classList.remove('following');
    showToast('Отписка оформлена');
  } else {
    followUser(p.username);
    btn.textContent = 'Подписки';
    btn.classList.add('following');
    showToast('Подписка оформлена');
  }
  updateProfileUI();
}
function goToUserOrOwnProfileFromReels() {
  const p = posts.find(x => x.id === reelsCurrentId);
  if (!p) return;
  closeVideoReels();
  goToUserOrOwnProfile(p.username);
}

// --- Audio / Track registry ---
function ensureAudioForPost(post) {
  if (!post) return null;
  // Если у поста уже есть audioId — используем его
  if (post.audioId && audioRegistry[post.audioId]) return post.audioId;
  // Иначе генерируем audioId на основе контента
  const audioId = 'audio_' + (post.originalPostId || post.id);
  if (!audioRegistry[audioId]) {
    const authorData = loadUserData(post.username);
    audioRegistry[audioId] = {
      id: audioId,
      title: post.text ? (post.text.slice(0, 30) || 'Оригинальный звук') : 'Оригинальный звук',
      artist: '@' + post.username,
      originalUploader: post.username,
      avatar: authorData.avatar || null,
      url: post.mediaUrl || null
    };
    saveAudioRegistry();
  }
  if (!post.audioId) post.audioId = audioId;
  return audioId;
}
function isTrackSaved(audioId) {
  return savedTracks.some(t => t.id === audioId);
}

// --- Reels overlay rendering ---
function renderReelsOverlay() {
  const p = posts.find(x => x.id === reelsCurrentId);
  if (!p) return;
  const header = document.getElementById('reels-header-overlay');
  const authorData = loadUserData(p.username);
  const av = document.getElementById('reels-author-av');
  av.innerHTML = authorData.avatar
    ? `<img src="${authorData.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : `<span style="color:#fff;font-weight:700;font-size:14px">${(p.username).charAt(0).toUpperCase()}</span>`;
  document.getElementById('reels-author-name').innerHTML = esc(p.name || p.username) + (authorData.verified ? ' <span class="verified-badge" title="Верифицирован"><svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '');
  document.getElementById('reels-author-handle').textContent = '@' + p.username;
  const followBtn = document.getElementById('reels-follow-btn');
  if (currentUser && p.username === currentUser.username) {
    followBtn.style.display = 'none';
  } else {
    followBtn.style.display = 'block';
    const following = isFollowing(p.username);
    followBtn.textContent = following ? 'Подписки' : 'Подписаться';
    followBtn.classList.toggle('following', following);
  }
  header.style.display = 'flex';

  // Audio widget
  const audioId = ensureAudioForPost(p);
  const audio = audioRegistry[audioId];
  const widget = document.getElementById('reels-audio-widget');
  if (audio) {
    currentReelsAudioId = audioId;
    const disc = document.getElementById('reels-audio-disc');
    if (audio.avatar) {
      disc.innerHTML = `<img src="${audio.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:10px">`;
    } else {
      disc.innerHTML = `<span style="color:#fff;font-weight:700;font-size:16px">${audio.originalUploader.charAt(0).toUpperCase()}</span>`;
    }
    document.getElementById('reels-audio-label').textContent = audio.title.length > 8 ? audio.title.slice(0,8)+'…' : audio.title;
    widget.style.display = 'flex';
  } else {
    widget.style.display = 'none';
  }
}

// --- Audio Modal ---
function openAudioModal() {
  if (!currentReelsAudioId || !audioRegistry[currentReelsAudioId]) return;
  const audio = audioRegistry[currentReelsAudioId];
  const disc = document.getElementById('audio-modal-disc');
  if (audio.avatar) {
    disc.innerHTML = `<img src="${audio.avatar}" style="width:100%;height:100%;object-fit:cover">`;
  } else {
    disc.innerHTML = `<svg width="40" height="40" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  document.getElementById('audio-modal-title').textContent = audio.title;
  document.getElementById('audio-modal-artist').textContent = audio.artist;
  const saved = isTrackSaved(currentReelsAudioId);
  document.getElementById('audio-save-btn-text').textContent = saved ? 'Удалить из избранного' : 'Сохранить в избранное';
  document.getElementById('audio-save-btn').classList.toggle('primary', !saved);
  document.getElementById('audio-save-btn').classList.toggle('secondary', saved);
  document.getElementById('audio-modal').classList.add('active');
}
function closeAudioModal() {
  document.getElementById('audio-modal').classList.remove('active');
}
function saveTrackFromModal() {
  if (!currentReelsAudioId || !currentUser) { showToast('Войди в аккаунт'); return; }
  const audio = audioRegistry[currentReelsAudioId];
  if (!audio) return;
  const idx = savedTracks.findIndex(t => t.id === currentReelsAudioId);
  if (idx >= 0) {
    savedTracks.splice(idx, 1);
    showToast('Удалено из избранного');
  } else {
    savedTracks.unshift({
      id: currentReelsAudioId,
      title: audio.title,
      artist: audio.artist,
      originalUploader: audio.originalUploader,
      avatar: audio.avatar,
      savedAt: Date.now()
    });
    showToast('Сохранено в избранное');
  }
  saveSavedTracks();
  closeAudioModal();
  if (currentProfileTab === 'tracks') renderProfileTabContent();
  renderPinnedTracks();
}
function useTrackForVideo() {
  if (!currentReelsAudioId) return;
  closeAudioModal();
  closeVideoReels();
  showToast('Открываю редактор с этим звуком…');
  // Переходим в story creator с предустановленным звуком
  setTimeout(() => {
    openStoryCreator();
    // Запоминаем выбранный звук для использования
    localStorage.setItem('mchat_pending_audio', currentReelsAudioId);
  }, 300);
}

// --- Profile: Pinned Tracks Strip ---
function renderPinnedTracks() {
  const strip = document.getElementById('pinned-tracks-strip');
  if (!strip) return;
  const pinned = loadPinnedTracks();
  if (pinned.length === 0) { strip.style.display = 'none'; return; }
  strip.style.display = 'flex';
  strip.innerHTML = pinned.slice(0, 3).map(t => {
    const audio = audioRegistry[t.id];
    if (!audio) return '';
    return `<div class="pinned-track-chip" onclick="openAudioModalById('${t.id}')">
      ${audio.avatar ? `<img src="${audio.avatar}">` : `<div style="width:24px;height:24px;border-radius:6px;background:var(--surf2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${audio.originalUploader.charAt(0).toUpperCase()}</div>`}
      <span>${audio.title}</span>
    </div>`;
  }).join('');
}
function openAudioModalById(audioId) {
  currentReelsAudioId = audioId;
  openAudioModal();
}

// --- Profile Tab: Tracks (private, owner only) ---
function mxTrackRowHtml(t) {
  return `<div class="mx-track-row" id="mx-track-row-${esc(t.id)}">
    <div class="mx-track-ico" onclick="mxPlayServerTrack('${esc(t.id)}','${esc(t.url)}')" style="cursor:pointer">
      <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
    </div>
    <div class="mx-track-info" onclick="mxPlayServerTrack('${esc(t.id)}','${esc(t.url)}')" style="cursor:pointer">
      <div class="mx-track-title">${esc(t.title || 'Без названия')}</div>
      <div class="mx-track-sub">${esc(t.artist || '')}${t.durationSec ? ' · ' + esc(fmtDur(t.durationSec)) : ''}</div>
    </div>
    <button class="mx-track-del" onclick="mxDeleteTrack('${esc(t.id)}')" title="Удалить">${MX_ICO.del}</button>
  </div>`;
}
function mxPlayServerTrack(id, url) {
  const playIco = '<svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const pauseIco = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  document.querySelectorAll('.mx-track-ico').forEach(ico => { if (ico.closest('.mx-track-row').id !== 'mx-track-row-' + id) ico.innerHTML = playIco; });
  const ico = document.querySelector('#mx-track-row-' + id + ' .mx-track-ico');
  let a = window._mxTrackRowAudio;
  if (a && window._mxTrackRowId === id) {
    if (a.paused) { a.play().catch(()=>{}); if (ico) ico.innerHTML = pauseIco; } else { a.pause(); if (ico) ico.innerHTML = playIco; }
    return;
  }
  if (a) a.pause();
  a = new Audio(url);
  window._mxTrackRowAudio = a; window._mxTrackRowId = id;
  a.addEventListener('ended', () => { if (ico) ico.innerHTML = playIco; });
  a.play().catch(() => showToast('Не удалось воспроизвести'));
  if (ico) ico.innerHTML = pauseIco;
}
async function renderProfileTracksTab() {
  const cont = document.getElementById('profile-tab-content');
  if (!cont) return;
  const uploadCard = `<div class="mx-upload-card" id="mx-track-upload-card" onclick="mxOpenTrackPicker()">
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
    <span>Загрузить свой трек</span>
  </div>`;
  cont.innerHTML = `<div class="mx-tracks-wrap">${uploadCard}<div id="mx-my-tracks">Загрузка…</div></div>`;
  try {
    const r = await MchatAPI.myTracks();
    const box = document.getElementById('mx-my-tracks');
    if (!box) return; // ушли со вкладки, пока грузилось
    box.innerHTML = r.tracks.length
      ? r.tracks.map(mxTrackRowHtml).join('')
      : '<div style="text-align:center;padding:20px 0;color:var(--text2);font-size:13px">Пока нет загруженных треков</div>';
  } catch (e) {
    const box = document.getElementById('mx-my-tracks');
    if (box) box.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--text2);font-size:13px">Не удалось загрузить список</div>';
  }
  if (savedTracks.length > 0) {
    let html = '<div style="padding:14px 4px 6px;font-size:13px;font-weight:700;color:var(--text2)">Сохранённые звуки из Reels</div><div class="tracks-grid">';
    savedTracks.forEach(t => {
      const audio = audioRegistry[t.id];
      const thumb = audio && audio.avatar ? audio.avatar : null;
      html += `<div class="track-card" onclick="openAudioModalById('${t.id}')">
        <div class="track-card-thumb">${thumb ? `<img src="${thumb}">` : `<svg width="24" height="24" fill="none" stroke="var(--text2)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`}</div>
        <div class="track-card-info">
          <div class="track-card-title">${esc(audio ? audio.title : t.title)}</div>
          <div class="track-card-artist">${esc(audio ? audio.artist : t.artist)}</div>
        </div>
      </div>`;
    });
    html += '</div>';
    cont.querySelector('.mx-tracks-wrap').insertAdjacentHTML('beforeend', html);
  }
}

// --- Edit Modal: Track Pinner ---
function renderEditModalTracks() {
  const section = document.getElementById('edit-tracks-section');
  const list = document.getElementById('edit-tracks-list');
  if (!section || !list) return;
  if (savedTracks.length === 0) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  const pinned = loadPinnedTracks();
  const pinnedIds = new Set(pinned.map(p => p.id));
  list.innerHTML = savedTracks.map(t => {
    const audio = audioRegistry[t.id];
    const isPinned = pinnedIds.has(t.id);
    const thumb = audio && audio.avatar ? audio.avatar : null;
    return `<div class="edit-track-row">
      ${thumb ? `<img src="${thumb}">` : `<div style="width:40px;height:40px;border-radius:8px;background:var(--surf2);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">${(audio ? audio.originalUploader : t.originalUploader || '?').charAt(0).toUpperCase()}</div>`}
      <div class="edit-track-row-info">
        <div class="edit-track-row-title">${audio ? audio.title : t.title}</div>
        <div class="edit-track-row-artist">${audio ? audio.artist : t.artist}</div>
      </div>
      <button class="edit-track-pin-btn ${isPinned ? 'pinned' : ''}" onclick="togglePinTrack('${t.id}', this)" title="${isPinned ? 'Открепить' : 'Закрепить'}">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      </button>
    </div>`;
  }).join('');
}
function togglePinTrack(audioId, btn) {
  let pinned = loadPinnedTracks();
  const idx = pinned.findIndex(p => p.id === audioId);
  if (idx >= 0) {
    pinned.splice(idx, 1);
    btn.classList.remove('pinned');
    btn.title = 'Закрепить';
  } else {
    if (pinned.length >= 3) { showToast('Максимум 3 закреплённых трека'); return; }
    pinned.push({ id: audioId });
    btn.classList.add('pinned');
    btn.title = 'Открепить';
  }
  savePinnedTracks(pinned);
  renderPinnedTracks();
}

// --- Hook into existing functions ---
const _origOpenVideoReels = openVideoReels;
openVideoReels = function(id) {
  _origOpenVideoReels(id);
  setTimeout(() => renderReelsOverlay(), 50);
};

const _origUpdateProfileUI = updateProfileUI;
updateProfileUI = function() {
  _origUpdateProfileUI();
  renderPinnedTracks();
};

const _origEditProfile = editProfile;
editProfile = function() {
  _origEditProfile();
  renderEditModalTracks();
};

const _origRenderProfileTabContent = renderProfileTabContent;
renderProfileTabContent = function() {
  if (currentProfileTab === 'tracks') {
    renderProfileTracksTab();
    return;
  }
  _origRenderProfileTabContent();
};

const _origInit = init;
init = function() {
  loadAudioRegistry();
  _origInit();
  if (currentUser) {
    loadSavedTracks();
    loadFollows();
    renderPinnedTracks();
  }
};

// --- Foreign profile: hide tracks tab, show pinned tracks if any ---
const _origOpenUserProfile = openUserProfile;
openUserProfile = function(username) {
  _origOpenUserProfile(username);
  // В чужом профиле скрываем вкладку треков
  const tracksTab = document.getElementById('ptab-tracks');
  if (tracksTab) tracksTab.style.display = (username === currentUser?.username) ? 'flex' : 'none';
  // Показываем закреплённые треки пользователя (если есть)
  const pinnedKey = 'mchat_pinned_tracks_' + username;
  let foreignPinned = [];
  try { foreignPinned = JSON.parse(localStorage.getItem(pinnedKey) || '[]'); } catch(e) {}
  if (foreignPinned.length > 0 && document.getElementById('user-profile-viewer')) {
    const data = loadUserData(username);
    let stripHtml = '<div style="display:flex;gap:8px;overflow-x:auto;padding:10px 0 6px;margin-top:4px;scrollbar-width:none">';
    foreignPinned.slice(0,3).forEach(t => {
      const audio = audioRegistry[t.id];
      if (!audio) return;
      stripHtml += `<div class="pinned-track-chip" onclick="openAudioModalById('${t.id}')">
        ${audio.avatar ? `<img src="${audio.avatar}">` : `<div style="width:24px;height:24px;border-radius:6px;background:var(--surf2);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">${audio.originalUploader.charAt(0).toUpperCase()}</div>`}
        <span>${audio.title}</span>
      </div>`;
    });
    stripHtml += '</div>';
    // Вставляем после bio в чужом профиле
    const upBio = document.getElementById('up-bio');
    if (upBio) {
      let existing = document.getElementById('up-pinned-tracks');
      if (!existing) {
        existing = document.createElement('div');
        existing.id = 'up-pinned-tracks';
        upBio.parentNode.insertBefore(existing, upBio.nextSibling);
      }
      existing.innerHTML = stripHtml;
    }
  }
};

// ============================================================
// АВАТАР / ШАПКА ЧАТА
// ============================================================
function mxOpenUserAvatar() {
  const img = document.querySelector('#up-avatar img');
  if (!img) return;
  document.getElementById('avatar-full-img').src = img.src;
  document.getElementById('avatar-fullscreen').classList.add('active');
}
function mxChatHeaderTap() {
  if (!currentChatMeta) return;
  if (currentChatMeta.type === 'DIRECT' && currentChatPeer) openUserProfile(currentChatPeer.username);
  else if (currentChatMeta.type === 'GROUP' || currentChatMeta.type === 'CHANNEL') mxOpenChatInfo();
}

// ---------- информация о группе/канале: участники, добавление позже, уведомления, выход ----------
let mxInfoMembers = [];
async function mxOpenChatInfo() {
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch) return;
  document.querySelectorAll('#mx-info-modal').forEach(x => x.remove());
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'mx-info-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = '<div class="mx-modal-box"><div style="padding:30px;text-align:center;color:var(--text2)">Загрузка…</div></div>';
  document.getElementById('app').appendChild(modal);
  try { mxInfoMembers = (await MchatAPI.chatMembers(ch.id)).members; }
  catch (e) { modal.remove(); showToast(MchatAPI.errorText(e)); return; }
  mxRenderChatInfo();
}
function mxRenderChatInfo() {
  const modal = document.getElementById('mx-info-modal');
  const ch = chats.find(c => c.id === currentChatId);
  if (!modal || !ch) return;
  const isChannel = ch.type === 'CHANNEL';
  const staff = ch.role === 'OWNER' || ch.role === 'ADMIN';
  const roleLabel = r => r === 'OWNER' ? 'создатель' : r === 'ADMIN' ? 'админ' : '';
  const members = mxInfoMembers.map(m => `<div style="display:flex;align-items:center;gap:10px;padding:7px 2px">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--surf2);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700">${m.avatar ? `<img src="${esc(m.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">` : esc((m.name || m.username).charAt(0).toUpperCase())}</div>
      <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name || m.username)}</div><div style="font-size:12px;color:var(--text2)">@${esc(m.username)}${roleLabel(m.role) ? ' · ' + roleLabel(m.role) : ''}</div></div>
      ${staff && m.role !== 'OWNER' && m.id !== currentUser.id && (ch.role === 'OWNER' || m.role === 'MEMBER') ? `<button onclick="mxKickMember('${esc(m.id)}')" style="background:none;border:none;color:#f43f5e;font-size:12px;cursor:pointer">Удалить</button>` : ''}
    </div>`).join('');
  modal.innerHTML = `<div class="mx-modal-box" style="max-height:88vh;overflow-y:auto">
    <h3 style="margin-bottom:4px">${esc(ch.name)}</h3>
    <div class="mx-hint" style="margin-bottom:10px">${isChannel ? 'Канал' : 'Группа'} · ${mxPlural(ch.memberCount, isChannel ? ['подписчик','подписчика','подписчиков'] : ['участник','участника','участников'])}</div>
    ${ch.description ? `<div style="font-size:13px;color:var(--text2);margin-bottom:12px">${esc(ch.description)}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--surf);border-radius:12px;padding:12px;margin-bottom:10px">
      <div style="font-size:14px">Уведомления</div>${mxSwitchHtml(!ch.muted, `mxToggleMute('${esc(ch.id)}')`)}
    </div>
    ${staff ? `<div class="mx-row-btns" style="margin-bottom:10px">
      <button class="mx-btn" onclick="mxOpenEditChat()">Изменить</button>
      <button class="mx-btn primary" onclick="mxOpenAddMembers()">Добавить участников</button>
    </div>` : ''}
    ${staff && ch.inviteCode ? `<button class="mx-btn" style="width:100%;margin-bottom:10px" onclick="mxCopyInvite()">Скопировать ссылку-приглашение</button>` : ''}
    <div style="font-size:11px;color:var(--text2);text-transform:uppercase;letter-spacing:.8px;margin:8px 0 2px">${isChannel ? 'Подписчики' : 'Участники'}</div>
    <div>${members}</div>
    ${ch.role !== 'OWNER' ? `<button class="mx-btn" style="width:100%;margin-top:12px;color:#f43f5e" onclick="mxLeaveChat()">${isChannel ? 'Отписаться' : 'Покинуть группу'}</button>` : ''}
    <button class="mx-btn" style="width:100%;margin-top:8px" onclick="document.getElementById('mx-info-modal').remove()">Закрыть</button>
  </div>`;
}
function mxSwitchHtml(on, onclick) {
  return `<div onclick="${onclick}" style="width:44px;height:26px;border-radius:13px;background:${on ? 'var(--accent)' : 'var(--surf2)'};position:relative;cursor:pointer;flex-shrink:0;transition:background .15s"><div style="position:absolute;top:3px;left:${on ? '21px' : '3px'};width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s"></div></div>`;
}
async function mxToggleMute(chatId) {
  const ch = chats.find(c => c.id === chatId);
  if (!ch) return;
  const muted = !ch.muted;
  try { await MchatAPI.muteChat(chatId, muted); ch.muted = muted; mxRenderChatInfo(); mxRefreshGlobalChannels(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
function mxCopyInvite() {
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch || !ch.inviteCode) return;
  const link = location.origin + '/join/' + ch.inviteCode;
  if (navigator.clipboard) navigator.clipboard.writeText(link).catch(() => {});
  showToast('Ссылка скопирована');
}
function mxKickMember(userId) {
  showConfirm('Удалить участника?', async () => {
    try { await MchatAPI.removeMember(currentChatId, userId); mxInfoMembers = mxInfoMembers.filter(m => m.id !== userId); await refreshChats(); mxRenderChatInfo(); }
    catch (e) { showToast(MchatAPI.errorText(e)); }
  });
}
function mxLeaveChat() {
  showConfirm('Выйти из чата?', async () => {
    try { await MchatAPI.removeMember(currentChatId, currentUser.id); const m = document.getElementById('mx-info-modal'); if (m) m.remove(); await refreshChats(); goTo('s-chats'); }
    catch (e) { showToast(MchatAPI.errorText(e)); }
  });
}
function mxOpenEditChat() {
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch) return;
  const modal = document.getElementById('mx-info-modal');
  modal.innerHTML = `<div class="mx-modal-box">
    <h3 style="margin-bottom:14px">Изменить</h3>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
      <div id="mx-edit-av" style="width:64px;height:64px;border-radius:50%;background:var(--surf2);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:24px">${chatAvatarHtml(ch)}</div>
      <button class="mx-btn" onclick="document.getElementById('mx-edit-av-file').click()">Сменить фото</button>
      <input type="file" id="mx-edit-av-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="mxChatAvatarChosen(event)">
    </div>
    <input class="mx-input" id="mx-edit-title" value="${esc(ch.name)}" maxlength="60" style="margin-bottom:10px">
    <textarea class="mx-input" id="mx-edit-desc" maxlength="200" style="margin-bottom:14px;min-height:70px;resize:vertical">${esc(ch.description || '')}</textarea>
    <div class="mx-row-btns"><button class="mx-btn" onclick="mxRenderChatInfo()">Назад</button><button class="mx-btn primary" onclick="mxSaveEditChat()">Сохранить</button></div>
  </div>`;
}
async function mxChatAvatarChosen(evt) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  try {
    showToast('Загружаю фото…');
    const up = await MchatAPI.uploadMedia('image', file, {});
    await MchatAPI.updateChat(currentChatId, { avatarMediaId: up.id });
    await refreshChats();
    const ch = chats.find(c => c.id === currentChatId);
    if (ch) {
      const big = document.getElementById('mx-edit-av'); if (big) big.innerHTML = chatAvatarHtml(ch);
      const head = document.getElementById('chat-open-av'); if (head && ch.avatar) head.innerHTML = chatAvatarHtml(ch);
    }
    showToast('Фото обновлено');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxSaveEditChat() {
  const title = document.getElementById('mx-edit-title').value.trim();
  const description = document.getElementById('mx-edit-desc').value.trim();
  if (!title) { showToast('Нужно название'); return; }
  try { await MchatAPI.updateChat(currentChatId, { title, description }); await refreshChats(); const ch = chats.find(c => c.id === currentChatId); if (ch) document.getElementById('chat-name').textContent = ch.name; mxRenderChatInfo(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxOpenAddMembers() {
  mxPick = new Set();
  const modal = document.getElementById('mx-info-modal');
  modal.innerHTML = '<div class="mx-modal-box"><div style="padding:30px;text-align:center;color:var(--text2)">Загрузка…</div></div>';
  try { mxContactsCache = (await MchatAPI.chatContacts()).contacts; }
  catch (e) { showToast(MchatAPI.errorText(e)); mxRenderChatInfo(); return; }
  const inChat = new Set(mxInfoMembers.map(m => m.id));
  const free = mxContactsCache.filter(c => !inChat.has(c.id));
  modal.innerHTML = `<div class="mx-modal-box">
    <h3 style="margin-bottom:10px">Добавить участников</h3>
    <div class="mx-hint" id="mx-create-count" style="margin-bottom:6px"></div>
    <div style="max-height:320px;overflow-y:auto;background:var(--surf);border-radius:12px;padding:4px 10px;margin-bottom:12px">${mxContactRowsHtml(free, 'mxToggleCreatePick')}</div>
    <div class="mx-row-btns"><button class="mx-btn" onclick="mxRenderChatInfo()">Назад</button><button class="mx-btn primary" onclick="mxSubmitAddMembers()">Добавить</button></div>
  </div>`;
}
async function mxSubmitAddMembers() {
  if (!mxPick.size) { showToast('Выбери хотя бы одного человека'); return; }
  try {
    const r = await MchatAPI.addMembers(currentChatId, [...mxPick]);
    mxInfoMembers = r.members;
    await refreshChats();
    showToast('Добавлено: ' + r.added);
    mxRenderChatInfo();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// ЗВОНКИ (LiveKit): полноэкранный экран, микрофон, камера, добавить участника, завершить
// ============================================================
let mxCall = null;      // активный звонок {id, chatId, video, isGroup, room, micOn, camOn, ...}
let mxIncoming = null;  // входящий, на который ещё не ответили
let mxRingCtl = null;

function mxLoadLiveKit() {
  if (window.LivekitClient) return Promise.resolve(window.LivekitClient);
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = '/vendor/livekit-client.umd.js';
    sc.onload = () => window.LivekitClient ? resolve(window.LivekitClient) : reject(new Error('livekit_missing'));
    sc.onerror = () => reject(new Error('livekit_load_failed'));
    document.head.appendChild(sc);
  });
}

function mxRingStart() {
  mxRingStop();
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const beep = () => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 440; g.gain.value = 0.07;
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.35);
    };
    beep();
    const iv = setInterval(() => { beep(); setTimeout(beep, 450); }, 2400);
    mxRingCtl = { ctx, iv };
  } catch (e) { mxRingCtl = null; }
  if (navigator.vibrate) navigator.vibrate([400, 250, 400]);
}
function mxRingStop() {
  if (!mxRingCtl) return;
  clearInterval(mxRingCtl.iv);
  try { mxRingCtl.ctx.close(); } catch (e) {}
  mxRingCtl = null;
  if (navigator.vibrate) navigator.vibrate(0);
}

function mxCallAvatarHtml(person) {
  if (person && person.avatar) return `<img src="${esc(person.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">`;
  return esc(((person && (person.name || person.username)) || '?').charAt(0).toUpperCase());
}

function mxCallLayout() {
  const grid = document.getElementById('call-grid');
  const n = grid.children.length;
  const cols = n <= 2 ? 1 : n <= 4 ? 2 : 3;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(n / cols))}, 1fr)`;
  document.getElementById('call-wait').style.display = n === 0 ? 'flex' : 'none';
  if (mxCall) mxCallUpdateStatus();
}

function mxCallTile(participant) {
  const grid = document.getElementById('call-grid');
  let tile = grid.querySelector(`[data-ident="${CSS.escape(participant.identity)}"]`);
  if (!tile) {
    tile = document.createElement('div');
    tile.className = 'call-tile';
    tile.dataset.ident = participant.identity;
    const nm = participant.name || participant.identity;
    tile.innerHTML = `<div class="ct-av">${esc(nm.charAt(0).toUpperCase())}</div><div class="ct-name">${esc(nm)}</div>`;
    grid.appendChild(tile);
    mxCallLayout();
  }
  return tile;
}

function mxCallRemoveTile(participant) {
  const tile = document.getElementById('call-grid').querySelector(`[data-ident="${CSS.escape(participant.identity)}"]`);
  if (tile) { tile.remove(); mxCallLayout(); }
}

function mxCallAttachTrack(track, participant) {
  const tile = mxCallTile(participant);
  if (track.kind === 'video') {
    let v = tile.querySelector('video');
    if (!v) { v = document.createElement('video'); v.autoplay = true; v.playsInline = true; tile.insertBefore(v, tile.firstChild); }
    track.attach(v);
  } else if (track.kind === 'audio') {
    let a = tile.querySelector('audio');
    if (!a) { a = document.createElement('audio'); a.autoplay = true; tile.appendChild(a); }
    track.attach(a);
  }
}

function mxCallUpdateStatus() {
  const el = document.getElementById('call-status');
  if (!mxCall || !el) return;
  const n = document.getElementById('call-grid').children.length;
  if (!n) { el.textContent = mxCall.outgoing ? 'Вызов…' : 'Ожидание…'; return; }
  const secs = Math.floor((Date.now() - (mxCall.startedAt || Date.now())) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0'), ss = String(secs % 60).padStart(2, '0');
  el.textContent = (n > 1 ? mxPlural(n + 1, ['участник', 'участника', 'участников']) + ' · ' : '') + mm + ':' + ss;
}

function mxCallShowScreen(title, person, video) {
  document.getElementById('call-title').textContent = title;
  document.getElementById('call-wait-av').innerHTML = mxCallAvatarHtml(person);
  document.getElementById('call-grid').innerHTML = '';
  document.getElementById('call-self').style.display = 'none';
  mxCallSetButtons(true, !!video);
  mxCallLayout();
  document.getElementById('call-screen').classList.add('active');
}

function mxCallSetButtons(micOn, camOn) {
  const set = (id, on) => {
    const b = document.getElementById(id);
    b.classList.toggle('off', !on);
    b.querySelector('.on-ico').style.display = on ? '' : 'none';
    b.querySelector('.off-ico').style.display = on ? 'none' : '';
  };
  set('call-mic', micOn); set('call-cam', camOn);
}

/** Подключаемся к комнате LiveKit с токеном, который выдал наш сервер. */
async function mxCallConnect(call, token, url) {
  const lk = await mxLoadLiveKit();
  const room = new lk.Room({ adaptiveStream: true, dynacast: true });
  call.room = room; call.lk = lk;
  const RE = lk.RoomEvent;
  room.on(RE.TrackSubscribed, (track, pub, participant) => {
    mxCallAttachTrack(track, participant);
    if (!call.startedAt) call.startedAt = Date.now();
  });
  room.on(RE.TrackUnsubscribed, (track) => { try { track.detach(); } catch (e) {} });
  room.on(RE.TrackMuted, (pub, participant) => {
    if (pub.kind === 'video' && participant !== room.localParticipant) {
      const v = mxCallTile(participant).querySelector('video'); if (v) v.style.display = 'none';
    }
  });
  room.on(RE.TrackUnmuted, (pub, participant) => {
    if (pub.kind === 'video' && participant !== room.localParticipant) {
      const v = mxCallTile(participant).querySelector('video'); if (v) v.style.display = '';
    }
  });
  room.on(RE.ParticipantConnected, (p) => { if (!call.startedAt) call.startedAt = Date.now(); mxRingStop(); mxCallTile(p); });
  room.on(RE.ParticipantDisconnected, (p) => {
    mxCallRemoveTile(p);
    // в личном звонке собеседник вышел — звонок окончен
    if (!call.isGroup && room.remoteParticipants.size === 0) mxCallCleanup('Звонок завершён');
  });
  room.on(RE.LocalTrackPublished, (pub) => {
    if (pub.source === lk.Track.Source.Camera && pub.track) { const el = document.getElementById('call-self'); pub.track.attach(el); el.style.display = 'block'; }
  });
  room.on(RE.LocalTrackUnpublished, (pub) => {
    if (pub.source === lk.Track.Source.Camera) document.getElementById('call-self').style.display = 'none';
  });
  room.on(RE.Disconnected, () => { if (mxCall === call) mxCallCleanup('Звонок завершён'); });

  await room.connect(url, token);
  call.connected = true;
  try { await room.startAudio(); } catch (e) { /* нужен жест пользователя — он только что нажал кнопку */ }
  try {
    await room.localParticipant.setMicrophoneEnabled(true);
  } catch (e) {
    mxCallCleanup('Нет доступа к микрофону. Разреши его в настройках браузера (нужен https или localhost)');
    return;
  }
  if (call.video) {
    try { await room.localParticipant.setCameraEnabled(true); mxCallSetButtons(true, true); }
    catch (e) { mxCallSetButtons(true, false); showToast('Нет доступа к камере'); }
  }
  room.remoteParticipants.forEach(p => { mxCallTile(p); if (!call.startedAt) call.startedAt = Date.now(); });
  call.timer = setInterval(mxCallUpdateStatus, 1000);
  mxCallUpdateStatus();
}

function mxCallCleanup(message) {
  mxRingStop();
  const call = mxCall;
  mxCall = null;
  if (call) {
    if (call.timer) clearInterval(call.timer);
    try { if (call.room) call.room.disconnect(); } catch (e) {}
    if (call.id && !call.leftSent) { call.leftSent = true; MchatAPI.leaveCall(call.id).catch(() => {}); }
  }
  document.getElementById('call-screen').classList.remove('active');
  document.getElementById('call-grid').innerHTML = '';
  const self = document.getElementById('call-self'); self.style.display = 'none'; self.srcObject = null;
  if (message) showToast(message);
}

/** Кнопка трубки в шапке чата: позвонить собеседнику / всей группе. */
async function mxStartCall(withVideo) {
  if (!currentChatId || !currentUser) return;
  if (mxCall || mxIncoming) { showToast('Ты уже в звонке'); return; }
  if (!window.isSecureContext) { showToast('Звонки работают только по https или на localhost'); return; }
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch || ch.type === 'CHANNEL') return;
  const person = ch.type === 'DIRECT' ? Object.assign({ name: ch.name }, ch.peer || {}, { avatar: ch.avatar || (ch.peer && ch.peer.avatar) }) : { name: ch.name, avatar: ch.avatar };
  let r;
  try { r = await MchatAPI.startCall(currentChatId, !!withVideo); }
  catch (e) { showToast(MchatAPI.errorText(e)); return; }
  const call = mxCall = { id: r.callId, chatId: currentChatId, outgoing: true, video: !!withVideo, isGroup: ch.type === 'GROUP', room: null, connected: false, startedAt: 0, timer: null };
  mxCallShowScreen(ch.name, person, withVideo);
  try { await mxCallConnect(call, r.token, r.url); }
  catch (e) { if (mxCall === call) mxCallCleanup('Не удалось подключиться к звонку' + (e && e.message ? ' (' + e.message + ')' : '')); }
}

// ---------- входящий ----------
function mxOnCallIncoming(p) {
  if (mxCall || mxIncoming) { MchatAPI.declineCall(p.callId).catch(() => {}); return; } // уже заняты
  mxIncoming = p;
  document.getElementById('ci-avatar').innerHTML = mxCallAvatarHtml(p.from);
  document.getElementById('ci-name').textContent = p.isGroup && p.title ? p.title : (p.from.name || p.from.username);
  document.getElementById('ci-kind').textContent = (p.isGroup ? (p.from.name || p.from.username) + ' · ' : '') + (p.video ? 'Входящий видеозвонок' : 'Входящий звонок');
  document.getElementById('call-incoming').classList.add('active');
  mxRingStart();
}
function mxHideIncoming() {
  mxIncoming = null;
  mxRingStop();
  document.getElementById('call-incoming').classList.remove('active');
}
function mxCallDecline() {
  const p = mxIncoming;
  mxHideIncoming();
  if (p) MchatAPI.declineCall(p.callId).catch(() => {});
}
async function mxCallAccept() {
  const p = mxIncoming;
  if (!p) return;
  mxHideIncoming();
  let r;
  try { r = await MchatAPI.acceptCall(p.callId); }
  catch (e) { showToast(MchatAPI.errorText(e)); return; }
  const call = mxCall = { id: p.callId, chatId: r.chatId, video: !!r.video, isGroup: !!r.isGroup, room: null, connected: false, startedAt: 0, timer: null };
  mxCallShowScreen(p.isGroup && p.title ? p.title : (p.from.name || p.from.username), p.from, r.video);
  try { await mxCallConnect(call, r.token, r.url); }
  catch (e) { if (mxCall === call) mxCallCleanup('Не удалось подключиться к звонку' + (e && e.message ? ' (' + e.message + ')' : '')); }
}
function mxOnCallEnded(p) {
  if (mxIncoming && mxIncoming.callId === p.callId) { mxHideIncoming(); showToast(p.reason === 'missed' ? 'Пропущенный звонок' : 'Звонок отменён'); return; }
  if (mxCall && mxCall.id === p.callId) {
    mxCall.leftSent = true; // сервер уже знает, что звонок окончен
    const msg = p.reason === 'declined' ? 'Звонок отклонён' : p.reason === 'missed' ? 'Никто не ответил' : 'Звонок завершён';
    mxCallCleanup(msg);
  }
}
function mxOnCallHandled(p) { // на другом моём устройстве ответили/отклонили
  if (mxIncoming && mxIncoming.callId === p.callId && !(mxCall && mxCall.id === p.callId)) mxHideIncoming();
}

// ---------- кнопки на экране звонка ----------
async function mxCallToggleMic() {
  if (!mxCall || !mxCall.room) return;
  const nowOn = !document.getElementById('call-mic').classList.contains('off');
  try {
    await mxCall.room.localParticipant.setMicrophoneEnabled(!nowOn);
    mxCallSetButtons(!nowOn, !document.getElementById('call-cam').classList.contains('off'));
  } catch (e) { showToast('Не удалось переключить микрофон'); }
}
async function mxCallToggleCam() {
  if (!mxCall || !mxCall.room) return;
  const nowOn = !document.getElementById('call-cam').classList.contains('off');
  try {
    await mxCall.room.localParticipant.setCameraEnabled(!nowOn);
    mxCallSetButtons(!document.getElementById('call-mic').classList.contains('off'), !nowOn);
  } catch (e) { showToast('Нет доступа к камере'); }
}
function mxCallEnd() { mxCallCleanup('Звонок завершён'); }

async function mxCallAddPeople() {
  if (!mxCall) return;
  mxPick = new Set();
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'call-add-modal';
  modal.style.zIndex = '980';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = '<div class="mx-modal-box"><h3>Добавить в звонок</h3><div id="call-add-list" style="max-height:320px;overflow-y:auto;background:var(--surf);border-radius:12px;padding:4px 10px"><div style="padding:14px;text-align:center;color:var(--text2)">Загрузка…</div></div><div class="mx-row-btns"><button class="mx-btn" onclick="document.getElementById(\'call-add-modal\').remove()">Отмена</button><button class="mx-btn primary" onclick="mxCallInviteSelected()">Позвонить</button></div></div>';
  document.getElementById('app').appendChild(modal);
  try {
    mxContactsCache = (await MchatAPI.chatContacts()).contacts;
    document.getElementById('call-add-list').innerHTML = mxContactRowsHtml(mxContactsCache, 'mxToggleCreatePick');
  } catch (e) { showToast(MchatAPI.errorText(e)); modal.remove(); }
}
async function mxCallInviteSelected() {
  if (!mxCall || !mxPick.size) { showToast('Выбери хотя бы одного человека'); return; }
  try {
    const r = await MchatAPI.inviteToCall(mxCall.id, [...mxPick]);
    mxCall.isGroup = true;
    const m = document.getElementById('call-add-modal'); if (m) m.remove();
    showToast('Звоним: ' + r.invited);
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// МЕНЮ ЧАТА (три точки) + КАСТОМИЗАЦИЯ ФОНА
// ============================================================
const MX_BG_PRESETS = [
  'linear-gradient(135deg,#4a4af0,#7c3aed)', 'linear-gradient(135deg,#f43f5e,#f97316)',
  'linear-gradient(135deg,#10b981,#06b6d4)', 'linear-gradient(135deg,#f59e0b,#eab308)',
  'linear-gradient(135deg,#6366f1,#ec4899)', 'linear-gradient(135deg,#111,#333)'
];
function mxBackgroundCss(bg) {
  if (!bg) return '';
  const dim = 'linear-gradient(rgba(0,0,0,.38),rgba(0,0,0,.38))';
  if (bg.type === 'preset') return MX_BG_PRESETS[Number(bg.value)] || '';
  if (bg.type === 'image' && bg.url) return `${dim},url("${String(bg.url).replace(/"/g, '%22')}") center/cover no-repeat`;
  if (bg.type === 'avatar' && currentUser && currentUser.avatar) return `${dim},url("${String(currentUser.avatar).replace(/"/g, '%22')}") center/cover no-repeat`;
  return '';
}
function mxApplyChatBackground() {
  const box = document.getElementById('messages-container');
  if (!box) return;
  const ch = chats.find(c => c.id === currentChatId);
  box.style.background = ch ? mxBackgroundCss(ch.background) : '';
}
function mxChatMenu() {
  if (!currentChatId) return;
  mxCloseFloating();
  const items = [
    mxCtxItem(MX_ICO.edit, 'Изменить чат', 'mxOpenChatCustomize()'),
    mxCtxItem(MX_ICO.reply, currentChatMeta && currentChatMeta.type === 'DIRECT' ? 'Профиль' : (currentChatMeta && currentChatMeta.type === 'CHANNEL' ? 'Настройки канала' : 'Настройки группы'), 'mxCloseFloating();mxChatHeaderTap()')
  ];
  const scrim = document.createElement('div');
  scrim.className = 'mx-ctx-scrim';
  scrim.onclick = mxCloseFloating;
  const panel = document.createElement('div');
  panel.className = 'mx-ctx';
  panel.innerHTML = items.join('');
  const app = document.getElementById('app');
  app.appendChild(scrim);
  app.appendChild(panel);
  const btn = document.getElementById('mx-chat-menu-btn').getBoundingClientRect();
  const appR = app.getBoundingClientRect();
  panel.style.top = (btn.bottom - appR.top + 6) + 'px';
  panel.style.right = Math.max(8, appR.right - btn.right) + 'px';
}
function mxOpenChatCustomize() {
  mxCloseFloating();
  const ch = chats.find(c => c.id === currentChatId);
  if (!ch) return;
  const sw = 'width:56px;height:56px;border-radius:14px;border:2px solid var(--border);cursor:pointer;flex-shrink:0;';
  const presets = MX_BG_PRESETS.map((g, i) => `<div style="${sw}background:${g}" onclick="mxSetChatBackground('preset:${i}')"></div>`).join('');
  const hasAvatar = currentUser && currentUser.avatar;
  const sheet = document.createElement('div');
  sheet.className = 'mx-ctx-scrim';
  sheet.id = 'mx-customize';
  sheet.style.cssText = 'display:flex;align-items:flex-end;background:rgba(0,0,0,.6)';
  sheet.onclick = (e) => { if (e.target === sheet) mxCloseCustomize(); };
  sheet.innerHTML = `<div style="width:100%;background:var(--bg2);border-radius:22px 22px 0 0;padding:18px 16px calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px">
    <div style="font-weight:700;font-size:17px">Фон чата</div>
    <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:2px">${presets}</div>
    ${hasAvatar ? `<button class="mx-cz-btn" onclick="mxSetChatBackground('avatar')">Фото из моего профиля</button>` : ''}
    <button class="mx-cz-btn" onclick="document.getElementById('mx-bg-file').click()">Загрузить фото</button>
    <button class="mx-cz-btn" style="color:#f43f5e" onclick="mxSetChatBackground(null)">Сбросить фон</button>
    <input type="file" id="mx-bg-file" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="mxBackgroundChosen(event)">
  </div>`;
  document.getElementById('app').appendChild(sheet);
}
function mxCloseCustomize() {
  const el = document.getElementById('mx-customize');
  if (el) el.remove();
}
async function mxSetChatBackground(value) {
  const chatId = currentChatId;
  try {
    const r = await MchatAPI.setChatBackground(chatId, value);
    const ch = chats.find(c => c.id === chatId);
    if (ch) ch.background = r.chat.background || null;
    mxApplyChatBackground();
    mxCloseCustomize();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxBackgroundChosen(evt) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  try {
    showToast('Загружаю фон…');
    const media = await MchatAPI.uploadMedia('image', file, {});
    await mxSetChatBackground('media:' + media.id);
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// ДРУЗЬЯ
// ============================================================
const MX_FRIEND_LABEL = { none: 'Добавить в друзья', outgoing: 'Заявка отправлена', incoming: 'Принять заявку', friends: 'В друзьях' };
function mxRenderFriendButton() {
  const btn = document.getElementById('up-friend-btn');
  const decline = document.getElementById('up-friend-decline');
  if (!btn) return;
  const s = upFriendState.status;
  if (!s || s === 'self' || !upViewedUsername) { btn.style.display = 'none'; if (decline) decline.style.display = 'none'; return; }
  btn.style.display = 'inline-flex';
  btn.disabled = false;
  btn.className = 'mx-friend-btn' + (s === 'none' ? ' add' : s === 'outgoing' ? ' pending' : s === 'friends' ? ' friends' : s === 'incoming' ? ' accept' : '');
  btn.textContent = MX_FRIEND_LABEL[s] || MX_FRIEND_LABEL.none;
  if (decline) decline.style.display = (s === 'incoming') ? 'inline-flex' : 'none';
}
async function mxFriendAction() {
  const btn = document.getElementById('up-friend-btn');
  if (!upViewedUsername || !btn || btn.disabled) return;
  btn.disabled = true;
  try {
    if (upFriendState.status === 'none') {
      upFriendState = await MchatAPI.friendRequest(upViewedUsername);
    } else if (upFriendState.status === 'outgoing') {
      upFriendState = await MchatAPI.friendRemove(upFriendState.id);
    } else if (upFriendState.status === 'incoming') {
      upFriendState = await MchatAPI.friendAccept(upFriendState.id);
      showToast('Теперь вы друзья');
    } else if (upFriendState.status === 'friends') {
      btn.disabled = false;
      showConfirm('Удалить из друзей?', async () => {
        try { upFriendState = await MchatAPI.friendRemove(upFriendState.id); mxRenderFriendButton(); }
        catch (e) { showToast(MchatAPI.errorText(e)); }
      });
      return;
    }
    mxRenderFriendButton();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
  finally { btn.disabled = false; }
}
async function mxFriendDecline() {
  if (!upFriendState.id) return;
  try { upFriendState = await MchatAPI.friendRemove(upFriendState.id); mxRenderFriendButton(); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
function mxSetPresenceText(elId, online, lastSeenAt) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (online === true) { el.textContent = 'онлайн'; el.classList.add('online'); }
  else if (online === false && lastSeenAt) { el.textContent = 'был(а) ' + fmtChatTime(lastSeenAt); el.classList.remove('online'); }
  else { el.textContent = ''; el.classList.remove('online'); }
}

// ============================================================
// ЗАКРЕПЛЁННОЕ СООБЩЕНИЕ
// ============================================================
function renderPinnedBar(pinned) {
  currentChatPinned = pinned || null;
  const bar = document.getElementById('mx-pinned');
  if (!bar) return;
  if (!pinned) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  const textEl = document.getElementById('mx-pinned-text');
  if (textEl) textEl.textContent = msgPreview(pinned);
  const canUnpin = currentChatMeta && currentChatMeta.canModerate;
  const xBtn = document.getElementById('mx-pinned-x');
  if (xBtn) xBtn.style.display = canUnpin ? 'flex' : 'none';
}
function mxScrollToPinned() {
  if (currentChatPinned) mxScrollToMessage(currentChatPinned.id);
}
async function mxUnpin() {
  if (!currentChatId) return;
  try { await MchatAPI.pin(currentChatId, null); renderPinnedBar(null); }
  catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxPin(id) {
  if (!currentChatId) return;
  try {
    const msg = await MchatAPI.pin(currentChatId, id);
    renderPinnedBar(msg);
    const ch = chats.find(c => c.id === currentChatId);
    if (ch) ch.pinned = msg;
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// РЕАКЦИИ: клик по сообщению → быстрый выбор эмодзи
// ============================================================
const MX_QUICK_EMOJI = ['\uD83D\uDC4D','\u2764\uFE0F','\uD83D\uDE02','\uD83D\uDE2E','\uD83D\uDE22','\uD83D\uDD25'];
function mxCloseFloating() {
  document.querySelectorAll('.mx-react, .mx-ctx, .mx-ctx-scrim').forEach(el => el.remove());
}
function mxPositionNear(el, panel) {
  const r = el.getBoundingClientRect();
  const pw = 260, vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(Math.max(8, r.left), vw - pw - 8);
  let top = r.top - 56;
  if (top < 8) top = r.bottom + 8;
  if (top > vh - 60) top = vh - 60;
  panel.style.left = left + 'px';
  panel.style.top = top + 'px';
}
function mxOpenReactions(id, evt) {
  mxCloseFloating();
  if (!currentUser) return;
  const list = messages[currentChatId] || [];
  const msg = list.find(m => m.id === id);
  if (!msg || msg.pending) return;
  const scrim = document.createElement('div');
  scrim.className = 'mx-ctx-scrim';
  scrim.onclick = mxCloseFloating;
  const panel = document.createElement('div');
  panel.className = 'mx-react';
  const mine = (msg.reactions || []).find(r => r.emoji && r.userIds.includes(currentUser.id));
  panel.innerHTML = MX_QUICK_EMOJI.map(e => `<button class="${mine && mine.emoji===e?'mine':''}" onclick="mxPickReaction('${esc(id)}','${e}')">${e}</button>`).join('');
  document.getElementById('app').appendChild(scrim);
  document.getElementById('app').appendChild(panel);
  mxPositionNear(evt.currentTarget || evt.target, panel);
}
async function mxPickReaction(id, emoji) {
  mxCloseFloating();
  try {
    const r = await MchatAPI.react(id, emoji);
    const list = messages[r.chatId]; if (!list) return;
    const msg = list.find(m => m.id === id);
    if (msg) { msg.reactions = r.reactions || []; if (currentChatId === r.chatId) renderMessages(r.chatId); }
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}

// ============================================================
// КОНТЕКСТНОЕ МЕНЮ: зажатие (моб.) / ПКМ (десктоп)
// ============================================================
function mxCtxItem(icon, label, onclick, danger) {
  return `<button ${danger?'class="danger"':''} onclick="${onclick}">${icon}<span>${label}</span></button>`;
}
const MX_ICO = {
  reply: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/></svg>',
  copy: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
  fwd: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 014-4h12"/></svg>',
  pin: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 7 3 3H7l3-3z"/></svg>',
  edit: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4z"/></svg>',
  del: '<svg width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
};
function mxOpenContextMenu(id, evt) {
  mxCloseFloating();
  if (!currentUser) return;
  const list = messages[currentChatId] || [];
  const msg = list.find(m => m.id === id);
  if (!msg || msg.pending) return;
  const mine = msg.outgoing;
  const canModerate = currentChatMeta && currentChatMeta.canModerate;
  const buttons = [];
  buttons.push(mxCtxItem(MX_ICO.reply, 'Ответить', `mxReplyTo('${esc(id)}')`));
  if (msg.kind === 'TEXT' && msg.text) buttons.push(mxCtxItem(MX_ICO.copy, 'Копировать', `mxCopyMessage('${esc(id)}')`));
  buttons.push(mxCtxItem(MX_ICO.fwd, 'Переслать', `mxForwardMessage('${esc(id)}')`));
  if (mine || canModerate) buttons.push(mxCtxItem(MX_ICO.pin, 'Закрепить', `mxPin('${esc(id)}')`));
  if (mine && msg.kind === 'TEXT') buttons.push(mxCtxItem(MX_ICO.edit, 'Изменить', `mxEditMessage('${esc(id)}')`));
  buttons.push(mxCtxItem(MX_ICO.del, mine ? 'Удалить у всех' : 'Удалить у меня', `mxDeleteMessage('${esc(id)}')`, true));
  const scrim = document.createElement('div');
  scrim.className = 'mx-ctx-scrim';
  scrim.onclick = mxCloseFloating;
  const panel = document.createElement('div');
  panel.className = 'mx-ctx';
  panel.innerHTML = buttons.join('');
  document.getElementById('app').appendChild(scrim);
  document.getElementById('app').appendChild(panel);
  mxPositionNear(evt.currentTarget || evt.target, panel);
}
function mxReplyTo(id) {
  mxCloseFloating();
  const msg = (messages[currentChatId] || []).find(m => m.id === id);
  if (!msg) return;
  replyToMsg = msg;
  const bar = document.getElementById('mx-ctxbar');
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('mx-ctxbar-title').textContent = 'Ответ ' + (msg.outgoing ? 'себе' : (msg.senderName || 'собеседнику'));
    document.getElementById('mx-ctxbar-text').textContent = msgPreview(msg);
  }
  const input = document.getElementById('message-input');
  if (input) input.focus();
}
function mxCancelCompose() {
  replyToMsg = null;
  if (window._mxEditingId) {
    window._mxEditingId = null;
    const input = document.getElementById('message-input');
    if (input) { input.value = ''; mxOnComposeInput(); }
  }
  const bar = document.getElementById('mx-ctxbar');
  if (bar) bar.style.display = 'none';
}
function mxCopyMessage(id) {
  mxCloseFloating();
  const msg = (messages[currentChatId] || []).find(m => m.id === id);
  if (!msg) return;
  const text = msg.kind === 'TEXT' ? msg.text : msgPreview(msg);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => showToast('Скопировано'), () => showToast('Не удалось скопировать'));
}
function mxForwardMessage(id) {
  mxCloseFloating();
  const msg = (messages[currentChatId] || []).find(m => m.id === id);
  if (!msg) return;
  if (chats.length === 0) { showToast('Нет чатов для пересылки'); return; }
  const scrim = document.createElement('div');
  scrim.className = 'sheet active';
  scrim.onclick = (e) => { if (e.target === scrim) scrim.remove(); };
  scrim.innerHTML = `<div class="sheet-body">
    <div style="width:36px;height:4px;background:var(--surf2);border-radius:4px;margin:0 auto 18px"></div>
    <div style="font-family:var(--font);font-size:18px;font-weight:800;margin-bottom:14px">Переслать в…</div>
    <div style="max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px">
      ${chats.map(ch => `<div class="mx-pick" onclick="mxForwardTo('${esc(id)}','${esc(ch.id)}')">
        <div class="av">${chatAvatarHtml(ch)}</div><div class="nm">${esc(ch.name)}</div>
      </div>`).join('')}
    </div>
  </div>`;
  document.getElementById('app').appendChild(scrim);
}
async function mxForwardTo(id, chatId) {
  document.querySelectorAll('.sheet.active').forEach(el => el.remove());
  try {
    const saved = await MchatAPI.forward(id, chatId);
    onIncomingMessage(saved);
    showToast('Переслано');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
function mxEditMessage(id) {
  mxCloseFloating();
  const msg = (messages[currentChatId] || []).find(m => m.id === id);
  if (!msg) return;
  const input = document.getElementById('message-input');
  if (!input) return;
  input.value = msg.text;
  mxOnComposeInput();
  input.focus();
  replyToMsg = null;
  const bar = document.getElementById('mx-ctxbar');
  if (bar) {
    bar.style.display = 'flex';
    document.getElementById('mx-ctxbar-title').textContent = 'Изменить сообщение';
    document.getElementById('mx-ctxbar-text').textContent = msg.text;
  }
  window._mxEditingId = id;
}
async function mxDeleteMessage(id) {
  mxCloseFloating();
  const chatId = currentChatId;
  const msg = (messages[chatId] || []).find(m => m.id === id);
  if (!msg) return;
  // своё сообщение — у всех (через сокет уйдёт собеседнику), чужое — только из моей ленты
  const scope = msg.outgoing ? 'all' : 'me';
  showConfirm(scope === 'all' ? 'Удалить сообщение у всех?' : 'Удалить сообщение только у вас?', async () => {
    try {
      await MchatAPI.deleteMessage(id, scope);
      const list = messages[chatId];
      if (list) { messages[chatId] = list.filter(m => m.id !== id); renderMessages(chatId); }
    } catch (e) { showToast(MchatAPI.errorText(e)); }
  });
}

// ============================================================
// ПОЛЕ ВВОДА: переключение микрофон/отправить
// ============================================================
function mxOnComposeInput() {
  const input = document.getElementById('message-input');
  const mic = document.getElementById('mx-mic-btn');
  const send = document.getElementById('mx-send-btn');
  if (!input || !mic || !send) return;
  const has = input.value.trim().length > 0;
  mic.style.display = has ? 'none' : 'flex';
  send.style.display = has ? 'flex' : 'none';
}

// ============================================================
// FAB: создать группу / канал
// ============================================================
function mxFabToggle() {
  const fab = document.getElementById('mx-fab');
  const menu = document.getElementById('mx-fab-menu');
  const scrim = document.getElementById('mx-fab-scrim');
  const open = !menu.classList.contains('open');
  fab.classList.toggle('open', open);
  menu.classList.toggle('open', open);
  scrim.classList.toggle('open', open);
}
function mxFabClose() {
  document.getElementById('mx-fab').classList.remove('open');
  document.getElementById('mx-fab-menu').classList.remove('open');
  document.getElementById('mx-fab-scrim').classList.remove('open');
}
let mxCreateType = 'GROUP';
let mxCreateSelected = [];
let mxPick = new Set();       // выбранные контакты (id)
let mxContactsCache = [];     // контакты с сервера

function mxContactRowsHtml(list, onToggle) {
  if (!list.length) return '<div style="text-align:center;padding:16px;color:var(--text2);font-size:13px">Контактов пока нет. Напиши кому-нибудь или добавь друга — они появятся здесь</div>';
  return list.map(c => `<label style="display:flex;align-items:center;gap:10px;padding:8px 4px;cursor:pointer">
    <input type="checkbox" ${mxPick.has(c.id) ? 'checked' : ''} onchange="${onToggle}('${esc(c.id)}',this.checked)" style="width:18px;height:18px;accent-color:var(--accent);flex-shrink:0">
    <div style="width:36px;height:36px;border-radius:50%;background:var(--surf2);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-weight:700">${c.avatar ? `<img src="${esc(c.avatar)}" style="width:100%;height:100%;object-fit:cover" referrerpolicy="no-referrer">` : esc((c.name || c.username).charAt(0).toUpperCase())}</div>
    <div style="min-width:0"><div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name || c.username)}</div><div style="font-size:12px;color:var(--text2)">@${esc(c.username)}</div></div>
  </label>`).join('');
}
function mxToggleCreatePick(id, on) { if (on) mxPick.add(id); else mxPick.delete(id); mxUpdateCreateCount(); }
function mxUpdateCreateCount() { const el = document.getElementById('mx-create-count'); if (el) el.textContent = mxPick.size ? 'Выбрано: ' + mxPick.size : ''; }

async function mxOpenCreate(type) {
  mxFabClose();
  mxCreateType = type === 'channel' ? 'CHANNEL' : 'GROUP';
  mxPick = new Set();
  const isChannel = mxCreateType === 'CHANNEL';
  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'mx-create-modal';
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="mx-modal-box">
    <h3 style="margin-bottom:14px">${isChannel ? 'Новый канал' : 'Новая группа'}</h3>
    <input class="mx-input" id="mx-create-title" placeholder="${isChannel ? 'Название канала' : 'Название группы'}" maxlength="60" style="margin-bottom:10px">
    <textarea class="mx-input" id="mx-create-desc" placeholder="Описание (необязательно)" maxlength="200" style="margin-bottom:10px;min-height:60px;resize:vertical"></textarea>
    ${isChannel ? `<label style="display:flex;align-items:center;gap:10px;margin-bottom:10px;cursor:pointer;font-size:14px"><input type="checkbox" id="mx-create-public" checked style="width:18px;height:18px;accent-color:var(--accent)"> Публичный канал (его можно найти в поиске)</label>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin:4px 0"><div class="mx-hint" style="margin:0">Участники из контактов</div><div class="mx-hint" style="margin:0" id="mx-create-count"></div></div>
    <div id="mx-create-contacts" style="max-height:200px;overflow-y:auto;background:var(--surf);border-radius:12px;padding:4px 10px;margin-bottom:10px"><div style="padding:14px;text-align:center;color:var(--text2);font-size:13px">Загрузка…</div></div>
    <div class="mx-hint" style="margin-bottom:14px">${isChannel ? 'Вы станете администратором: публиковать посты сможете только вы, остальные — читать.' : 'Других людей можно добавить позже, в настройках группы.'}</div>
    <div class="mx-row-btns">
      <button class="mx-btn" onclick="document.getElementById('mx-create-modal').remove()">Отмена</button>
      <button class="mx-btn primary" id="mx-create-submit" onclick="mxSubmitCreate()">Создать</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(modal);
  setTimeout(() => document.getElementById('mx-create-title').focus(), 50);
  try {
    mxContactsCache = (await MchatAPI.chatContacts()).contacts;
    const box = document.getElementById('mx-create-contacts');
    if (box) box.innerHTML = mxContactRowsHtml(mxContactsCache, 'mxToggleCreatePick');
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
async function mxSubmitCreate() {
  const title = document.getElementById('mx-create-title').value.trim();
  const description = document.getElementById('mx-create-desc').value.trim();
  const usernames = mxContactsCache.filter(c => mxPick.has(c.id)).map(c => c.username);
  const pub = document.getElementById('mx-create-public');
  if (!title) { showToast('Нужно название'); return; }
  const btn = document.getElementById('mx-create-submit');
  btn.disabled = true;
  try {
    const r = await MchatAPI.createGroup({ type: mxCreateType, title, description: description || undefined, usernames, isPublic: pub ? pub.checked : undefined });
    const modal = document.getElementById('mx-create-modal');
    if (modal) modal.remove();
    const ch = chatFromServer(r.chat);
    chats.unshift(ch);
    renderChats();
    openChat(ch.id);
  } catch (e) { showToast(MchatAPI.errorText(e)); btn.disabled = false; }
}

// ============================================================
// ТОСТ + ЗВУК ПРИ НОВОМ СООБЩЕНИИ (если человек не в этом чате)
// ============================================================
function playNotifySound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.24);
    setTimeout(() => ctx.close(), 400);
  } catch (e) { /* звук не критичен */ }
}
function mxNotifyIncoming(ch, m) {
  playNotifySound();
  const toast = document.createElement('div');
  toast.className = 'mx-toast';
  toast.onclick = () => { toast.remove(); openChatById(ch.id); };
  toast.innerHTML = `<div class="av">${chatAvatarHtml(ch)}</div>
    <div class="tx"><div class="t1">${esc(ch.name)}</div><div class="t2">${esc(msgPreview(m))}</div></div>`;
  document.getElementById('app').appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ============================================================
// БЕЙДЖ НЕПРОЧИТАННЫХ НА НИЖНЕЙ НАВИГАЦИИ
// ============================================================
function updateNavBadge() {
  const total = chats.reduce((sum, c) => sum + (c.unread || 0), 0);
  document.querySelectorAll('.island-nav .nb[onclick*="s-chats"]').forEach(btn => {
    let b = btn.querySelector('.mx-nav-badge');
    if (total > 0) {
      if (!b) { b = document.createElement('span'); b.className = 'mx-nav-badge'; btn.appendChild(b); }
      b.textContent = total > 99 ? '99+' : String(total);
    } else if (b) { b.remove(); }
  });
}

// ============================================================
// ГОЛОСОВЫЕ СООБЩЕНИЯ: запись
// ============================================================
let mxRec = null; // { recorder, chunks, stream, startedAt, timer, blob, mime, elapsed }
function mxPickMime(kinds) {
  if (!window.MediaRecorder) return null;
  for (const k of kinds) { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(k)) return k; }
  return '';
}
async function mxVoiceStart() {
  if (mxRec) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showToast('Микрофон недоступен в этом браузере'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (e) { showToast('Нет доступа к микрофону'); return; }
  const mime = mxPickMime(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);
  let recorder;
  try { recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
  catch (e) { stream.getTracks().forEach(t => t.stop()); showToast('Запись не поддерживается'); return; }
  mxRec = { recorder, chunks: [], stream, startedAt: Date.now(), timer: null, blob: null, mime: recorder.mimeType || 'audio/webm', elapsed: 0, previewing: false };
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) mxRec.chunks.push(e.data); };
  recorder.start();
  document.getElementById('mx-input-row').style.display = 'none';
  document.getElementById('mx-rec').style.display = 'flex';
  document.getElementById('mx-rec-live').style.display = 'flex';
  document.getElementById('mx-rec-prev').style.display = 'none';
  mxRec.timer = setInterval(() => {
    mxRec.elapsed = Math.floor((Date.now() - mxRec.startedAt) / 1000);
    document.getElementById('mx-rec-time').textContent = fmtDur(mxRec.elapsed);
    if (mxRec.elapsed >= 120) mxVoiceStopToPreview(); // потолок записи — 2 минуты
  }, 250);
}
function mxVoiceStopToPreview() {
  if (!mxRec || mxRec.recorder.state === 'inactive') return;
  clearInterval(mxRec.timer);
  mxRec.recorder.onstop = () => {
    mxRec.blob = new Blob(mxRec.chunks, { type: mxRec.mime });
    mxRec.stream.getTracks().forEach(t => t.stop());
    document.getElementById('mx-rec-live').style.display = 'none';
    document.getElementById('mx-rec-prev').style.display = 'flex';
    document.getElementById('mx-prev-time').textContent = fmtDur(mxRec.elapsed);
    document.getElementById('mx-prev-fill').style.width = '0%';
  };
  mxRec.recorder.stop();
}
/** Главная кнопка: во время записи — остановить и показать превью; в превью — отправить. */
function mxVoiceMain() {
  if (!mxRec) return;
  if (mxRec.recorder.state === 'recording') { mxVoiceStopToPreview(); return; }
  mxVoiceSend();
}
async function mxVoiceSend() {
  if (!mxRec || !mxRec.blob || !currentChatId) return;
  const rec = mxRec; mxRec = null;
  if (rec.previewAudio) { rec.previewAudio.pause(); }
  document.getElementById('mx-rec').style.display = 'none';
  document.getElementById('mx-input-row').style.display = 'flex';
  const chatId = currentChatId;
  try {
    const media = await MchatAPI.uploadMedia('voice', rec.blob, { duration: rec.elapsed });
    const saved = await MchatAPI.sendMessage(chatId, '', MchatAPI.newClientId(), { kind: 'VOICE', mediaId: media.id, durationSec: rec.elapsed });
    onIncomingMessage(saved);
  } catch (e) { showToast(MchatAPI.errorText(e)); }
}
function mxVoiceCancel() {
  if (!mxRec) return;
  clearInterval(mxRec.timer);
  if (mxRec.previewAudio) mxRec.previewAudio.pause();
  try { if (mxRec.recorder.state !== 'inactive') mxRec.recorder.stop(); } catch (e) {}
  mxRec.stream.getTracks().forEach(t => t.stop());
  mxRec = null;
  document.getElementById('mx-rec').style.display = 'none';
  document.getElementById('mx-input-row').style.display = 'flex';
}
function mxPreviewToggle() {
  if (!mxRec || !mxRec.blob) return;
  if (!mxRec.previewAudio) {
    const a = new Audio(URL.createObjectURL(mxRec.blob));
    a.addEventListener('timeupdate', () => {
      if (!mxRec) return;
      const pct = a.duration ? (a.currentTime / a.duration) * 100 : 0;
      const fill = document.getElementById('mx-prev-fill'); if (fill) fill.style.width = pct + '%';
      const t = document.getElementById('mx-prev-time'); if (t) t.textContent = fmtDur(a.currentTime);
    });
    a.addEventListener('ended', () => {
      document.getElementById('mx-prev-play').innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
      const t = document.getElementById('mx-prev-time'); if (t) t.textContent = fmtDur(mxRec.elapsed);
      const fill = document.getElementById('mx-prev-fill'); if (fill) fill.style.width = '0%';
    });
    mxRec.previewAudio = a;
  }
  const btn = document.getElementById('mx-prev-play');
  if (mxRec.previewAudio.paused) {
    mxRec.previewAudio.play().catch(()=>{});
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  } else {
    mxRec.previewAudio.pause();
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  }
}

// ============================================================
// ГОЛОСОВЫЕ / ВИДЕОКРУЖКИ: воспроизведение в чате
// ============================================================
function mxVoicePlayToggle(btn, msgId) {
  const wrap = btn.closest('.mx-voice');
  const url = wrap && wrap.getAttribute('data-audio-url');
  if (!url) return;
  const playIco = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  const pauseIco = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  let a = window._mxVoiceAudio;
  if (a && window._mxVoicePlayingId === msgId) {
    if (a.paused) { a.play().catch(()=>{}); btn.innerHTML = pauseIco; } else { a.pause(); btn.innerHTML = playIco; }
    return;
  }
  if (a) { a.pause(); document.querySelectorAll('.mx-voice .mx-vplay').forEach(b => b.innerHTML = playIco); }
  a = new Audio(url);
  window._mxVoiceAudio = a; window._mxVoicePlayingId = msgId;
  a.addEventListener('timeupdate', () => {
    if (window._mxVoicePlayingId !== msgId) return;
    const pct = a.duration ? (a.currentTime / a.duration) * 100 : 0;
    const fill = wrap.querySelector('.mx-prog-fill'); if (fill) fill.style.width = pct + '%';
  });
  a.addEventListener('ended', () => { btn.innerHTML = playIco; const fill = wrap.querySelector('.mx-prog-fill'); if (fill) fill.style.width = '0%'; });
  a.play().catch(() => showToast('Не удалось воспроизвести'));
  btn.innerHTML = pauseIco;
}
function mxVoiceSeek(evt, progEl) {
  const a = window._mxVoiceAudio;
  const wrap = progEl.closest('.mx-voice');
  if (!a || !wrap || !wrap.getAttribute('data-audio-url') || !a.duration) return;
  const r = progEl.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (evt.clientX - r.left) / r.width));
  a.currentTime = pct * a.duration;
}
// WebM из MediaRecorder приходит без длительности (Infinity) — из-за этого кружок «скачет»/крутится назад.
// Один раз промотав в конец и вернувшись в начало, браузер узнаёт длительность и играет строго вперёд.
function mxFixWebmDuration(video) {
  if (!video || Number.isFinite(video.duration) || video._durFixed) return;
  video._durFixed = true;
  const back = () => { video.removeEventListener('timeupdate', back); video.currentTime = 0; };
  video.addEventListener('timeupdate', back);
  video.currentTime = 1e101;
}
function mxVideoNoteToggle(wrap) {
  const video = wrap.querySelector('video');
  if (!video) return;
  video.defaultPlaybackRate = 1; video.playbackRate = 1; // только вперёд
  if (video.paused) {
    if (video.ended) video.currentTime = 0;
    video.muted = false; video.play().catch(()=>{}); wrap.classList.add('playing');
  } else { video.pause(); wrap.classList.remove('playing'); }
}
async function mxCameraOpen() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { showToast('Камера недоступна в этом браузере'); return; }
  mxCam = { facing: 'user', mode: 'circle', chunks: [], blob: null, photoBlob: null, recording: false, elapsed: 0, timer: null };
  document.getElementById('mx-camera').classList.add('active');
  document.getElementById('mx-camera').classList.remove('photo', 'recording');
  document.getElementById('mx-mode-circle').classList.add('on');
  document.getElementById('mx-mode-photo').classList.remove('on');
  document.getElementById('mx-cam-live').style.display = 'flex';
  document.getElementById('mx-cam-review').style.display = 'none';
  await mxCameraStartStream();
}
async function mxCameraStartStream() {
  if (!mxCam) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mxCam.facing }, audio: mxCam.mode === 'circle' });
    mxCam.stream = stream;
    const video = document.getElementById('mx-cam-video');
    video.srcObject = stream;
    video.classList.toggle('mirror', mxCam.facing === 'user');
  } catch (e) { showToast('Нет доступа к камере'); mxCameraClose(); }
}
function mxCameraClose() {
  if (mxCam) {
    clearInterval(mxCam.timer);
    if (mxCam.recorder && mxCam.recorder.state !== 'inactive') { try { mxCam.recorder.stop(); } catch (e) {} }
    if (mxCam.mirror) { mxCam.mirror.stop(); mxCam.mirror = null; }
    if (mxCam.stream) mxCam.stream.getTracks().forEach(t => t.stop());
  }
  mxCam = null;
  document.getElementById('mx-camera').classList.remove('active');
  const video = document.getElementById('mx-cam-video');
  video.srcObject = null;
  const still = document.querySelector('.mx-still'); if (still) still.remove();
  video.style.display = '';
}
async function mxCameraFlip() {
  if (!mxCam || mxCam.recording) return;
  mxCam.facing = mxCam.facing === 'user' ? 'environment' : 'user';
  if (mxCam.stream) mxCam.stream.getTracks().forEach(t => t.stop());
  await mxCameraStartStream();
}
function mxCameraMode(mode) {
  if (!mxCam || mxCam.recording) return;
  mxCam.mode = mode;
  document.getElementById('mx-camera').classList.toggle('photo', mode === 'photo');
  document.getElementById('mx-mode-circle').classList.toggle('on', mode === 'circle');
  document.getElementById('mx-mode-photo').classList.toggle('on', mode === 'photo');
  mxCameraStartStream(); // фото не пишет звук — переоткрываем поток без аудио
}
function mxCameraShutter() {
  if (!mxCam) return;
  if (mxCam.mode === 'photo') { mxCameraTakePhoto(); return; }
  if (!mxCam.recording) mxCameraStartRecording(); else mxCameraStopRecording();
}
function mxCameraTakePhoto() {
  const video = document.getElementById('mx-cam-video');
  const size = Math.min(video.videoWidth || 480, video.videoHeight || 480);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 480; canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  if (mxCam.facing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((blob) => {
    mxCam.photoBlob = blob;
    const still = document.createElement('img');
    still.className = 'mx-still'; still.src = URL.createObjectURL(blob);
    video.style.display = 'none';
    video.parentNode.appendChild(still);
    document.getElementById('mx-cam-live').style.display = 'none';
    document.getElementById('mx-cam-review').style.display = 'flex';
  }, 'image/jpeg', 0.9);
}
// Фронтальная камера в превью показана зеркально. Чтобы отправленный кружок выглядел ровно так же, как
// пользователь видел себя при съёмке (а не «наоборот»), зеркалим кадры при записи через canvas.
function mxMirroredStream(stream, videoEl) {
  const vt = stream.getVideoTracks()[0];
  const st = (vt && vt.getSettings && vt.getSettings()) || {};
  const w = st.width || videoEl.videoWidth || 640, h = st.height || videoEl.videoHeight || 480;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  let raf = 0, stopped = false;
  const draw = () => {
    if (stopped) return;
    if (videoEl.readyState >= 2) { ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1); ctx.drawImage(videoEl, 0, 0, w, h); ctx.restore(); }
    raf = requestAnimationFrame(draw);
  };
  draw();
  const out = canvas.captureStream(30);
  stream.getAudioTracks().forEach(t => out.addTrack(t));
  return { stream: out, stop: () => { stopped = true; cancelAnimationFrame(raf); } };
}
function mxCameraStartRecording() {
  if (!mxCam.stream) return;
  const mime = mxPickMime(['video/webm;codecs=vp8,opus', 'video/webm']);
  let recorder;
  let source = mxCam.stream;
  if (mxCam.facing === 'user' && typeof HTMLCanvasElement !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
    try { mxCam.mirror = mxMirroredStream(mxCam.stream, document.getElementById('mx-cam-video')); source = mxCam.mirror.stream; }
    catch (e) { mxCam.mirror = null; source = mxCam.stream; }
  }
  try { recorder = new MediaRecorder(source, mime ? { mimeType: mime } : undefined); }
  catch (e) { if (mxCam.mirror) { mxCam.mirror.stop(); mxCam.mirror = null; } showToast('Запись видео не поддерживается'); return; }
  mxCam.recorder = recorder; mxCam.chunks = []; mxCam.recording = true; mxCam.elapsed = 0;
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) mxCam.chunks.push(e.data); };
  recorder.start();
  document.getElementById('mx-camera').classList.add('recording');
  mxCam.timer = setInterval(() => {
    mxCam.elapsed++;
    document.getElementById('mx-cam-timer').textContent = fmtDur(mxCam.elapsed);
    if (mxCam.elapsed >= 60) mxCameraStopRecording(); // потолок кружка — 60 секунд
  }, 1000);
}
function mxCameraStopRecording() {
  if (!mxCam || !mxCam.recorder) return;
  clearInterval(mxCam.timer);
  document.getElementById('mx-camera').classList.remove('recording');
  mxCam.recorder.onstop = () => {
    if (mxCam.mirror) { mxCam.mirror.stop(); mxCam.mirror = null; }
    mxCam.blob = new Blob(mxCam.chunks, { type: mxCam.recorder.mimeType || 'video/webm' });
    mxCam.recording = false;
    const video = document.getElementById('mx-cam-video');
    video.srcObject = null;
    video.classList.remove('mirror'); // зеркало уже «запечено» в запись — показываем как есть, собеседник увидит то же самое
    video.src = URL.createObjectURL(mxCam.blob);
    video.loop = true; video.muted = true; video.playbackRate = 1; video.onloadedmetadata = () => mxFixWebmDuration(video); video.play().catch(() => {});
    document.getElementById('mx-cam-live').style.display = 'none';
    document.getElementById('mx-cam-review').style.display = 'flex';
    document.getElementById('mx-cam-timer').textContent = '';
  };
  mxCam.recorder.stop();
}
async function mxCameraRetake() {
  if (!mxCam) return;
  const video = document.getElementById('mx-cam-video');
  const still = document.querySelector('.mx-still'); if (still) still.remove();
  video.style.display = ''; video.src = ''; video.loop = false; video.muted = true;
  video.classList.toggle('mirror', mxCam.facing === 'user'); // возвращаем зеркало для живого превью
  mxCam.blob = null; mxCam.photoBlob = null;
  document.getElementById('mx-cam-live').style.display = 'flex';
  document.getElementById('mx-cam-review').style.display = 'none';
  if (!mxCam.stream || mxCam.stream.getTracks().every(t => t.readyState === 'ended')) await mxCameraStartStream();
  else video.srcObject = mxCam.stream;
}
async function mxCameraSend() {
  if (!mxCam || !currentChatId) return;
  const chatId = currentChatId;
  const sendBtn = document.getElementById('mx-cam-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    if (mxCam.mode === 'photo' && mxCam.photoBlob) {
      const media = await MchatAPI.uploadMedia('image', mxCam.photoBlob, {});
      const saved = await MchatAPI.sendMessage(chatId, '', MchatAPI.newClientId(), { kind: 'IMAGE', mediaId: media.id });
      onIncomingMessage(saved);
    } else if (mxCam.blob) {
      const media = await MchatAPI.uploadMedia('videonote', mxCam.blob, { duration: mxCam.elapsed });
      const saved = await MchatAPI.sendMessage(chatId, '', MchatAPI.newClientId(), { kind: 'VIDEO_NOTE', mediaId: media.id, durationSec: mxCam.elapsed });
      onIncomingMessage(saved);
    }
    mxCameraClose();
  } catch (e) { showToast(MchatAPI.errorText(e)); if (sendBtn) sendBtn.disabled = false; }
}

// ============================================================
// АУДИО-МОДАЛКА (превью звука Reels) и загрузка своих треков
// ============================================================
function mxAudioToggle() {
  if (!currentReelsAudioId || !audioRegistry[currentReelsAudioId]) return;
  const audio = audioRegistry[currentReelsAudioId];
  const player = document.getElementById('mx-audio-player');
  const btn = document.getElementById('mx-audio-play');
  if (!audio.url) { player.style.display = 'none'; return; }
  player.style.display = 'flex';
  const playIco = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="7 4 20 12 7 20 7 4"/></svg>';
  const pauseIco = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>';
  let a = window._mxTrackAudio;
  if (!a || window._mxTrackAudioId !== currentReelsAudioId) {
    if (a) a.pause();
    a = new Audio(audio.url);
    window._mxTrackAudio = a; window._mxTrackAudioId = currentReelsAudioId;
    a.addEventListener('timeupdate', () => {
      const pct = a.duration ? (a.currentTime / a.duration) * 100 : 0;
      const fill = document.getElementById('mx-audio-fill'); if (fill) fill.style.width = pct + '%';
      const t = document.getElementById('mx-audio-time'); if (t) t.textContent = fmtDur(a.currentTime);
    });
    a.addEventListener('ended', () => { btn.innerHTML = playIco; });
  }
  if (a.paused) { a.play().catch(()=>{}); btn.innerHTML = pauseIco; } else { a.pause(); btn.innerHTML = playIco; }
}
function mxAudioSeek(evt) {
  const a = window._mxTrackAudio;
  if (!a || !a.duration) return;
  const bar = evt.currentTarget;
  const r = bar.getBoundingClientRect();
  const pct = Math.min(1, Math.max(0, (evt.clientX - r.left) / r.width));
  a.currentTime = pct * a.duration;
}

/** «Нота»: загрузка собственного аудиофайла в профиль. */
function mxOpenTrackPicker() { document.getElementById('mx-track-input').click(); }
async function mxTrackChosen(evt) {
  const file = evt.target.files && evt.target.files[0];
  evt.target.value = '';
  if (!file || !currentUser) return;
  const card = document.getElementById('mx-track-upload-card');
  if (card) card.classList.add('busy');
  try {
    const duration = await mxProbeAudioDuration(file).catch(() => 0);
    await MchatAPI.uploadMedia('track', file, { duration, name: file.name });
    showToast('Трек загружен');
    if (currentProfileTab === 'tracks') renderProfileTracksTab();
  } catch (e) { showToast(MchatAPI.errorText(e)); }
  finally { if (card) card.classList.remove('busy'); }
}
function mxProbeAudioDuration(file) {
  return new Promise((resolve, reject) => {
    const a = new Audio();
    a.preload = 'metadata';
    a.onloadedmetadata = () => { resolve(a.duration || 0); URL.revokeObjectURL(a.src); };
    a.onerror = () => reject(new Error('bad_audio'));
    a.src = URL.createObjectURL(file);
  });
}
async function mxDeleteTrack(id) {
  showConfirm('Удалить трек из профиля?', async () => {
    try { await MchatAPI.deleteMedia(id); if (currentProfileTab === 'tracks') renderProfileTracksTab(); }
    catch (e) { showToast(MchatAPI.errorText(e)); }
  });
}

// ============================================================
// ВЛОЖЕНИЯ: фото, видео, документы (скрепка)
// ============================================================
const MX_ATTACH_LIMIT_MB = { image: 10, video: 40, file: 25 };
const MX_ATTACH_KIND = { image: 'IMAGE', video: 'VIDEO', file: 'FILE' };
function mxAttachOpen() {
  if (!currentChatId) return;
  document.getElementById('mx-file-input').click();
}
function mxKindOfFile(f) {
  const t = (f.type || '').toLowerCase();
  if (/^image\/(jpeg|png|webp|gif)$/.test(t)) return 'image';
  if (/^video\/(mp4|webm|quicktime)$/.test(t)) return 'video';
  return 'file'; // всё остальное уходит документом
}
async function mxAttachChosen(evt) {
  const files = Array.from(evt.target.files || []).slice(0, 10);
  evt.target.value = '';
  const chatId = currentChatId;
  if (!files.length || !chatId) return;
  for (const f of files) await mxSendAttachment(chatId, f);
}
function mxUpdateProgress(id, pct) {
  const bar = document.querySelector('.msg[data-id="' + id + '"] .mx-upbar i');
  if (bar) bar.style.width = pct + '%';
}
async function mxSendAttachment(chatId, file) {
  const kind = mxKindOfFile(file);
  if (file.size > MX_ATTACH_LIMIT_MB[kind] * 1024 * 1024) { showToast('«' + file.name + '» больше ' + MX_ATTACH_LIMIT_MB[kind] + ' МБ'); return; }
  const clientId = MchatAPI.newClientId();
  const local = { id: clientId, clientId, chatId, kind: MX_ATTACH_KIND[kind], text: '', fileName: file.name, fileSize: file.size,
    mediaUrl: kind === 'image' ? URL.createObjectURL(file) : '', reactions: [], time: fmtClock(new Date().toISOString()),
    outgoing: true, pending: true, progress: 0 };
  (messages[chatId] = messages[chatId] || []).push(local);
  if (currentChatId === chatId) renderMessages(chatId);
  try {
    const media = await MchatAPI.uploadMedia(kind, file, { name: file.name, onProgress: (p) => { local.progress = p; mxUpdateProgress(clientId, p); } });
    const saved = await MchatAPI.sendMessage(chatId, '', clientId, { kind: MX_ATTACH_KIND[kind], mediaId: media.id });
    onIncomingMessage(saved); // склеится с заглушкой по clientId
  } catch (e) {
    messages[chatId] = (messages[chatId] || []).filter((x) => x !== local);
    if (currentChatId === chatId) renderMessages(chatId);
    showToast(MchatAPI.errorText(e));
  }
}

init();
document.addEventListener('DOMContentLoaded', () => {
  setupPinchZoom(document.getElementById('pv-img'));
  setupTextPinchScale();
});
'use strict';
/* Панель Job Fit Copilot. Ванильный JS, без сборки и внешних запросов.
   Весь текст из API вставляется только через textContent / DOM-конструирование:
   тексты вакансий — недоверенный сторонний контент. */
(function () {
  var STATUSES = ['found', 'scored', 'drafted', 'awaiting_approval', 'approved', 'sent', 'replied', 'invited', 'rejected', 'skipped'];
  var STATUS_RU = {
    found: 'Найдено',
    scored: 'Оценено',
    drafted: 'Письмо готово',
    awaiting_approval: 'Ждут одобрения',
    approved: 'Одобрено',
    sent: 'Отправлено',
    replied: 'Есть ответ',
    invited: 'Приглашение',
    rejected: 'Отказ',
    skipped: 'Пропущено'
  };
  var EVENT_RU = { status: 'Статус', fit: 'Оценка', ats: 'ATS', letter: 'Письмо' };
  var REFRESH_MS = 15000;
  var NO_SKIP = { sent: 1, replied: 1, invited: 1, rejected: 1, skipped: 1 };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    conn: $('conn'), stats: $('stats'), list: $('list'), listError: $('listError'),
    listPane: $('listPane'), detail: $('detail'), detailPane: $('detailPane'),
    fText: $('fText'), fStatus: $('fStatus'), back: $('backBtn')
  };

  var state = {
    items: null,          // null до первой загрузки
    stats: null,
    selected: null,       // key выбранной вакансии
    detail: null,         // ответ GET /api/vacancies/:key
    detailToken: 0,
    listSig: '',
    drafts: {},           // letterId -> несохранённый текст письма
    lintOverride: {},     // letterId -> lint из последнего PUT
    flash: null,          // { kind, text } сообщение в карточке деталей
    qDraft: null,         // { key, map } несохранённые ответы на вопросы работодателя
    qFlash: null          // { key, kind, text }
  };

  /* ---------- утилиты ---------- */

  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k === 'on') Object.keys(v).forEach(function (ev) { node.addEventListener(ev, v[ev]); });
        else node.setAttribute(k, v === true ? '' : String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function safeUrl(u) {
    try {
      var p = new URL(String(u));
      return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
    } catch (e) { return null; }
  }
  function ts(o) { return Number(o && (o.createdAt || o.updatedAt || o.at || o.ts)) || 0; }

  function ago(ms) {
    var t = Number(ms);
    if (!t) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'только что';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' мин назад';
    var hh = Math.round(m / 60);
    if (hh < 24) return hh + ' ч назад';
    var d = Math.round(hh / 24);
    if (d < 60) return d + ' дн назад';
    return Math.round(d / 30) + ' мес назад';
  }
  function absTime(ms) {
    var t = Number(ms);
    if (!t) return '';
    try { return new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function countWords(text) {
    var m = String(text).trim().match(/\S+/g);
    return m ? m.length : 0;
  }
  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  function latest(arr) {
    var best = null;
    (arr || []).forEach(function (x) {
      if (!best || ts(x) > ts(best) || (ts(x) === ts(best) && Number(x.id || 0) > Number(best.id || 0))) best = x;
    });
    return best;
  }

  /* ---------- API ---------- */

  function api(method, path, body) {
    var opts = { method: method, headers: { 'Accept': 'application/json' } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { /* не JSON */ }
        if (!res.ok) {
          var msg = data && data.error && data.error.message ? data.error.message : 'Ошибка сервера (' + res.status + ')';
          var err = new Error(msg);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }
  function errText(e) {
    return e && e.status ? e.message : 'Сервер недоступен. Проверьте, что он запущен.';
  }

  /* ---------- статистика ---------- */

  function renderStats() {
    clear(els.stats);
    var s = state.stats;
    if (!s) return;
    var by = s.byStatus || {};
    els.stats.appendChild(h('div', { class: 'stat' }, h('b', { text: s.total || 0 }), h('span', { text: 'всего' })));
    STATUSES.forEach(function (st) {
      var n = by[st] || 0;
      if (!n && st !== 'awaiting_approval') return;
      els.stats.appendChild(h('div', { class: 'stat' + (st === 'awaiting_approval' ? ' hot' : '') },
        h('b', { text: n }), h('span', { text: STATUS_RU[st] })));
    });
    els.stats.appendChild(h('div', { class: 'stat sep' }, h('b', { text: s.sentToday || 0 }), h('span', { text: 'отправлено сегодня' })));
    els.stats.appendChild(h('div', { class: 'stat' }, h('b', { text: s.sentLast7Days || 0 }), h('span', { text: 'за 7 дней' })));
  }

  /* ---------- список ---------- */

  function fillStatusFilter() {
    var cur = els.fStatus.value;
    clear(els.fStatus);
    els.fStatus.appendChild(h('option', { value: '', text: 'Все статусы' }));
    STATUSES.forEach(function (st) { els.fStatus.appendChild(h('option', { value: st, text: STATUS_RU[st] })); });
    els.fStatus.value = cur;
  }

  function verdictClass(v) {
    var u = String(v || '').toUpperCase();
    if (u.indexOf('ОТКЛИКАТЬСЯ') === 0) return 'go';
    if (u.indexOf('ОГОВОРК') !== -1) return 'maybe';
    if (u.indexOf('ПРОПУСТИТЬ') === 0) return 'stop';
    return '';
  }

  function filteredItems() {
    var q = els.fText.value.trim().toLowerCase();
    var st = els.fStatus.value;
    return (state.items || []).filter(function (it) {
      if (st && it.status !== st) return false;
      if (!q) return true;
      return (str(it.title) + ' ' + str(it.company)).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderList(force) {
    if (state.items === null) {
      clear(els.list);
      els.list.appendChild(h('div', { class: 'empty', text: 'Загрузка…' }));
      return;
    }
    var items = filteredItems();
    var sig = JSON.stringify([items, state.selected, els.fText.value, els.fStatus.value]);
    if (!force && sig === state.listSig) return;   // ничего не изменилось: не трогаем DOM, чтобы не сбить скролл и фокус
    state.listSig = sig;

    var scroll = els.listPane.scrollTop;
    var active = document.activeElement;
    var focusKey = active && active.classList && active.classList.contains('row') ? active.getAttribute('data-key') : null;

    clear(els.list);
    if (!items.length) {
      var filtering = els.fText.value.trim() || els.fStatus.value;
      els.list.appendChild(filtering
        ? h('div', { class: 'empty' }, h('b', { text: 'Ничего не найдено' }), 'Измените фильтр или поиск.')
        : h('div', { class: 'empty' }, h('b', { text: 'Пока нет вакансий' }), 'Попросите ассистента найти вакансии: они появятся здесь.'));
    } else {
      var order = ['awaiting_approval'].concat(STATUSES.filter(function (s) { return s !== 'awaiting_approval'; }));
      var groups = {};
      items.forEach(function (it) { (groups[it.status] = groups[it.status] || []).push(it); });
      var unknown = Object.keys(groups).filter(function (s) { return order.indexOf(s) === -1; });
      order.concat(unknown).forEach(function (st) {
        var g = groups[st];
        if (!g) return;
        var primary = st === 'awaiting_approval';
        var box = h('div', { class: 'group' + (primary ? ' primary' : ''), role: 'group', 'aria-label': STATUS_RU[st] || st },
          h('div', { class: 'group-head' },
            h('span', { text: primary ? 'Ждут вашего решения' : (STATUS_RU[st] || st) }),
            h('span', { class: 'n', text: g.length })));
        g.forEach(function (it) { box.appendChild(rowFor(it)); });
        els.list.appendChild(box);
      });
    }
    els.listPane.scrollTop = scroll;
    if (focusKey) {
      var again = els.list.querySelector('.row[data-key="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey.replace(/"/g, '\\"')) + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function rowFor(it) {
    var meta = h('div', { class: 'row-meta' });
    if (it.company) meta.appendChild(h('span', { class: 'co', text: it.company }));
    if (it.lastScore !== undefined && it.lastScore !== null) meta.appendChild(h('span', { class: 'chip', text: 'Балл ' + it.lastScore }));
    if (it.lastVerdict) meta.appendChild(h('span', { class: 'chip ' + verdictClass(it.lastVerdict), text: it.lastVerdict }));
    var when = ago(it.updatedAt);
    if (when) meta.appendChild(h('span', { text: when }));
    return h('button', {
      type: 'button', class: 'row', 'data-key': it.key,
      'aria-current': it.key === state.selected ? 'true' : null,
      on: { click: function () { select(it.key); } }
    }, h('div', { class: 'row-title', text: it.title || '(без названия)' }), meta);
  }

  function loadList() {
    return api('GET', '/api/pipeline').then(function (data) {
      state.items = (data && data.items) || [];
      els.listError.hidden = true;
      setConn(true);
      renderList(false);
      // вакансия изменилась на сервере (например, агент поставил письмо в очередь) — обновить детали, если нет правок
      if (state.selected && state.detail) {
        var row = state.items.filter(function (i) { return i.key === state.selected; })[0];
        var cur = state.detail.vacancy;
        if (row && cur && row.updatedAt !== cur.updatedAt && !hasDirtyDraft()) loadDetail(state.selected, true);
      }
    }).catch(function (e) {
      els.listError.textContent = errText(e) + (state.items ? ' Показаны данные последней загрузки.' : '');
      els.listError.hidden = false;
      setConn(false);
      if (state.items === null) { state.items = []; renderList(true); }
    });
  }
  function loadStats() {
    return api('GET', '/api/stats').then(function (s) { state.stats = s; renderStats(); }).catch(function () { /* ошибку покажет список */ });
  }
  function refreshAll() { return Promise.all([loadList(), loadStats()]); }

  function setConn(ok) {
    els.conn.className = 'conn' + (ok ? '' : ' bad');
    els.conn.textContent = ok ? 'Обновлено ' + new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Нет связи с сервером';
  }

  /* ---------- детали ---------- */

  function select(key) {
    if (state.selected !== key) { state.flash = null; state.qDraft = null; state.qFlash = null; }
    state.selected = key;
    document.body.classList.add('show-detail');
    els.back.hidden = false;
    renderList(true);
    loadDetail(key, false);
    els.detailPane.focus({ preventScroll: false });
    window.scrollTo(0, 0);
  }

  function loadDetail(key, silent) {
    var token = ++state.detailToken;
    if (!silent) {
      clear(els.detail);
      els.detail.appendChild(h('div', { class: 'empty', text: 'Загрузка…' }));
    }
    return api('GET', '/api/vacancies/' + encodeURIComponent(key)).then(function (data) {
      if (token !== state.detailToken || state.selected !== key) return;
      state.detail = data;
      renderDetail();
    }).catch(function (e) {
      if (token !== state.detailToken) return;
      if (silent) return;
      clear(els.detail);
      els.detail.appendChild(h('div', { class: 'banner banner-error', role: 'alert', text: 'Не удалось загрузить вакансию. ' + errText(e) }));
    });
  }

  function currentLetter(d) {
    var letters = d.letters || [];
    var id = d.vacancy && d.vacancy.letterId;
    if (id !== undefined && id !== null) {
      var m = letters.filter(function (l) { return l.id === id; })[0];
      if (m) return m;
    }
    return latest(letters);
  }
  function lintOf(letter) { return state.lintOverride[letter.id] || letter.lint || null; }
  function hasDirtyDraft() {
    var d = state.detail;
    if (!d) return false;
    var l = currentLetter(d);
    return !!(l && state.drafts[l.id] !== undefined && state.drafts[l.id] !== l.text) || (!!d.vacancy && answersDirty(d.vacancy));
  }

  function card(title, cls) {
    var c = h('section', { class: 'card' + (cls ? ' ' + cls : '') });
    if (title) c.appendChild(h('h2', { text: title }));
    return c;
  }
  function textList(arr) {
    return h('ul', { class: 'plain-list' }, (arr || []).map(function (x) {
      return h('li', { text: typeof x === 'string' ? x : (x && (x.text || x.requirement)) || JSON.stringify(x) });
    }));
  }
  function signed(n) { n = Number(n); return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }

  function renderDetail() {
    var d = state.detail;
    var root = els.detail;
    // сохранить положение прокрутки панели деталей и позицию курсора в письме при тихом обновлении
    var act = document.activeElement;
    var focusId = act && act.id && root.contains(act) && /^(letterText|q\d+(text|own|o\d+))$/.test(act.id) ? act.id : null;
    var caret = focusId && typeof act.selectionStart === 'number' ? [act.selectionStart, act.selectionEnd] : null;
    var scroll = window.scrollY;
    clear(root);
    if (!d || !d.vacancy) return;
    var v = d.vacancy;
    if (state.qDraft && state.qDraft.key === v.key && !answersDirty(v)) state.qDraft = null;   // нет правок: показываем сохранённое
    var letter = currentLetter(d);
    var fit = latest((d.analyses || []).filter(function (a) { return a.kind === 'fit'; }));
    var ats = latest((d.analyses || []).filter(function (a) { return a.kind === 'ats'; }));

    root.appendChild(approvalCard(v, letter));
    root.appendChild(factsCard(v));
    var cmp = comparisonCard(d);
    if (cmp) root.appendChild(cmp);
    if (fit) root.appendChild(fitCard(fit));
    if (ats) root.appendChild(atsCard(ats));
    var qc = questionsCard(v);
    if (qc) root.appendChild(qc);
    root.appendChild(letterCard(v, letter));
    root.appendChild(eventsCard(d.events || []));

    window.scrollTo(0, scroll);
    if (focusId) {
      var nt = document.getElementById(focusId);
      if (nt) {
        nt.focus({ preventScroll: true });
        if (caret) { try { nt.setSelectionRange(caret[0], caret[1]); } catch (e) { /* ignore */ } }
      }
    }
  }

  function factsCard(v) {
    var c = card(null);
    c.appendChild(h('h2', { class: 'd-title', text: v.title || '(без названия)' }));
    c.appendChild(h('p', { class: 'd-sub', text: v.company || 'Компания не указана' }));
    var dl = h('dl', { class: 'facts' });
    function fact(label, val) { if (val) dl.appendChild(h('dt', { text: label })); if (val) dl.appendChild(h('dd', { text: val })); }
    fact('Статус', STATUS_RU[v.status] || v.status);
    fact('Зарплата', v.salary);
    fact('Опыт', v.experience);
    fact('Источник', v.source);
    fact('Обновлено', absTime(v.updatedAt) + (v.updatedAt ? ' (' + ago(v.updatedAt) + ')' : ''));
    if (Array.isArray(v.skills) && v.skills.length) fact('Навыки', v.skills.join(', '));
    if (v.note) fact('Заметка', v.note);
    c.appendChild(dl);
    var url = safeUrl(v.url);
    if (url) {
      c.appendChild(h('p', null, h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть оригинал вакансии' })));
    }
    if (v.description) {
      c.appendChild(h('details', null, h('summary', { text: 'Описание вакансии' }), h('div', { class: 'desc', text: v.description })));
    }
    return c;
  }

  function fitCard(a) {
    var p = a.payload || {};
    var c = card('Оценка соответствия');
    var line = h('div', { class: 'score-line' });
    if (a.score !== undefined && a.score !== null) line.appendChild(h('span', { class: 'score-big', text: a.score }));
    if (a.verdict) line.appendChild(h('span', { class: 'chip ' + verdictClass(a.verdict), text: a.verdict }));
    c.appendChild(line);
    if (p.reasoning) c.appendChild(h('p', { class: 'reason', text: p.reasoning }));
    if (Array.isArray(p.ledger) && p.ledger.length) {
      c.appendChild(h('h3', { text: 'Из чего сложился балл (база 50)' }));
      c.appendChild(h('ul', { class: 'ledger' }, p.ledger.map(function (r) {
        var delta = r && typeof r === 'object' ? Number(r.delta) : NaN;
        var text = r && typeof r === 'object' ? r.text : r;
        return h('li', null,
          h('span', { class: 'delta ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : ''), text: isNaN(delta) ? '' : signed(delta) }),
          h('span', { text: text }));
      })));
    }
    if (Array.isArray(p.flags) && p.flags.length) {
      c.appendChild(h('h3', { text: 'Риски и на что обратить внимание' }));
      c.appendChild(textList(p.flags));
    }
    return c;
  }

  function atsCard(a) {
    var p = a.payload || {};
    var c = card('Совпадение с ATS');
    var line = h('div', { class: 'score-line' });
    var cov = p.hard_requirements_coverage_percent;
    if (cov !== undefined && cov !== null) {
      line.appendChild(h('span', { class: 'score-big', text: cov + '%' }));
      line.appendChild(h('span', { class: 'muted', text: 'обязательных требований покрыто' }));
    }
    var overall = p.overall_match_score !== undefined ? p.overall_match_score : a.score;
    if (overall !== undefined && overall !== null) line.appendChild(h('span', { class: 'chip', text: 'Общий балл ' + overall }));
    c.appendChild(line);
    if (p.honest_gap_warning) c.appendChild(h('div', { class: 'banner banner-error', text: p.honest_gap_warning }));
    if (Array.isArray(p.critical_gaps) && p.critical_gaps.length) {
      c.appendChild(h('h3', { text: 'Критичные пробелы' }));
      c.appendChild(textList(p.critical_gaps));
    } else if (cov !== undefined) {
      c.appendChild(h('p', { class: 'muted', text: 'Критичных пробелов нет.' }));
    }
    return c;
  }

  function lintBlock(lint) {
    var box = h('div', { class: 'lint' });
    if (!lint) { box.appendChild(h('p', { class: 'muted', text: 'Проверка письма ещё не выполнена.' })); return box; }
    var issues = lint.issues || [];
    if (lint.ok) box.appendChild(h('div', { class: 'lint-ok', text: 'Проверка пройдена' + (issues.length ? ', есть замечания' : '') }));
    else box.appendChild(h('div', { class: 'banner banner-error', text: 'Проверка не пройдена: исправьте ошибки перед одобрением.' }));
    if (issues.length) {
      box.appendChild(h('ul', { class: 'issues' }, issues.map(function (i) {
        return h('li', { class: i.severity === 'error' ? 'error' : 'warn' },
          h('span', { class: 'rule', text: (i.severity === 'error' ? 'Ошибка · ' : 'Замечание · ') + str(i.rule) }),
          str(i.message),
          i.excerpt ? h('span', { class: 'ex', text: '«' + i.excerpt + '»' }) : null);
      })));
    }
    return box;
  }

  function planBlock(plan) {
    if (!plan || (Array.isArray(plan) && !plan.length)) return null;
    var body;
    if (Array.isArray(plan)) body = textList(plan);
    else if (typeof plan === 'object') {
      body = h('ul', { class: 'plain-list' }, Object.keys(plan).map(function (k) {
        var val = plan[k];
        return h('li', { text: k + ': ' + (typeof val === 'string' ? val : JSON.stringify(val)) });
      }));
    } else body = h('p', { class: 'reason', text: plan });
    return h('details', null, h('summary', { text: 'План письма' }), body);
  }

  function letterCard(v, letter) {
    var c = card('Сопроводительное письмо');
    if (!letter) {
      if (v.form && v.form.letter === 'required') c.appendChild(h('p', { class: 'letter-req', text: 'Сопроводительное письмо обязательно для этой вакансии.' }));
      c.appendChild(h('p', { class: 'muted', text: 'Письма пока нет. Ассистент подготовит его после оценки вакансии.' }));
      return c;
    }
    if (v.form && v.form.letter === 'required') c.appendChild(h('p', { class: 'letter-req', text: 'Сопроводительное письмо обязательно для этой вакансии.' }));
    var draft = state.drafts[letter.id];
    var area = h('textarea', { id: 'letterText', 'aria-label': 'Текст письма', spellcheck: 'true', lang: letter.lang || 'ru' });
    area.value = draft !== undefined ? draft : str(letter.text);
    var count = h('span', { class: 'count' });
    var dirtyMark = h('span', { class: 'dirty', 'aria-live': 'polite' });
    var save = h('button', { type: 'button', class: 'btn btn-save', text: 'Сохранить письмо' });
    var lintHost = h('div');
    lintHost.appendChild(lintBlock(lintOf(letter)));

    function sync() {
      var n = countWords(area.value);
      count.textContent = n + ' ' + plural(n, 'слово', 'слова', 'слов') + ' (рекомендуется 120–180)';
      var dirty = area.value !== str(letter.text);
      if (dirty) state.drafts[letter.id] = area.value; else delete state.drafts[letter.id];
      dirtyMark.textContent = dirty ? 'Есть несохранённые правки' : '';
      save.disabled = !dirty;
      var ap = document.getElementById('approveBtn');
      if (ap) refreshApprove(ap, v, letter);
    }
    area.addEventListener('input', sync);
    save.addEventListener('click', function () {
      save.disabled = true;
      var text = area.value;
      api('PUT', '/api/letters/' + encodeURIComponent(letter.id), { text: text }).then(function (res) {
        var saved = res && res.letter;
        if (!saved) throw new Error('Пустой ответ сервера');
        letter.text = saved.text !== undefined ? saved.text : text;
        letter.lint = saved.lint || letter.lint;
        delete state.lintOverride[letter.id];
        if (state.detail && Array.isArray(state.detail.letters)) {
          state.detail.letters = state.detail.letters.map(function (l) { return l.id === letter.id ? Object.assign({}, l, saved) : l; });
        }
        delete state.drafts[letter.id];
        state.flash = { kind: 'ok', text: 'Письмо сохранено, проверка выполнена заново.' };
        renderDetail();
        refreshAll();
      }).catch(function (e) {
        save.disabled = false;
        state.flash = { kind: 'error', text: 'Не удалось сохранить письмо. ' + errText(e) };
        renderDetail();
      });
    });

    c.appendChild(area);
    c.appendChild(h('div', { class: 'letter-bar' }, save, count, dirtyMark));
    c.appendChild(lintHost);
    var plan = planBlock(letter.plan);
    if (plan) c.appendChild(plan);
    sync();
    return c;
  }

  function eventLine(e) {
    var p = e.payload;
    var type = EVENT_RU[e.type] || str(e.type);
    var text;
    if (e.type === 'status' && p && typeof p === 'object') {
      text = (STATUS_RU[p.from] || p.from || '—') + ' → ' + (STATUS_RU[p.to] || p.to || '—') + (p.note ? ' · ' + p.note : '');
    } else if (p === undefined || p === null) {
      text = '';
    } else {
      text = typeof p === 'string' ? p : JSON.stringify(p);
      if (text.length > 240) text = text.slice(0, 240) + '…';
    }
    return h('li', null, h('time', { text: absTime(ts(e)) }), h('span', null, h('b', { text: type }), text ? ' · ' + text : ''));
  }
  function eventsCard(events) {
    var c = card('История');
    if (!events.length) { c.appendChild(h('p', { class: 'muted', text: 'Событий пока нет.' })); return c; }
    var sorted = events.slice().sort(function (a, b) { return ts(b) - ts(a); });
    c.appendChild(h('ul', { class: 'events' }, sorted.map(eventLine)));
    return c;
  }

  /* ---------- одобрение и действия ---------- */

  function approveState(v, letter) {
    if (v.status !== 'awaiting_approval') return { ok: false, why: '' };
    var form = v.form && typeof v.form === 'object' ? v.form : null;
    if (form && form.resumeHidden === true) return { ok: false, why: 'Резюме скрыто на hh.ru: измените его видимость на hh.ru или попросите ассистента выбрать другое резюме.' };
    if (!letter) return { ok: false, why: form && form.letter === 'required' ? 'Нет письма, а работодатель требует его.' : 'Нет письма.' };
    var lint = lintOf(letter);
    var dirty = state.drafts[letter.id] !== undefined && state.drafts[letter.id] !== letter.text;
    if (dirty) return { ok: false, why: 'Сначала сохраните правки письма: одобряется только проверенный текст.' };
    if (!lint || !lint.ok) return { ok: false, why: 'Письмо не прошло проверку: исправьте ошибки и сохраните.' };
    var total = formQuestions(v).length;
    if (total) {
      var open = unansweredCount(v);
      if (open) return { ok: false, why: 'Нет сохранённого ответа на ' + open + ' из ' + total + ' ' + plural(total, 'вопроса', 'вопросов', 'вопросов') + ' работодателя: заполните и сохраните ответы.' };
      if (answersDirty(v)) return { ok: false, why: 'Сначала сохраните правки в ответах работодателю.' };
    }
    return { ok: true, why: '' };
  }
  function refreshApprove(btn, v, letter) {
    var s = approveState(v, letter);
    btn.disabled = !s.ok;
    var hint = document.getElementById('approveHint');
    if (hint) hint.textContent = s.why;
  }

  function approvalCard(v, letter) {
    var waiting = v.status === 'awaiting_approval';
    var c = card(waiting ? 'Требуется ваше решение' : 'Действия', waiting ? 'approval' : '');
    if (state.flash) {
      c.appendChild(h('div', { class: 'banner toast ' + (state.flash.kind === 'ok' ? 'banner-ok' : 'banner-error'), role: state.flash.kind === 'ok' ? 'status' : 'alert', text: state.flash.text }));
    }
    if (v.form && v.form.resumeHidden === true) {
      c.appendChild(h('div', { class: 'banner banner-error resume-warn', role: 'alert' },
        h('b', { text: 'Резюме скрыто от этого работодателя' }),
        h('div', { text: v.form.resumeWarning || 'hh.ru не позволяет откликнуться этим резюме.' }),
        h('div', { text: 'Что сделать: измените видимость резюме на hh.ru или попросите ассистента выбрать другое резюме.' })));
    }
    if (waiting) c.appendChild(h('p', { class: 'reason', text: 'Ничего не будет отправлено, пока вы не одобрите отклик.' }));
    var actions = h('div', { class: 'actions' });
    if (waiting) {
      var ap = h('button', { type: 'button', id: 'approveBtn', class: 'btn btn-approve', text: 'Одобрить отклик', on: { click: function () { doStatus(v.key, 'approved'); } } });
      actions.appendChild(ap);
      refreshApprove(ap, v, letter);
    }
    if (v.status === 'approved') {
      actions.appendChild(h('button', { type: 'button', class: 'btn', text: 'Вернуть в очередь', on: { click: function () { doStatus(v.key, 'awaiting_approval'); } } }));
    }
    if (!NO_SKIP[v.status]) {
      actions.appendChild(h('button', { type: 'button', class: 'btn btn-danger', text: 'Пропустить', on: { click: function () { doStatus(v.key, 'skipped'); } } }));
    }
    c.appendChild(actions);
    c.appendChild(h('p', { class: 'hint', id: 'approveHint' }));
    if (!waiting && v.status !== 'approved' && NO_SKIP[v.status]) {
      c.appendChild(h('p', { class: 'hint', text: 'Для этого статуса действий в панели нет.' }));
    }
    return c;
  }

  var busy = false;
  function doStatus(key, status) {
    if (busy) return;
    busy = true;
    var btns = els.detail.querySelectorAll('.actions .btn');
    btns.forEach(function (b) { b.disabled = true; });
    api('POST', '/api/vacancies/' + encodeURIComponent(key) + '/status', { status: status }).then(function () {
      var msgs = { approved: 'Отклик одобрен.', awaiting_approval: 'Отклик возвращён в очередь на одобрение.', skipped: 'Вакансия пропущена.' };
      state.flash = { kind: 'ok', text: msgs[status] || 'Статус обновлён.' };
    }).catch(function (e) {
      state.flash = { kind: 'error', text: 'Не удалось изменить статус. ' + errText(e) };
    }).then(function () {
      busy = false;
      return Promise.all([refreshAll(), state.selected === key ? loadDetail(key, true) : null]);
    });
  }

  /* ---------- форма отклика: вопросы работодателя ---------- */

  function formQuestions(v) {
    var f = v && v.form;
    return f && Array.isArray(f.questions) ? f.questions.filter(function (q) { return q && typeof q === 'object' && q.id !== undefined && q.id !== null; }) : [];
  }
  function qOptions(q) {
    return Array.isArray(q.options) ? q.options.filter(function (o) { return o && o.value !== undefined && o.value !== null; }) : [];
  }
  function canonAnswer(q, a) {
    var vals = Array.isArray(a && a.values) ? a.values.map(String) : [];
    var ordered = qOptions(q).map(function (o) { return String(o.value); }).filter(function (x) { return vals.indexOf(x) !== -1; });
    return { text: str(a && a.text), values: ordered, own: str(a && a.own) };
  }
  function savedAnswerMap(v) {
    var map = {};
    var list = Array.isArray(v.answers) ? v.answers : [];
    formQuestions(v).forEach(function (q) {
      var a = list.filter(function (x) { return x && String(x.id) === String(q.id); })[0];
      map[q.id] = canonAnswer(q, a);
    });
    return map;
  }
  function isAnswered(q, a) {
    return q.kind === 'choice' ? (a.values.length > 0 || a.own.trim() !== '') : a.text.trim() !== '';
  }
  function workingAnswers(v) {
    var d = state.qDraft;
    return d && d.key === v.key && d.map ? d.map : savedAnswerMap(v);
  }
  function answersDirty(v) {
    var d = state.qDraft;
    if (!d || d.key !== v.key || !d.map) return false;
    var saved = savedAnswerMap(v);
    return formQuestions(v).some(function (q) { return JSON.stringify(canonAnswer(q, d.map[q.id])) !== JSON.stringify(saved[q.id]); });
  }
  function unansweredCount(v) {
    var saved = savedAnswerMap(v);
    return formQuestions(v).filter(function (q) { return !isAnswered(q, saved[q.id]); }).length;
  }
  function answersPayload(v) {
    var work = workingAnswers(v);
    var out = [];
    formQuestions(v).forEach(function (q) {
      var a = canonAnswer(q, work[q.id]);
      if (!isAnswered(q, a)) return;
      if (q.kind === 'choice') {
        var item = { id: q.id, values: a.values };
        if (q.allowsOwn && a.own.trim()) item.own = a.own.trim();
        out.push(item);
      } else out.push({ id: q.id, text: a.text.trim() });
    });
    return out;
  }

  function questionsCard(v) {
    var qs = formQuestions(v);
    if (!qs.length) return null;
    var c = card('Вопросы работодателя');
    if (!state.qDraft || state.qDraft.key !== v.key) state.qDraft = { key: v.key, map: null };
    var work = workingAnswers(v);
    var chips = {};

    if (v.form.intro) c.appendChild(h('p', { class: 'reason q-intro', text: v.form.intro }));
    c.appendChild(h('p', { class: 'hint', text: 'Работодатель просит ответить на вопросы. Без сохранённых ответов на все вопросы отклик одобрить нельзя.' }));

    var saveBtn = h('button', { type: 'button', class: 'btn btn-save', text: 'Сохранить ответы' });
    var dirtyMark = h('span', { class: 'dirty', 'aria-live': 'polite' });
    var status = h('div', { class: 'toast' });
    if (state.qFlash && state.qFlash.key === v.key) {
      status.className = 'banner toast ' + (state.qFlash.kind === 'ok' ? 'banner-ok' : 'banner-error');
      status.setAttribute('role', state.qFlash.kind === 'ok' ? 'status' : 'alert');
      status.textContent = state.qFlash.text;
    }

    function setWork(q, a) {
      if (!state.qDraft || state.qDraft.key !== v.key) state.qDraft = { key: v.key, map: null };
      if (!state.qDraft.map) state.qDraft.map = JSON.parse(JSON.stringify(savedAnswerMap(v)));
      state.qDraft.map[q.id] = a;
      work = state.qDraft.map;
      sync();
    }
    function sync() {
      qs.forEach(function (q) {
        var a = canonAnswer(q, work[q.id]);
        var ok = isAnswered(q, a);
        chips[q.id].textContent = ok ? '' : 'Нет ответа';
        chips[q.id].hidden = ok;
        chips[q.id].parentNode.parentNode.className = 'qa' + (ok ? '' : ' unanswered');
      });
      var dirty = answersDirty(v);
      dirtyMark.textContent = dirty ? 'Есть несохранённые правки' : '';
      saveBtn.disabled = !dirty;
      var ap = document.getElementById('approveBtn');
      if (ap) refreshApprove(ap, v, currentLetter(state.detail));
    }

    qs.forEach(function (q, idx) {
      var a = canonAnswer(q, work[q.id]);
      var chip = h('span', { class: 'chip stop', text: 'Нет ответа' });
      chips[q.id] = chip;
      var titleId = 'qt-' + idx;
      var head = h('div', { class: 'qa-head' }, h('span', { class: 'qa-title', id: titleId, text: (idx + 1) + '. ' + (q.text || 'Вопрос без текста') }), chip);
      var box = h('div', { class: 'qa' }, head);

      if (q.kind === 'choice') {
        var multiple = q.multiple === true;
        var fs = h('fieldset', { class: 'qa-opts', 'aria-labelledby': titleId });
        var inputs = [];
        var ownInput = null;
        function collect() {
          var vals = inputs.filter(function (i) { return i.checked; }).map(function (i) { return i.value; });
          return { text: '', values: vals, own: ownInput ? ownInput.value : '' };
        }
        qOptions(q).forEach(function (o, oi) {
          var id = 'q' + idx + 'o' + oi;
          var inp = h('input', { type: multiple ? 'checkbox' : 'radio', id: id, name: 'q-' + idx, value: String(o.value) });
          inp.checked = a.values.indexOf(String(o.value)) !== -1;
          inp.addEventListener('change', function () {
            if (!multiple && ownInput && inp.checked) ownInput.value = '';
            setWork(q, collect());
          });
          inputs.push(inp);
          fs.appendChild(h('label', { class: 'qa-opt', for: id }, inp, h('span', { text: str(o.label) || str(o.value) })));
        });
        if (q.allowsOwn) {
          ownInput = h('input', { type: 'text', id: 'q' + idx + 'own', class: 'qa-own', 'aria-label': 'Свой вариант ответа', placeholder: 'Свой вариант' });
          ownInput.value = a.own;
          ownInput.addEventListener('input', function () {
            if (!multiple && ownInput.value) inputs.forEach(function (i) { i.checked = false; });
            setWork(q, collect());
          });
          fs.appendChild(ownInput);
        }
        box.appendChild(fs);
      } else {
        var ta = h('textarea', { id: 'q' + idx + 'text', class: 'qa-text', 'aria-labelledby': titleId, rows: 3 });
        ta.value = a.text;
        ta.addEventListener('input', function () { setWork(q, { text: ta.value, values: [], own: '' }); });
        box.appendChild(ta);
      }
      c.appendChild(box);
    });

    saveBtn.addEventListener('click', function () {
      saveBtn.disabled = true;
      api('PUT', '/api/vacancies/' + encodeURIComponent(v.key) + '/answers', { answers: answersPayload(v) }).then(function (res) {
        if (!res || !res.vacancy) throw new Error('Пустой ответ сервера');
        if (state.detail && state.selected === v.key) state.detail.vacancy = res.vacancy;
        state.qDraft = null;
        state.qFlash = { key: v.key, kind: 'ok', text: 'Ответы сохранены.' };
        renderDetail();
        refreshAll();
      }).catch(function (e) {
        saveBtn.disabled = false;
        state.qFlash = { key: v.key, kind: 'error', text: 'Не удалось сохранить ответы. ' + errText(e) };
        status.className = 'banner toast banner-error';
        status.setAttribute('role', 'alert');
        status.textContent = state.qFlash.text;
      });
    });

    c.appendChild(h('div', { class: 'q-bar' }, saveBtn, dirtyMark));
    c.appendChild(status);
    sync();
    return c;
  }

  /* ---------- сравнение резюме ---------- */

  function num(v) {
    if (v === undefined || v === null || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pct(v) { var n = num(v); return n === null ? null : Math.max(0, Math.min(100, n)); }
  function barClass(p) { return p >= 70 ? 'good' : p < 40 ? 'low' : ''; }
  function bar(p) {
    var b = h('div', { class: 'bar ' + barClass(p), 'aria-hidden': 'true' }, h('i'));
    b.firstChild.style.width = p + '%';
    return b;
  }

  function comparisonCard(d) {
    var rows = Array.isArray(d.comparison) ? d.comparison.filter(function (r) { return r && typeof r === 'object'; }) : [];
    if (!rows.length) return null;
    var chosen = d.vacancy ? d.vacancy.resumeId : null;
    var c = card('Сравнение резюме');
    c.appendChild(h('p', { class: 'hint', text: 'Резюме ранжируются прежде всего по покрытию обязательных требований, затем по общему баллу.' }));
    c.appendChild(h('ul', { class: 'cmp' }, rows.map(function (r, i) {
      var cov = pct(r.hardCoverage);
      var overall = num(r.overall);
      var isChosen = chosen !== undefined && chosen !== null && String(r.resumeId) === String(chosen);
      var head = h('div', { class: 'cmp-head' }, h('span', { class: 'cmp-name', text: r.name || ('Резюме ' + str(r.resumeId)) }));
      if (i === 0) head.appendChild(h('span', { class: 'chip pick', text: 'Рекомендуется' }));
      if (isChosen) head.appendChild(h('span', { class: 'chip chosen', text: 'Выбрано для отклика' }));
      var nums = h('div', { class: 'cmp-nums' },
        h('span', null, 'Обязательные требования: ', h('b', { text: cov === null ? 'нет данных' : Math.round(cov) + '%' })),
        h('span', null, 'Общий балл: ', h('b', { text: overall === null ? '—' : overall })));
      var li = h('li', { class: i === 0 ? 'top' : '' }, head, nums);
      if (cov !== null) li.appendChild(bar(cov));
      return li;
    })));
    return c;
  }

  /* ---------- вкладки ---------- */

  var TABS = ['pipeline', 'resumes', 'settings'];
  var tabState = { current: 'pipeline' };

  function tabFromHash() {
    var t = (location.hash || '').replace(/^#/, '');
    return TABS.indexOf(t) !== -1 ? t : 'pipeline';
  }
  function setTab(name, fromHash) {
    tabState.current = name;
    TABS.forEach(function (t) {
      var on = t === name;
      var btn = $('tab-' + t);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      $('view-' + t).hidden = !on;
    });
    if (!fromHash && tabFromHash() !== name) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { location.hash = name; }
    }
    refreshActive(true);
  }
  function refreshActive(entering) {
    var t = tabState.current;
    if (t === 'pipeline') refreshAll();
    else if (t === 'resumes') loadResumes();
    else loadSettingsView(entering);
  }
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.tab') : null;
    if (b) setTab(b.getAttribute('data-tab'), false);
  });
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    var i = TABS.indexOf(tabState.current), n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setTab(TABS[n], false);
    $('tab-' + TABS[n]).focus();
  });
  window.addEventListener('hashchange', function () {
    var t = tabFromHash();
    if (t !== tabState.current) setTab(t, true);
  });

  /* ---------- резюме: список ---------- */

  var rs = { items: null, selected: null, detail: null, token: 0, sig: '', loadedReviewedAt: null };
  var rEls = {
    list: $('resList'), error: $('resError'), detail: $('resDetail'), pane: $('resDetailPane'), back: $('resBack')
  };

  var SOURCE_RU = { manual: 'вручную', 'hh.ru': 'hh.ru' };
  function scoreChipClass(s) { return s >= 75 ? 'go' : s >= 50 ? 'maybe' : 'stop'; }

  function loadResumes() {
    return api('GET', '/api/resumes').then(function (data) {
      rs.items = (data && data.items) || [];
      rEls.error.hidden = true;
      setConn(true);
      renderResList();
      if (rs.selected !== null) {
        var row = rs.items.filter(function (r) { return String(r.id) === String(rs.selected); })[0];
        if (row && row.reviewedAt !== rs.loadedReviewedAt) loadResume(rs.selected, true);
      }
    }).catch(function (e) {
      rEls.error.textContent = errText(e) + (rs.items ? ' Показаны данные последней загрузки.' : '');
      rEls.error.hidden = false;
      setConn(false);
      if (rs.items === null) { rs.items = []; renderResList(); }
    });
  }

  function renderResList() {
    if (rs.items === null) {
      clear(rEls.list);
      rEls.list.appendChild(h('div', { class: 'empty', text: 'Загрузка…' }));
      return;
    }
    var sig = JSON.stringify([rs.items, rs.selected]);
    if (sig === rs.sig) return;
    rs.sig = sig;
    var active = document.activeElement;
    var focusId = active && active.classList && active.classList.contains('row') && rEls.list.contains(active) ? active.getAttribute('data-id') : null;
    clear(rEls.list);
    if (!rs.items.length) {
      rEls.list.appendChild(h('div', { class: 'empty' }, h('b', { text: 'Пока нет резюме' }), 'Попросите ассистента импортировать или сохранить резюме: оно появится здесь.'));
      return;
    }
    var box = h('div', { class: 'group', role: 'group', 'aria-label': 'Резюме' },
      h('div', { class: 'group-head' }, h('span', { text: 'Ваши резюме' }), h('span', { class: 'n', text: rs.items.length })));
    rs.items.forEach(function (r) {
      var meta = h('div', { class: 'row-meta' });
      var score = num(r.reviewScore);
      if (r.reviewedAt && score !== null) {
        meta.appendChild(h('span', { class: 'chip ' + scoreChipClass(score), text: 'ATS ' + Math.round(score) }));
        meta.appendChild(h('span', { text: 'проверено ' + ago(r.reviewedAt) }));
      } else if (r.reviewedAt) {
        meta.appendChild(h('span', { text: 'проверено ' + ago(r.reviewedAt) }));
      } else {
        meta.appendChild(h('span', { class: 'chip', text: 'ещё не проверено' }));
      }
      meta.appendChild(h('span', { text: SOURCE_RU[r.source] || str(r.source) }));
      var btn = h('button', {
        type: 'button', class: 'row', 'data-id': r.id,
        'aria-current': String(r.id) === String(rs.selected) ? 'true' : null,
        on: { click: function () { selectResume(r.id); } }
      }, h('div', { class: 'row-title', text: r.name || '(без названия)' }));
      if (r.title) btn.appendChild(h('div', { class: 'row-meta' }, h('span', { class: 'co', text: r.title })));
      btn.appendChild(meta);
      box.appendChild(btn);
    });
    rEls.list.appendChild(box);
    if (focusId !== null) {
      var again = rEls.list.querySelector('.row[data-id="' + String(focusId).replace(/"/g, '\\"') + '"]');
      if (again) again.focus({ preventScroll: true });
    }
  }

  function selectResume(id) {
    rs.selected = id;
    document.body.classList.add('show-rdetail');
    rEls.back.hidden = false;
    rs.sig = '';
    renderResList();
    loadResume(id, false);
    rEls.pane.focus({ preventScroll: false });
    window.scrollTo(0, 0);
  }

  function loadResume(id, silent) {
    var token = ++rs.token;
    if (!silent) {
      clear(rEls.detail);
      rEls.detail.appendChild(h('div', { class: 'empty', text: 'Загрузка…' }));
    }
    return api('GET', '/api/resumes/' + encodeURIComponent(id)).then(function (data) {
      if (token !== rs.token || String(rs.selected) !== String(id)) return;
      rs.detail = data && data.resume;
      rs.loadedReviewedAt = rs.detail ? rs.detail.reviewedAt : null;
      renderResume();
    }).catch(function (e) {
      if (token !== rs.token || silent) return;
      clear(rEls.detail);
      rEls.detail.appendChild(h('div', { class: 'banner banner-error', role: 'alert', text: 'Не удалось загрузить резюме. ' + errText(e) }));
    });
  }

  /* ---------- резюме: аудит (JSON от модели, любая часть может отсутствовать) ---------- */

  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function txt(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try { return JSON.stringify(v); } catch (e) { return ''; }
  }
  function parseReview(r) {
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { return null; } }
    return r && typeof r === 'object' && !Array.isArray(r) ? r : null;
  }

  function scoreBars(items) {
    var list = h('ul', { class: 'bars' });
    items.forEach(function (it) {
      var p = pct(it.value);
      var li = h('li', null,
        h('div', { class: 'bl' }, h('span', { text: it.label + (it.weight ? ' · вес ' + it.weight : '') }), h('b', { text: p === null ? 'нет данных' : Math.round(p) + ' / 100' })));
      if (p !== null) li.appendChild(bar(p));
      list.appendChild(li);
    });
    return list;
  }

  function copyBox(label, text) {
    var pre = h('pre', { text: text });
    var status = h('span', { class: 'hint', role: 'status' });
    var btn = h('button', { type: 'button', class: 'btn', text: 'Копировать', 'aria-label': 'Копировать: ' + label });
    btn.addEventListener('click', function () {
      function fallback() {
        try {
          var range = document.createRange();
          range.selectNodeContents(pre);
          var sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
          status.textContent = 'Текст выделен: нажмите Ctrl+C';
        } catch (e) { status.textContent = 'Не удалось скопировать'; }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () { status.textContent = 'Скопировано'; }, fallback);
      } else fallback();
    });
    return h('div', { class: 'copy-box' }, pre, h('div', { class: 'actions' }, btn, status));
  }

  function tagList(items) {
    var a = arr(items).map(txt).filter(Boolean);
    if (!a.length) return h('p', { class: 'muted', text: 'нет данных' });
    return h('ul', { class: 'tags' }, a.map(function (t) { return h('li', { class: 'chip', text: t }); }));
  }

  function auditNodes(rv) {
    var out = [];
    var sb = obj(rv.score_breakdown);

    var c = card('Оценка ATS');
    var overall = pct(rv.overall_ats_score);
    var line = h('div', { class: 'score-line' });
    line.appendChild(h('span', { class: 'score-big', text: overall === null ? '—' : Math.round(overall) }));
    line.appendChild(h('span', { class: 'muted', text: overall === null ? 'общий балл не указан' : 'из 100, общий балл' }));
    c.appendChild(line);
    if (overall !== null) c.appendChild(bar(overall));
    c.appendChild(scoreBars([
      { label: 'Совпадение ключевых слов', weight: '35%', value: sb.keyword_match_score },
      { label: 'Структура', weight: '20%', value: sb.structure_score },
      { label: 'Релевантность опыта', weight: '25%', value: sb.experience_relevance_score },
      { label: 'Плотность метрик', weight: '20%', value: sb.metrics_density_score }
    ]));
    out.push(c);

    var issues = arr(sb.issues).filter(function (x) { return x && (typeof x !== 'object' || x.issue || x.area || x.impact); });
    if (issues.length) {
      var ci = card('Проблемы');
      issues.forEach(function (it) {
        var o = obj(it);
        var item = h('div', { class: 'item' });
        if (typeof it === 'string') item.appendChild(document.createTextNode(it));
        else {
          if (o.area) item.appendChild(h('b', { text: txt(o.area) }));
          if (o.issue) item.appendChild(h('span', { text: txt(o.issue) }));
          if (o.impact) item.appendChild(h('span', { class: 'sub', text: 'Влияние: ' + txt(o.impact) }));
        }
        ci.appendChild(item);
      });
      out.push(ci);
    }

    if (txt(rv.value_proposition)) {
      var cv = card('Ценностное предложение');
      cv.appendChild(h('p', { class: 'reason', text: txt(rv.value_proposition) }));
      out.push(cv);
    }

    var jobs = arr(rv.experience_breakdown).filter(function (x) { return x && typeof x === 'object'; });
    if (jobs.length) {
      var cj = card('Разбор по местам работы');
      jobs.forEach(function (j) {
        var item = h('div', { class: 'item' });
        item.appendChild(h('b', { text: txt(j.company) || 'Место работы не указано' }));
        var iss = arr(j.issues).map(txt).filter(Boolean);
        if (iss.length) item.appendChild(textList(iss));
        if (txt(j.suggested_rewrite)) {
          item.appendChild(h('div', { class: 'sub', text: 'Предлагаемая формулировка' }));
          item.appendChild(copyBox(txt(j.company) || 'формулировка', txt(j.suggested_rewrite)));
        }
        cj.appendChild(item);
      });
      out.push(cj);
    }

    var hf = obj(rv.hh_ranking_factors);
    var hfRows = [['Обновление резюме', hf.last_update], ['Статус поиска работы', hf.search_status],
      ['Плотность ключевых слов в карточке', hf.card_preview_density], ['Замечания', hf.notes]].filter(function (r) { return txt(r[1]); });
    if (hfRows.length) {
      var ch = card('Факторы ранжирования на hh.ru');
      var dl = h('dl', { class: 'facts' });
      hfRows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: txt(r[1]) })); });
      ch.appendChild(dl);
      out.push(ch);
    }

    var tr = obj(rv.target_roles);
    var groups = [['core', 'Основные роли'], ['transferable', 'Смежные роли'], ['growth', 'Роли для роста']];
    var anyRole = groups.some(function (g) { return arr(tr[g[0]]).length; });
    if (anyRole) {
      var cr = card('Подходящие роли');
      groups.forEach(function (g) {
        var roles = arr(tr[g[0]]).filter(function (x) { return x && typeof x === 'object'; });
        if (!roles.length) return;
        cr.appendChild(h('h3', { text: g[1] + ' (' + roles.length + ')' }));
        roles.forEach(function (r) {
          var p = pct(r.match_percent);
          var head = h('div', { class: 'role-head' }, h('b', { text: txt(r.title_ru) || txt(r.title_en) || 'Без названия' }));
          if (txt(r.title_ru) && txt(r.title_en)) head.appendChild(h('span', { class: 'muted', text: txt(r.title_en) }));
          if (p !== null) head.appendChild(h('span', { class: 'chip', text: Math.round(p) + '%' }));
          var item = h('div', { class: 'item' }, head);
          if (p !== null) item.appendChild(bar(p));
          if (txt(r.reasoning)) item.appendChild(h('div', { class: 'sub', text: txt(r.reasoning) }));
          cr.appendChild(item);
        });
      });
      out.push(cr);
    }

    var km = obj(rv.keyword_matrix);
    var kinds = [['hard_skills_tools', 'Навыки и инструменты'], ['domain_methodology', 'Предметная область и методологии'], ['action_verbs', 'Глаголы действия']];
    var anyKw = groups.some(function (g) { return kinds.some(function (k) { return arr(obj(km[g[0]])[k[0]]).length; }); });
    if (anyKw) {
      var ck = card('Матрица ключевых слов');
      groups.forEach(function (g) {
        var grp = obj(km[g[0]]);
        if (!kinds.some(function (k) { return arr(grp[k[0]]).length; })) return;
        var det = h('details', { class: 'kw-grid', open: g[0] === 'core' }, h('summary', { text: g[1] }));
        kinds.forEach(function (k) {
          if (!arr(grp[k[0]]).length) return;
          det.appendChild(h('h3', { text: k[1] }));
          det.appendChild(tagList(grp[k[0]]));
        });
        ck.appendChild(det);
      });
      out.push(ck);
    }

    var cl = arr(rv.optimization_checklist).filter(function (x) { return x && (typeof x !== 'object' || x.action); });
    if (cl.length) {
      var cc = card('Чек-лист оптимизации');
      cc.appendChild(h('ul', { class: 'checklist' }, cl.map(function (x) {
        if (typeof x !== 'object') return h('li', { text: x });
        return h('li', null,
          h('b', { text: txt(x.action) }),
          x.target_section ? h('div', { class: 'sub muted', text: 'Раздел: ' + txt(x.target_section) }) : null,
          x.why ? h('div', { text: txt(x.why) }) : null);
      })));
      out.push(cc);
    }
    return out;
  }

  function renderResume() {
    var r = rs.detail;
    var scroll = window.scrollY;
    var openText = !!rEls.detail.querySelector('details.res-text[open]');
    clear(rEls.detail);
    if (!r) return;
    var head = card(null);
    head.appendChild(h('h2', { class: 'd-title', text: r.name || '(без названия)' }));
    if (r.title) head.appendChild(h('p', { class: 'd-sub', text: r.title }));
    var dl = h('dl', { class: 'facts' });
    dl.appendChild(h('dt', { text: 'Источник' })); dl.appendChild(h('dd', { text: SOURCE_RU[r.source] || str(r.source) || '—' }));
    dl.appendChild(h('dt', { text: 'Проверено' }));
    dl.appendChild(h('dd', { text: r.reviewedAt ? absTime(r.reviewedAt) + ' (' + ago(r.reviewedAt) + ')' : 'ещё не проверено' }));
    head.appendChild(dl);
    var url = safeUrl(r.url);
    if (url) head.appendChild(h('p', null, h('a', { class: 'link', href: url, target: '_blank', rel: 'noopener noreferrer', text: 'Открыть резюме на сайте' })));
    rEls.detail.appendChild(head);

    var rv = parseReview(r.review);
    if (!rv) {
      rEls.detail.appendChild(h('div', { class: 'empty' }, h('b', { text: 'Аудит ещё не проведён' }),
        r.review ? 'Сохранённый результат не удалось разобрать.' : 'Попросите ассистента проверить это резюме: результат появится здесь.'));
    } else {
      auditNodes(rv).forEach(function (n) { rEls.detail.appendChild(n); });
    }

    var tc = card('Текст резюме');
    var det = h('details', { class: 'res-text', open: openText }, h('summary', { text: 'Показать текст' }),
      h('div', { class: 'desc', text: str(r.text) || 'Текст отсутствует.' }));
    tc.appendChild(det);
    rEls.detail.appendChild(tc);
    window.scrollTo(0, scroll);
  }

  rEls.back.addEventListener('click', function () {
    document.body.classList.remove('show-rdetail');
    window.scrollTo(0, 0);
  });

  /* ---------- настройки ---------- */

  var ss = { loaded: false, settings: null };
  var sEls = { body: $('setBody'), src: $('srcBody') };
  var form = null;

  function linesToList(text) {
    var seen = {}, out = [];
    String(text).split(/\r?\n/).forEach(function (l) {
      var t = l.trim();
      if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); }
    });
    return out;
  }

  function buildForm() {
    var f = { err: {} };
    function field(id, label, hint, input) {
      var err = h('p', { class: 'err', id: id + 'Err', hidden: true });
      f.err[id] = err;
      input.setAttribute('aria-describedby', id + 'Hint ' + id + 'Err');
      return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, h('p', { class: 'hint', id: id + 'Hint', text: hint }), err);
    }
    f.daily = h('input', { type: 'number', id: 'sDaily', min: 0, max: 200, step: 1, inputmode: 'numeric' });
    f.delay = h('input', { type: 'number', id: 'sDelay', min: 0, max: 3600, step: 1, inputmode: 'numeric' });
    f.black = h('textarea', { id: 'sBlack', spellcheck: 'false', rows: 5 });
    f.stop = h('textarea', { id: 'sStop', spellcheck: 'false', rows: 5 });
    f.save = h('button', { type: 'submit', class: 'btn btn-save', text: 'Сохранить настройки' });
    f.status = h('div', { class: 'toast', role: 'status' });
    f.dirty = h('span', { class: 'dirty', 'aria-live': 'polite' });
    f.form = h('form', { novalidate: true },
      field('sDaily', 'Лимит откликов в день', 'От 0 до 200. Ноль приостанавливает отправку.', f.daily),
      field('sDelay', 'Минимальная пауза между откликами, секунд', 'От 0 до 3600.', f.delay),
      field('sBlack', 'Чёрный список работодателей', 'По одному названию в строке. Отклики этим компаниям не отправляются.', f.black),
      field('sStop', 'Стоп-слова', 'По одному слову или фразе в строке. Вакансии с ними пропускаются.', f.stop),
      h('div', { class: 'actions' }, f.save, f.dirty), f.status);
    f.form.addEventListener('input', function () { markDirty(); });
    f.form.addEventListener('submit', function (e) { e.preventDefault(); submitSettings(); });
    return f;
  }

  function formValues() {
    return { daily: form.daily.value.trim(), delay: form.delay.value.trim(), black: linesToList(form.black.value), stop: linesToList(form.stop.value) };
  }
  function snapshot(s) {
    return JSON.stringify([String(s.dailyLimit), String(s.minDelaySec), arr(s.blacklistEmployers), arr(s.stopWords)]);
  }
  function currentSnapshot() {
    var v = formValues();
    return JSON.stringify([v.daily, v.delay, v.black, v.stop]);
  }
  function isDirty() { return !!(form && ss.settings && currentSnapshot() !== snapshot(ss.settings)); }
  function markDirty() { form.dirty.textContent = isDirty() ? 'Есть несохранённые правки' : ''; }

  function fillForm(s) {
    form.daily.value = s.dailyLimit;
    form.delay.value = s.minDelaySec;
    form.black.value = arr(s.blacklistEmployers).join('\n');
    form.stop.value = arr(s.stopWords).join('\n');
    clearErrors();
    markDirty();
  }
  function setErr(id, input, msg) {
    var e = form.err[id];
    e.textContent = msg || '';
    e.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }
  function clearErrors() {
    setErr('sDaily', form.daily, ''); setErr('sDelay', form.delay, '');
  }
  function validIntIn(raw, min, max) {
    if (!/^-?\d+$/.test(raw)) return false;
    var n = Number(raw);
    return n >= min && n <= max;
  }

  function submitSettings() {
    var v = formValues();
    var bad = null;
    clearErrors();
    form.status.className = 'toast';
    form.status.textContent = '';
    if (!validIntIn(v.daily, 0, 200)) { setErr('sDaily', form.daily, 'Введите целое число от 0 до 200.'); bad = bad || form.daily; }
    if (!validIntIn(v.delay, 0, 3600)) { setErr('sDelay', form.delay, 'Введите целое число от 0 до 3600.'); bad = bad || form.delay; }
    if (bad) { bad.focus(); return; }
    form.save.disabled = true;
    api('PUT', '/api/settings', {
      dailyLimit: Number(v.daily), minDelaySec: Number(v.delay), blacklistEmployers: v.black, stopWords: v.stop
    }).then(function (res) {
      var s = res && res.settings;
      if (!s) throw new Error('Пустой ответ сервера');
      ss.settings = s;
      fillForm(s);
      form.status.className = 'banner toast banner-ok';
      form.status.textContent = 'Настройки сохранены.';
    }).catch(function (e) {
      form.status.className = 'banner toast banner-error';
      form.status.textContent = 'Не удалось сохранить. ' + errText(e);
    }).then(function () { form.save.disabled = false; });
  }

  function filtersSummary(f) {
    f = obj(f);
    var parts = [];
    Object.keys(f).forEach(function (k) {
      var val = f[k];
      if (val === undefined || val === null || val === '' || (Array.isArray(val) && !val.length)) return;
      parts.push(k + ': ' + (Array.isArray(val) ? val.map(txt).join(', ') : txt(val)));
    });
    return parts.join(' · ');
  }

  function renderSearches(items) {
    clear(sEls.src);
    if (!items.length) {
      sEls.src.appendChild(h('div', { class: 'empty' }, h('b', { text: 'Сохранённых поисков нет' }), 'Ассистент сохранит поиск, когда вы попросите искать вакансии регулярно.'));
      return;
    }
    sEls.src.appendChild(h('ul', { class: 'srcs' }, items.map(function (s) {
      var line = h('div', { class: 'row-meta' });
      line.appendChild(h('span', { text: s.lastRunAt ? 'Последний запуск: ' + absTime(s.lastRunAt) + ' (' + ago(s.lastRunAt) + ')' : 'Ещё не запускался' }));
      if (s.site) line.appendChild(h('span', { text: s.site }));
      if (s.enabled === false) line.appendChild(h('span', { class: 'chip', text: 'выключен' }));
      var fs = filtersSummary(s.filters);
      return h('li', null,
        h('b', { text: s.name || '(без названия)' }),
        h('div', { text: s.text ? '«' + s.text + '»' : 'Текст запроса не задан' }),
        fs ? h('div', { class: 'muted', text: 'Фильтры: ' + fs }) : null,
        line);
    })));
  }

  function loadSettingsView(entering) {
    if (!form) {
      form = buildForm();
      sEls.body.appendChild(form.form);
    }
    // форму грузим при первом входе и при возврате на вкладку, но не затираем несохранённые правки
    var pSettings = (!ss.loaded || entering) ? api('GET', '/api/settings').then(function (res) {
      var s = res && res.settings;
      if (!s) return;
      var dirty = isDirty();
      ss.settings = s;
      ss.loaded = true;
      if (!dirty) fillForm(s); else markDirty();
    }) : Promise.resolve();
    var pSearch = api('GET', '/api/searches').then(function (res) { renderSearches((res && res.items) || []); });
    return Promise.all([
      pSettings.catch(function (e) {
        form.status.className = 'banner toast banner-error';
        form.status.textContent = 'Не удалось загрузить настройки. ' + errText(e);
      }),
      pSearch.catch(function (e) {
        clear(sEls.src);
        sEls.src.appendChild(h('div', { class: 'banner banner-error', role: 'alert', text: 'Не удалось загрузить поиски. ' + errText(e) }));
      })
    ]).then(function () { if (ss.loaded) setConn(true); });
  }

  /* ---------- запуск ---------- */

  els.fText.addEventListener('input', function () { renderList(false); });
  els.fStatus.addEventListener('change', function () { renderList(false); });
  els.back.addEventListener('click', function () {
    document.body.classList.remove('show-detail');
    window.scrollTo(0, 0);
  });
  document.addEventListener('keydown', function (e) {
    var tag = document.activeElement && document.activeElement.tagName;
    if (e.key !== 'Escape' || tag === 'TEXTAREA' || tag === 'INPUT' || !window.matchMedia('(max-width: 860px)').matches) return;
    if (tabState.current === 'pipeline') document.body.classList.remove('show-detail');
    else if (tabState.current === 'resumes') document.body.classList.remove('show-rdetail');
  });

  els.detail.appendChild(h('div', { class: 'empty' }, h('b', { text: 'Выберите вакансию' }), 'Откроются оценка, письмо и история.'));
  rEls.detail.appendChild(h('div', { class: 'empty' }, h('b', { text: 'Выберите резюме' }), 'Откроется аудит: оценка ATS, проблемы и рекомендации.'));
  fillStatusFilter();
  renderList(true);
  setTab(tabFromHash(), true);
  // обновляется только видимый раздел; поля ввода (письмо, форма настроек) не затираются
  setInterval(function () { if (!document.hidden) refreshActive(false); }, REFRESH_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshActive(false); });
})();

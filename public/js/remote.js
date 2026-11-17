// Phone remote: the host's answer key and controller.
(() => {
  const $ = (id) => document.getElementById(id);
  const PIN_KEY = 'friends-feuuud-pin';
  const socket = io({ query: { role: 'remote' } });

  let view = null;
  let tab = 'play';
  let authPending = false;
  let setupDirty = false;
  let setupCount = 2;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
  };

  // ------------------------------------------------------------ connection
  socket.on('connect', () => {
    $('offline').hidden = true;
    $('conn').classList.remove('down');
    const pin = store.get(PIN_KEY);
    if (pin) {
      authPending = true;
      socket.emit('auth', pin, () => { authPending = false; render(); });
    }
  });
  socket.on('disconnect', () => {
    $('offline').hidden = false;
    $('conn').classList.add('down');
  });
  socket.on('state', (v) => {
    view = v;
    render();
  });

  function send(type, params = {}) {
    if (navigator.vibrate) navigator.vibrate(12);
    socket.emit('action', { type, ...params }, (res) => {
      if (res && !res.ok) toast(res.error || 'That did not work.', true);
    });
  }

  function toast(text, bad = false) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 2200);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------ render
  function render() {
    if (!view) return;
    renderStrip();
    const locked = !view.authorized;
    if (locked && authPending) return;
    $('locked').hidden = !locked;
    $('app').hidden = locked;
    $('tabs').hidden = locked;
    $('undo').hidden = locked;
    if (locked) { renderLocked(); return; }
    $('undo').disabled = !view.canUndo;
    renderPlay();
    renderScores();
    renderSetup();
  }

  function renderStrip() {
    const v = view;
    const r = v.round;
    let html = v.teams.map((t, i) => `<div class="chip t${i}${r.control === i && r.awardedTo === null ? ' control' : ''}"><div class="n">${esc(t.name)}</div><div class="s">${t.score}</div></div>`).join('');
    html += `<div class="pot"><div class="n">${r.awardedTo === null ? 'Pot' : 'Won'}</div><div class="s">${r.pot}</div></div>`;
    html += `<div class="xs" aria-label="${r.strikes} strikes">${[0, 1, 2].map((i) => `<span class="${i < r.strikes ? 'on' : ''}">X</span>`).join('')}</div>`;
    $('strip').innerHTML = html;
  }

  function renderLocked() {
    const v = view;
    $('lockedMeta').textContent = `Question ${v.question.number}`;
    $('lockedQ').textContent = v.question.text;
    $('lockedAnswers').innerHTML = v.answers.map((a) => a.revealed
      ? `<li><span>${a.n}. ${esc(a.text)}</span><span>${a.points}</span></li>`
      : `<li class="hidden"><span>${a.n}. ?</span><span></span></li>`).join('');
  }

  function renderPlay() {
    const v = view;
    const r = v.round;
    const multText = r.multiplier === 2 ? ' . Double points' : r.multiplier === 3 ? ' . Triple points' : '';
    // The total is only on the host's phone; the big screen never shows it.
    $('qMeta').innerHTML = `Question ${v.question.number} of ${v.question.total}${multText}${v.question.hard ? '<span class="tag-hard">Hard</span>' : ''}`;
    $('introCard').hidden = !v.intro;
    $('qText').textContent = v.question.text;
    $('prev').disabled = v.question.number <= 1;
    $('next').disabled = v.question.number >= v.question.total;

    const fresh = renderPlay.qid !== v.question.id;
    renderPlay.qid = v.question.id;
    $('answers').classList.toggle('fresh', fresh);
    $('answers').innerHTML = v.answers.map((a, i) => `
      <button type="button" style="--k:${i}" class="ans${a.revealed ? ' revealed' : ''}${a.revealed && !a.earned ? ' shown' : ''}" data-i="${i}">
        <span class="num">${a.n}</span><span class="txt">${esc(a.text)}</span><span class="pts">${a.points}</span>
      </button>`).join('');

    $('strike').innerHTML = `<span class="x">X</span> Strike${r.strikes ? ` (${r.strikes} of 3)` : ''}`;
    $('revealAll').disabled = r.allRevealed;

    $('control').innerHTML = v.teams.map((t, i) => `<button type="button" class="t${i}${r.control === i ? ' on' : ''}" data-team="${i}">${esc(t.name)}</button>`).join('');

    [...$('mult').children].forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.m) === r.multiplier);
      b.disabled = r.awardedTo !== null;
    });

    const card = document.querySelector('.award-card');
    if (r.awardedTo !== null) {
      card.classList.add('done');
      $('awardTitle').textContent = 'Pot awarded';
      $('award').innerHTML = `<div class="btn t${r.awardedTo}" style="cursor:default"><span>${esc(v.teams[r.awardedTo] ? v.teams[r.awardedTo].name : 'Team')}</span><span class="pts">+${r.awardedPoints}</span></div>`;
      $('awardNote').textContent = r.allRevealed ? 'All answers are showing. On to the next question.' : 'Reveal the rest with Reveal all, then go to the next question. Use Undo to change who got it.';
    } else {
      card.classList.remove('done');
      $('awardTitle').textContent = r.steal ? 'Steal: who gets the pot?' : 'Give the pot';
      $('award').innerHTML = v.teams.map((t, i) => {
        const steal = r.steal && r.control !== null && r.control !== i;
        return `<button type="button" class="btn t${i}${steal ? ' steal' : ''}" data-team="${i}" ${r.pot ? '' : 'disabled'}><span>${steal ? 'Steal to ' : 'Give to '}${esc(t.name)}</span><span class="pts">+${r.pot}</span></button>`;
      }).join('');
      $('awardNote').textContent = r.pot
        ? (r.steal ? 'Three strikes. If the other team names a hidden answer, reveal it, then give them the pot.' : 'Reveal answers to build the pot, then give it to the team that won the round.')
        : 'The pot fills up as you reveal answers.';
    }
  }

  function renderScores() {
    const v = view;
    $('adjust').innerHTML = v.teams.map((t, i) => `
      <div class="adj t${i}">
        <div class="head"><span class="n">${esc(t.name)}</span><span class="s">${t.score}</span></div>
        <div class="row">
          ${[-10, -5, -1, 1, 5, 10].map((d) => `<button type="button" class="${d < 0 ? 'minus' : 'plus'}" data-team="${i}" data-d="${d}">${d > 0 ? '+' : ''}${d}</button>`).join('')}
        </div>
      </div>`).join('');
    $('log').innerHTML = v.history.length
      ? v.history.map((h) => `<li class="t${h.team}"><span>Q${h.number}. ${esc(h.question)}<br><span class="who">${esc(v.teams[h.team] ? v.teams[h.team].name : 'Team')}${h.multiplier > 1 ? ` . x${h.multiplier}` : ''}</span></span><span class="p">+${h.points}</span></li>`).join('')
      : '<li class="empty">No rounds won yet.</li>';
    $('finalBtn').textContent = v.final ? 'Hide final scores' : 'Show final scores';
  }

  function renderSetup() {
    const v = view;
    if (!setupDirty) setupCount = v.teamCount;
    [...$('teamCount').children].forEach((b) => b.classList.toggle('on', Number(b.dataset.c) === setupCount));
    const names = $('names');
    const focused = names.contains(document.activeElement);
    if (!focused && (!setupDirty || names.children.length !== setupCount)) {
      const current = [...names.querySelectorAll('input')].map((inp) => inp.value);
      names.innerHTML = '';
      for (let i = 0; i < setupCount; i++) {
        const label = document.createElement('label');
        label.className = `t${i}`;
        label.textContent = `Team ${i + 1}`;
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 24;
        input.value = setupDirty && current[i] !== undefined ? current[i] : (view.teams[i] ? view.teams[i].name : '');
        if (!input.value && !view.teams[i]) input.placeholder = ['The Legends', 'The Underdogs', 'The Wildcards'][i];
        input.addEventListener('input', () => { setupDirty = true; });
        label.appendChild(input);
        names.appendChild(label);
      }
    }
    $('qrToggle').checked = v.showQr;
    $('introBtn').textContent = v.intro ? 'Hide the intro screen' : 'Show the intro screen';
    $('jump').innerHTML = (v.questionList || []).map((q) => `<li><button type="button" data-pos="${q.pos}" class="${q.pos === v.question.number - 1 ? 'current' : ''}">${q.pos + 1}. ${esc(q.text)}${q.hard ? '<span class="tag-hard">Hard</span>' : ''}${q.awarded ? '<span class="tag">done</span>' : ''}</button></li>`).join('');
    $('pinStatus').textContent = v.pinSet
      ? 'The remote is locked. Other phones need the PIN to control the game.'
      : 'Anyone on the Wi-Fi who opens the remote can control the game. Set a PIN so only you can.';
    $('clearPin').hidden = !v.pinSet;
  }

  // ------------------------------------------------------------ events
  $('answers').addEventListener('click', (e) => {
    const b = e.target.closest('.ans');
    if (!b) return;
    const i = Number(b.dataset.i);
    const a = view.answers[i];
    if (a.revealed) {
      if (confirm(`Hide "${a.text}" on the big screen again?`)) send('hide', { index: i });
      return;
    }
    send('reveal', { index: i });
  });
  $('strike').addEventListener('click', () => send('strike'));
  $('revealAll').addEventListener('click', () => send('revealAll'));
  $('undo').addEventListener('click', () => send('undo'));
  $('prev').addEventListener('click', () => send('prev'));
  $('next').addEventListener('click', () => {
    const r = view.round;
    if (r.awardedTo === null && r.pot > 0 && !confirm(`Nobody has been given the pot of ${r.pot} yet. Move on anyway?`)) return;
    send('next');
  });
  $('control').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-team]');
    if (!b) return;
    const t = Number(b.dataset.team);
    send('setControl', { team: view.round.control === t ? null : t });
  });
  $('mult').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-m]');
    if (b && !b.disabled) send('setMultiplier', { value: Number(b.dataset.m) });
  });
  $('award').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-team]');
    if (b && !b.disabled) send('award', { team: Number(b.dataset.team) });
  });
  $('resetRound').addEventListener('click', () => {
    if (confirm('Restart this round? Answers get hidden, strikes clear, and any points given for this round are taken back.')) send('resetRound');
  });
  $('adjust').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-d]');
    if (b) send('adjustScore', { team: Number(b.dataset.team), delta: Number(b.dataset.d) });
  });
  $('finalBtn').addEventListener('click', () => send('setFinal', { on: !view.final }));

  $('teamCount').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]');
    if (!b) return;
    setupDirty = true;
    setupCount = Number(b.dataset.c);
    renderSetup();
  });
  const teamNames = () => [...$('names').querySelectorAll('input')].map((inp) => inp.value.trim());
  $('saveTeams').addEventListener('click', () => {
    send('setTeams', { count: setupCount, names: teamNames() });
    setupDirty = false;
    document.activeElement && document.activeElement.blur();
    toast('Teams saved');
  });
  $('newGame').addEventListener('click', () => {
    if (!confirm(`Start a new game with ${setupCount} teams? All scores go back to 0.`)) return;
    send('newGame', { count: setupCount, names: teamNames(), shuffle: $('shuffle').checked });
    setupDirty = false;
    document.activeElement && document.activeElement.blur();
    showTab('play');
  });
  $('startGame').addEventListener('click', () => send('setIntro', { on: false }));
  $('introBtn').addEventListener('click', () => {
    send('setIntro', { on: !view.intro });
    if (!view.intro) showTab('play');
  });
  $('qrToggle').addEventListener('change', (e) => send('toggleQr', { on: e.target.checked }));
  $('jump').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pos]');
    if (!b) return;
    send('goto', { pos: Number(b.dataset.pos) });
    showTab('play');
  });

  $('setPinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('newPin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) { toast('Use 4 to 8 digits for the PIN.', true); return; }
    socket.emit('setPin', pin, (res) => {
      if (res && res.ok) { store.set(PIN_KEY, pin); $('newPin').value = ''; toast('PIN set. Other phones now need it.'); }
      else toast((res && res.error) || 'Could not set the PIN.', true);
    });
  });
  $('clearPin').addEventListener('click', () => {
    if (!confirm('Remove the PIN? Anyone on the Wi-Fi could then control the game.')) return;
    socket.emit('setPin', '', (res) => {
      if (res && res.ok) { store.del(PIN_KEY); toast('PIN removed'); }
      else toast((res && res.error) || 'Could not remove the PIN.', true);
    });
  });
  $('pinForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('pinInput').value.trim();
    socket.emit('auth', pin, (res) => {
      if (res && res.ok) {
        store.set(PIN_KEY, pin);
        $('pinError').hidden = true;
        $('pinInput').value = '';
      } else {
        $('pinError').textContent = 'That PIN is not right.';
        $('pinError').hidden = false;
      }
    });
  });

  function showTab(name) {
    tab = name;
    document.querySelectorAll('.tab').forEach((s) => { s.hidden = s.dataset.tab !== name; });
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    window.scrollTo({ top: 0 });
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
})();

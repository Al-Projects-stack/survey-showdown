// Big screen: renders the server state and plays the effects for each action.
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io({ query: { role: 'display' } });

  let view = null;
  let lastSeq = null;
  let boardQuestionId = null;
  let teamCountShown = 0;
  const shownScores = [];
  let shownPot = 0;
  let joinUrls = [];
  let joinIdx = 0;
  let introShown = false;
  let introTeamsKey = '';
  let tileDelayBase = 0;

  // ------------------------------------------------------------ connection
  socket.on('connect', () => { $('offline').hidden = true; $('conn').classList.remove('down'); });
  socket.on('disconnect', () => { $('offline').hidden = false; $('conn').classList.add('down'); });

  socket.on('state', (v) => {
    const fx = v.fx && v.fx.seq !== lastSeq && lastSeq !== null ? v.fx : null;
    lastSeq = v.fx ? v.fx.seq : lastSeq === null ? 0 : lastSeq;
    view = v;
    // A new question gets the sweeping card, so its tiles drop in after it.
    tileDelayBase = fx && (fx.type === 'question' || fx.type === 'start') ? 1.05 : 0;
    render();
    if (fx) playFx(fx);
  });

  function send(type, params = {}) {
    socket.emit('action', { type, ...params }, (res) => {
      if (res && !res.ok) toast(res.error || 'That did not work.');
    });
  }

  // ------------------------------------------------------------ rendering
  function render() {
    const v = view;
    $('qnum').textContent = `Question ${v.question.number}`;
    $('hard').hidden = !v.question.hard;
    const m = v.round.multiplier;
    $('mult').hidden = m === 1;
    $('mult').textContent = m === 2 ? 'Double points' : m === 3 ? 'Triple points' : '';

    const qt = $('qtext');
    if (qt.textContent !== v.question.text) {
      qt.textContent = v.question.text;
      qt.style.animationDelay = `${tileDelayBase * 0.8}s`;
      qt.classList.remove('swap');
      void qt.offsetWidth;
      qt.classList.add('swap');
    }

    renderBoard();
    renderPot();
    renderStrikes();
    renderTeams();
    $('join').hidden = !v.showQr;
    $('introJoin').hidden = !v.showQr;
    renderIntro();
    renderFinal();
  }

  function renderBoard() {
    const v = view;
    const board = $('board');
    const n = v.answers.length;
    const slots = Math.max(4, n + (n % 2));
    const rows = slots / 2;
    const rebuild = boardQuestionId !== v.question.id || board.children.length !== slots;
    if (rebuild) {
      boardQuestionId = v.question.id;
      board.classList.add('instant');
      board.innerHTML = '';
      board.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
      for (let i = 0; i < slots; i++) {
        const tile = document.createElement('div');
        tile.className = 'tile enter' + (i >= n ? ' blank' : '');
        // Drop in row by row, left column then right.
        const order = (i % rows) * 2 + Math.floor(i / rows);
        tile.style.setProperty('--d', `${tileDelayBase + order * 0.07}s`);
        tile.style.setProperty('--i', order);
        tile.innerHTML = `<div class="inner"><div class="face front">${i < n ? `<span class="num">${i + 1}</span>` : ''}</div><div class="face back"><span class="ans"></span><span class="pts"></span></div></div>`;
        board.appendChild(tile);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => board.classList.remove('instant')));
    }
    v.answers.forEach((a, i) => {
      const tile = board.children[i];
      if (a.revealed) {
        const ans = tile.querySelector('.ans');
        ans.textContent = a.text;
        const len = a.text.length;
        ans.style.fontSize = len > 22 ? 'calc(var(--u) * 2.3)' : len > 15 ? 'calc(var(--u) * 2.7)' : '';
        tile.querySelector('.pts').textContent = a.points;
      }
      tile.classList.toggle('revealed', a.revealed);
      tile.classList.toggle('shown', a.revealed && !a.earned);
    });
  }

  function renderPot() {
    const r = view.round;
    const box = $('potBox');
    const target = r.pot;
    if (target !== shownPot) {
      countTo($('pot'), shownPot, target, 600);
      shownPot = target;
      box.classList.remove('bump');
      void box.offsetWidth;
      box.classList.add('bump');
    }
    let note = '';
    if (r.awardedTo !== null) note = `to ${teamName(r.awardedTo)}`;
    else if (r.steal) note = 'Steal chance';
    else if (r.multiplier > 1) note = `x${r.multiplier} points`;
    $('potNote').textContent = note;
  }

  function renderStrikes() {
    [...$('strikes').children].forEach((slot, i) => slot.classList.toggle('on', i < view.round.strikes));
  }

  function renderTeams() {
    const v = view;
    const wrap = $('teams');
    if (teamCountShown !== v.teamCount) {
      teamCountShown = v.teamCount;
      wrap.innerHTML = '';
      v.teams.forEach((t, i) => {
        const el = document.createElement('div');
        el.className = `team t${i}`;
        el.innerHTML = '<span class="tag" hidden></span><div class="name"></div><div class="wins"></div><div class="score">0</div>';
        wrap.appendChild(el);
        shownScores[i] = t.score;
        el.querySelector('.score').textContent = t.score;
      });
    }
    const r = v.round;
    v.teams.forEach((t, i) => {
      const el = wrap.children[i];
      el.querySelector('.name').textContent = t.name;
      el.querySelector('.wins').textContent = `${t.roundsWon} round${t.roundsWon === 1 ? '' : 's'} won`;
      if (shownScores[i] !== t.score) {
        // Award points count up when the coins land, not before.
        const delay = v.fx && v.fx.type === 'award' && v.fx.team === i && v.fx.seq === lastSeq ? 900 : 0;
        const from = shownScores[i];
        shownScores[i] = t.score;
        setTimeout(() => countTo(el.querySelector('.score'), from, t.score, 900), delay);
      }
      const control = r.control === i && r.awardedTo === null;
      const steal = r.steal && r.control !== null && r.control !== i;
      el.classList.toggle('control', control);
      el.classList.toggle('steal', steal);
      const tag = el.querySelector('.tag');
      tag.hidden = !(control || steal);
      tag.textContent = steal ? 'Steal!' : 'Playing';
    });
  }

  // ------------------------------------------------------------ intro
  function buildIntroTitle() {
    let d = 0.5;
    document.querySelectorAll('.intro-title [data-letters]').forEach((row, r) => {
      row.innerHTML = '';
      let u = 0;
      [...row.dataset.letters].forEach((ch) => {
        const s = document.createElement('span');
        s.className = 'ltr' + (r === 1 && ch === 'U' ? ' u' : '');
        s.textContent = ch;
        s.style.setProperty('--d', `${d}s`);
        if (r === 1 && ch === 'U') { s.style.setProperty('--b', `${d + 0.8 + u * 0.15}s`); u++; }
        d += r === 1 ? 0.11 : 0.06;
        row.appendChild(s);
      });
      d += 0.15;
    });
  }

  function buildIntroTeams() {
    const wrap = $('introTeams');
    wrap.innerHTML = '';
    const n = view.teams.length;
    view.teams.forEach((t, i) => {
      if (i > 0) {
        const vs = document.createElement('span');
        vs.className = 'intro-vs';
        vs.textContent = 'vs';
        vs.style.setProperty('--d', `${2.3 + i * 0.25}s`);
        wrap.appendChild(vs);
      }
      const el = document.createElement('div');
      el.className = `intro-team t${i}`;
      el.textContent = t.name;
      el.style.setProperty('--d', `${2.1 + i * 0.25}s`);
      el.style.setProperty('--from', i === 0 ? '-40vw' : i === n - 1 ? '40vw' : '0');
      wrap.appendChild(el);
    });
  }

  function renderIntro() {
    const box = $('intro');
    const key = view.teams.map((t) => t.name).join('|');
    if (view.intro && !introShown) {
      introShown = true;
      introTeamsKey = key;
      box.classList.remove('leaving');
      buildIntroTitle();
      buildIntroTeams();
      box.hidden = false;
      document.body.classList.add('intro-on');
    } else if (view.intro && key !== introTeamsKey) {
      introTeamsKey = key;
      buildIntroTeams();
    } else if (!view.intro && introShown) {
      introShown = false;
      document.body.classList.remove('intro-on');
      box.classList.add('leaving');
      setTimeout(() => { if (!introShown) box.hidden = true; }, 800);
    }
  }

  // ------------------------------------------------------------ final
  function renderFinal() {
    const box = $('final');
    if (!view.final) { box.hidden = true; box.innerHTML = ''; return; }
    const ranked = [...view.teams].sort((a, b) => b.score - a.score);
    const top = ranked[0].score;
    const winners = ranked.filter((t) => t.score === top);
    const headline = winners.length > 1 ? "It's a tie!" : `${winners[0].name} win!`;
    let confetti = '';
    if (box.hidden) {
      const colors = ['var(--pink)', 'var(--cyan)', 'var(--gold)', 'var(--violet)', 'var(--team-0)', 'var(--team-2)', '#fff'];
      for (let i = 0; i < 90; i++) {
        confetti += `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-duration:${3 + Math.random() * 4}s;animation-delay:${-Math.random() * 6}s;transform:scale(${0.6 + Math.random()})"></i>`;
      }
    } else {
      const old = box.querySelector('.confetti');
      confetti = old ? old.innerHTML : '';
    }
    let rank = 0;
    let prevScore = null;
    const rows = ranked.map((t, i) => {
      if (t.score !== prevScore) rank = i + 1;
      prevScore = t.score;
      return `<div class="row t${t.index}${rank === 1 ? ' first' : ''}" style="animation-delay:${0.3 + i * 0.25}s">
        <div class="rank">${rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'}</div>
        <div><div class="rname">${esc(t.name)}</div><div class="rwins">${t.roundsWon} round${t.roundsWon === 1 ? '' : 's'} won</div></div>
        <div class="rscore">${t.score}</div>
      </div>`;
    }).join('');
    box.innerHTML = `<div class="confetti">${confetti}</div><h1>Final scores</h1><div class="winner">${esc(headline)}</div><div class="rows">${rows}</div>`;
    box.hidden = false;
  }

  // ------------------------------------------------------------ effects
  let stealTimer = null;
  function playFx(fx) {
    // A queued "steal chance" banner must never land on top of a newer effect.
    clearTimeout(stealTimer);
    switch (fx.type) {
      case 'reveal': {
        const tile = $('board').children[fx.index];
        const earned = view.answers[fx.index] && view.answers[fx.index].earned;
        if (tile) {
          tile.classList.remove('flash');
          void tile.offsetWidth;
          tile.classList.add('flash');
          if (earned) setTimeout(() => sparks(tile, 22), 380);
        }
        Sfx.play(earned ? 'reveal' : 'shown');
        break;
      }
      case 'strike':
        showX(fx.count);
        Sfx.play('strike');
        if (fx.steal) {
          stealTimer = setTimeout(() => {
            banner('Steal chance!', 'red');
            Sfx.play('steal');
          }, 1300);
        }
        break;
      case 'award': {
        const name = teamName(fx.team);
        coins(fx.team);
        banner(fx.steal ? `${name} steal ${fx.points}!` : `${name} +${fx.points}`, 'gold');
        setTimeout(() => {
          floater(fx.team, `+${fx.points}`);
          const card = $('teams').children[fx.team];
          if (card) { card.classList.remove('won'); void card.offsetWidth; card.classList.add('won'); sparks(card, 26); }
        }, 900);
        Sfx.play('award');
        break;
      }
      case 'score':
        floater(fx.team, fx.delta > 0 ? `+${fx.delta}` : `${fx.delta}`);
        Sfx.play('tick');
        break;
      case 'question':
        questionCard();
        break;
      case 'start':
        // Let the intro zoom away, then deal the first question.
        setTimeout(questionCard, 350);
        break;
      case 'intro':
      case 'newGame':
        Sfx.play('intro');
        break;
      case 'control':
        if (fx.team !== null) { banner(`${teamName(fx.team)} play!`); Sfx.play('tick'); }
        break;
      case 'multiplier':
        banner(fx.value === 3 ? 'Triple points!' : fx.value === 2 ? 'Double points!' : 'Single points', 'gold');
        Sfx.play('award');
        break;
      case 'final':
        Sfx.play('final');
        break;
      case 'undo':
        toast('Undone');
        break;
      default:
        break;
    }
  }

  function questionCard() {
    const el = $('inter');
    $('interNum').textContent = view.question.number;
    $('interHard').hidden = !view.question.hard;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(questionCard.t);
    questionCard.t = setTimeout(() => el.classList.remove('on'), 2000);
    Sfx.play('whoosh');
    if (view.question.hard) setTimeout(() => Sfx.play('steal'), 500);
  }

  function showX(count) {
    const el = $('bigx');
    el.innerHTML = '<span>X</span>'.repeat(Math.max(1, Math.min(3, count)));
    const stage = $('stage');
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
    const flash = $('redflash');
    flash.classList.remove('on');
    void flash.offsetWidth;
    flash.classList.add('on');
    clearTimeout(showX.t);
    showX.t = setTimeout(() => { el.innerHTML = ''; }, 1500);
  }

  function sparks(el, count) {
    const rect = el.getBoundingClientRect();
    const layer = $('fxlayer');
    const colors = ['var(--gold)', 'var(--pink)', 'var(--cyan)', '#fff'];
    for (let i = 0; i < count; i++) {
      const s = document.createElement('i');
      s.className = 'spark';
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * Math.max(rect.width, 120) * 0.6;
      s.style.left = `${rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * 0.6}px`;
      s.style.top = `${rect.top + rect.height / 2}px`;
      s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * dist * 0.7}px`);
      s.style.setProperty('--c', colors[i % colors.length]);
      layer.appendChild(s);
      setTimeout(() => s.remove(), 1000);
    }
  }

  function coins(team) {
    const from = $('potBox').getBoundingClientRect();
    const card = $('teams').children[team];
    if (!card) return;
    const to = card.getBoundingClientRect();
    const layer = $('fxlayer');
    for (let i = 0; i < 12; i++) {
      const c = document.createElement('i');
      c.className = 'coin';
      const x0 = from.left + from.width / 2 + (Math.random() - 0.5) * from.width * 0.4;
      const y0 = from.top + from.height / 2 + (Math.random() - 0.5) * from.height * 0.4;
      c.style.left = `${x0}px`;
      c.style.top = `${y0}px`;
      c.style.transitionDelay = `${i * 0.04}s, ${0.8 + i * 0.04}s`;
      layer.appendChild(c);
      const x1 = to.left + to.width * (0.3 + Math.random() * 0.4);
      const y1 = to.top + to.height / 2;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        c.style.transform = `translate(${x1 - x0}px, ${y1 - y0}px) scale(0.6)`;
        c.style.opacity = '0';
      }));
      setTimeout(() => c.remove(), 1600);
    }
  }

  function banner(text, tone = '') {
    const el = $('banner');
    el.textContent = text;
    el.className = 'banner' + (tone ? ` ${tone}` : '');
    void el.offsetWidth;
    el.classList.add('on');
  }

  function floater(team, text) {
    const card = $('teams').children[team];
    if (!card) return;
    const f = document.createElement('div');
    f.className = 'floater';
    f.textContent = text;
    card.appendChild(f);
    setTimeout(() => f.remove(), 1900);
  }

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 1600);
  }

  function countTo(el, from, to, ms) {
    cancelAnimationFrame(el._raf);
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (to - from) * eased);
      if (p < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function teamName(i) {
    return view && view.teams[i] ? view.teams[i].name : `Team ${i + 1}`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ------------------------------------------------------------ join cards
  async function loadJoin() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      joinUrls = info.urls || [];
      showJoin();
    } catch (_) {
      document.querySelectorAll('[data-join-url]').forEach((b) => { b.textContent = 'Could not load the join code'; });
    }
  }
  function showJoin() {
    const u = joinUrls[joinIdx];
    if (!u) return;
    document.querySelectorAll('[data-qr]').forEach((el) => { el.innerHTML = u.qr; });
    document.querySelectorAll('[data-join-url]').forEach((el) => { el.textContent = u.url.replace(/^http:\/\//, ''); });
    document.querySelectorAll('[data-join-hint]').forEach((el) => {
      el.textContent = joinUrls.length > 1
        ? `Same Wi-Fi as this screen. Click the address for another (${joinIdx + 1} of ${joinUrls.length})`
        : 'Same Wi-Fi as this screen';
    });
  }
  document.querySelectorAll('[data-join-url]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (joinUrls.length < 2) return;
    joinIdx = (joinIdx + 1) % joinUrls.length;
    showJoin();
  }));
  loadJoin();

  // ------------------------------------------------------------ sound + keys
  let userMuted = false;
  function updateSoundBtn() {
    const on = Sfx.enabled;
    $('sound').classList.toggle('on', on);
    $('sound').textContent = on ? 'Sound on (M to mute)' : 'Sound is off. Click to turn on';
  }
  $('sound').addEventListener('click', (e) => {
    e.stopPropagation();
    if (Sfx.enabled) { Sfx.disable(); userMuted = true; } else { Sfx.enable(); userMuted = false; }
    setTimeout(updateSoundBtn, 50);
  });
  document.addEventListener('pointerdown', () => {
    if (!Sfx.enabled && !userMuted) { Sfx.enable(); setTimeout(updateSoundBtn, 50); }
  }, { once: true });

  document.addEventListener('keydown', (e) => {
    if (!view || e.target.closest('input, textarea')) return;
    if (!Sfx.enabled && !userMuted) { Sfx.enable(); setTimeout(updateSoundBtn, 50); }
    const key = e.key.toLowerCase();
    const digit = /^Digit([1-8])$/.exec(e.code);
    if (digit && e.shiftKey) { send('award', { team: Number(digit[1]) - 1 }); return; }
    if (digit && !e.ctrlKey && !e.metaKey) { send('reveal', { index: Number(digit[1]) - 1 }); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); send('undo'); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (key) {
      case 'enter':
        if (view.intro) send('setIntro', { on: false });
        break;
      case 'i': send('setIntro', { on: !view.intro }); break;
      case 'x': send('strike'); break;
      case 'a': send('revealNext'); break;
      case 'arrowright': send('next'); break;
      case 'arrowleft': send('prev'); break;
      case 'u': send('undo'); break;
      case 'q': send('toggleQr'); break;
      case 's': send('setFinal', { on: !view.final }); break;
      case 'f':
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(() => {});
        break;
      case 'm':
        if (Sfx.enabled) { Sfx.disable(); userMuted = true; } else { Sfx.enable(); userMuted = false; }
        setTimeout(updateSoundBtn, 50);
        break;
      case 'h':
      case '?':
        $('help').hidden = !$('help').hidden;
        break;
      case 'escape':
        $('help').hidden = true;
        break;
      default:
        return;
    }
  });
})();

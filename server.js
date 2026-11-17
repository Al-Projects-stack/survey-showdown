// Friends Feuuud: a local-network survey showdown.
// The server holds the one true game state. The big screen and the phone
// remote are thin views that send actions over Socket.IO and redraw on every
// state broadcast.

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

const PORT = Number(process.env.PORT) || 4000;
const ROOT = __dirname;
const QUESTIONS_FILE = path.join(ROOT, 'questions.json');
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_TEAMS = 3;
const MAX_ANSWERS = 8;
const MAX_UNDO = 40;
const DEFAULT_NAMES = ['The Legends', 'The Underdogs', 'The Wildcards'];

// ---------------------------------------------------------------- questions

function makeId() {
  return crypto.randomBytes(4).toString('hex');
}

function normalizeQuestions(raw) {
  if (!Array.isArray(raw)) throw new Error('Questions must be a list.');
  if (raw.length === 0) throw new Error('Add at least one question.');
  const seen = new Set();
  return raw.map((q, i) => {
    const label = `Question ${i + 1}`;
    if (!q || typeof q !== 'object') throw new Error(`${label} is not valid.`);
    const text = String(q.question || '').trim();
    if (!text) throw new Error(`${label} has no text.`);
    const answers = (Array.isArray(q.answers) ? q.answers : [])
      .map((a) => ({
        text: String((a && a.text) || '').trim(),
        points: Math.max(0, Math.min(999, Math.round(Number(a && a.points) || 0))),
      }))
      .filter((a) => a.text);
    if (answers.length < 1) throw new Error(`${label} needs at least one answer.`);
    if (answers.length > MAX_ANSWERS) throw new Error(`${label} has more than ${MAX_ANSWERS} answers.`);
    answers.sort((a, b) => b.points - a.points);
    let id = String(q.id || '').trim().slice(0, 40);
    if (!id || seen.has(id)) id = makeId();
    while (seen.has(id)) id = makeId();
    seen.add(id);
    const out = { id, question: text, answers };
    if (q.hard === true || q.hard === 'true') out.hard = true;
    return out;
  });
}

function readQuestionsFile() {
  const raw = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));
  const list = normalizeQuestions(raw);
  // Write ids back so hand-added questions keep a stable id across restarts.
  const missingIds = raw.some((q, i) => !q.id || q.id !== list[i].id);
  if (missingIds) writeJsonAtomic(QUESTIONS_FILE, list);
  return list;
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

let questions = [];
try {
  questions = readQuestionsFile();
} catch (err) {
  console.error(`\n  Could not read questions.json: ${err.message}\n  Fix the file and start again.\n`);
  process.exit(1);
}
const questionById = () => new Map(questions.map((q) => [q.id, q]));

// ---------------------------------------------------------------- game state

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cleanName(name, i) {
  const s = String(name || '').trim().slice(0, 24);
  return s || DEFAULT_NAMES[i];
}

function freshGame({ count = 2, names = [], shuffleOrder = false } = {}) {
  const order = questions.map((q) => q.id);
  if (shuffleOrder) shuffle(order);
  return {
    teamCount: count === 3 ? 3 : 2,
    teams: [0, 1, 2].map((i) => ({ name: cleanName(names[i], i), score: 0 })),
    order,
    pos: 0,
    rounds: {},
    showQr: true,
    final: false,
    intro: true,
    fx: null,
  };
}

let game = freshGame();
let undoStack = [];
let fxSeq = 0;
let settings = { pin: '' };

function blankRound(q) {
  return {
    revealed: new Array(q.answers.length).fill(0), // 0 hidden, 1 earned (counts to pot), 2 shown only
    strikes: 0,
    multiplier: 1,
    control: null,
    awardedTo: null,
    awardedPoints: 0,
  };
}

// Keep the saved game consistent with questions.json (questions can be edited
// between or during games).
function reconcile() {
  const byId = questionById();
  if (!Array.isArray(game.order)) game.order = [];
  game.order = game.order.filter((id, i, arr) => byId.has(id) && arr.indexOf(id) === i);
  for (const q of questions) if (!game.order.includes(q.id)) game.order.push(q.id);
  game.pos = Math.max(0, Math.min(Number(game.pos) || 0, game.order.length - 1));
  if (!game.rounds || typeof game.rounds !== 'object') game.rounds = {};
  for (const id of Object.keys(game.rounds)) {
    const q = byId.get(id);
    if (!q) { delete game.rounds[id]; continue; }
    const r = game.rounds[id];
    const n = q.answers.length;
    r.revealed = Array.from({ length: n }, (_, i) => Number((r.revealed || [])[i]) || 0);
  }
  game.teamCount = game.teamCount === 3 ? 3 : 2;
  game.intro = !!game.intro;
  if (!Array.isArray(game.teams)) game.teams = [];
  game.teams = [0, 1, 2].map((i) => ({
    name: cleanName(game.teams[i] && game.teams[i].name, i),
    score: Math.round(Number(game.teams[i] && game.teams[i].score) || 0),
  }));
}

function currentQuestion() {
  return questionById().get(game.order[game.pos]);
}

function roundFor(q, create) {
  if (!q) return null;
  if (game.rounds[q.id]) return game.rounds[q.id];
  const r = blankRound(q);
  if (create) game.rounds[q.id] = r;
  return r;
}

function potFor(q, r) {
  const base = q.answers.reduce((sum, a, i) => sum + (r.revealed[i] === 1 ? a.points : 0), 0);
  return base * (r.multiplier || 1);
}

// ---------------------------------------------------------------- persistence

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      writeJsonAtomic(STATE_FILE, { game, undoStack, fxSeq, settings });
    } catch (err) {
      console.error('Could not save game state:', err.message);
    }
  }, 150);
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (saved && saved.game) game = saved.game;
    if (Array.isArray(saved.undoStack)) undoStack = saved.undoStack.slice(-MAX_UNDO);
    fxSeq = Number(saved.fxSeq) || 0;
    if (saved.settings) settings = { pin: String(saved.settings.pin || '') };
    console.log('  Restored the saved game from data/state.json');
  } catch (err) {
    console.error('  Saved game could not be read, starting fresh:', err.message);
    game = freshGame();
  }
}
loadState();
if (process.env.PIN) settings.pin = String(process.env.PIN);
reconcile();

// ---------------------------------------------------------------- actions

function teamIndex(t) {
  const i = Number(t);
  if (!Number.isInteger(i) || i < 0 || i >= game.teamCount) throw new Error('Unknown team.');
  return i;
}

const ACTIONS = {
  reveal({ index }) {
    const q = currentQuestion();
    const i = Number(index);
    if (!q || !Number.isInteger(i) || i < 0 || i >= q.answers.length) throw new Error('Unknown answer.');
    const r = roundFor(q, true);
    if (r.revealed[i]) return null;
    r.revealed[i] = r.awardedTo === null ? 1 : 2;
    return { type: 'reveal', index: i };
  },
  hide({ index }) {
    const q = currentQuestion();
    const r = roundFor(q, true);
    const i = Number(index);
    if (!r.revealed[i]) return null;
    r.revealed[i] = 0;
    return { type: 'hide', index: i };
  },
  revealAll() {
    const q = currentQuestion();
    const r = roundFor(q, true);
    const hidden = r.revealed.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (!hidden.length) return null;
    for (const i of hidden) r.revealed[i] = 2;
    return { type: 'revealAll', indexes: hidden };
  },
  strike() {
    const r = roundFor(currentQuestion(), true);
    if (r.strikes < 3) {
      r.strikes += 1;
      return { type: 'strike', count: r.strikes, steal: r.strikes === 3 && r.awardedTo === null };
    }
    // Already on three: a failed steal attempt still gets its X on screen.
    return { type: 'strike', count: 1, extra: true };
  },
  clearStrikes() {
    const r = roundFor(currentQuestion(), true);
    if (!r.strikes) return null;
    r.strikes = 0;
    return { type: 'sync' };
  },
  setControl({ team }) {
    const r = roundFor(currentQuestion(), true);
    r.control = team === null || team === undefined ? null : teamIndex(team);
    return { type: 'control', team: r.control };
  },
  setMultiplier({ value }) {
    const m = Number(value);
    if (![1, 2, 3].includes(m)) throw new Error('Multiplier must be 1, 2 or 3.');
    const r = roundFor(currentQuestion(), true);
    if (r.awardedTo !== null) throw new Error('This round is already awarded. Undo first to change it.');
    r.multiplier = m;
    return { type: 'multiplier', value: m };
  },
  award({ team }) {
    const q = currentQuestion();
    const r = roundFor(q, true);
    const t = teamIndex(team);
    if (r.awardedTo !== null) throw new Error('This round is already awarded. Undo first to change it.');
    const pts = potFor(q, r);
    r.awardedTo = t;
    r.awardedPoints = pts;
    game.teams[t].score += pts;
    return { type: 'award', team: t, points: pts, steal: r.strikes >= 3 && r.control !== null && r.control !== t };
  },
  resetRound() {
    const q = currentQuestion();
    const r = game.rounds[q.id];
    if (!r) return null;
    if (r.awardedTo !== null && r.awardedTo < game.teams.length) game.teams[r.awardedTo].score -= r.awardedPoints;
    delete game.rounds[q.id];
    return { type: 'question' };
  },
  next() {
    if (game.pos >= game.order.length - 1) throw new Error('That was the last question.');
    game.pos += 1;
    game.final = false;
    game.intro = false;
    return { type: 'question' };
  },
  prev() {
    if (game.pos <= 0) throw new Error('Already on the first question.');
    game.pos -= 1;
    game.final = false;
    game.intro = false;
    return { type: 'question' };
  },
  goto({ pos }) {
    const p = Number(pos);
    if (!Number.isInteger(p) || p < 0 || p >= game.order.length) throw new Error('Unknown question.');
    if (p === game.pos) return null;
    game.pos = p;
    game.final = false;
    game.intro = false;
    return { type: 'question' };
  },
  adjustScore({ team, delta }) {
    const t = teamIndex(team);
    const d = Math.round(Number(delta));
    if (!Number.isFinite(d) || d === 0 || Math.abs(d) > 1000) throw new Error('Bad score change.');
    game.teams[t].score += d;
    return { type: 'score', team: t, delta: d };
  },
  setTeams({ count, names }) {
    const c = Number(count) === 3 ? 3 : 2;
    const list = Array.isArray(names) ? names : [];
    game.teams = game.teams.map((tm, i) => ({ ...tm, name: cleanName(list[i] !== undefined ? list[i] : tm.name, i) }));
    game.teamCount = c;
    // A third team that is switched off cannot keep a round's control flag.
    for (const r of Object.values(game.rounds)) if (r.control !== null && r.control >= c) r.control = null;
    return { type: 'teams' };
  },
  newGame({ count, names, shuffle: shuffleOrder }) {
    const list = Array.isArray(names) ? names : game.teams.map((t) => t.name);
    game = freshGame({ count: Number(count) === 3 ? 3 : 2, names: list, shuffleOrder: !!shuffleOrder });
    return { type: 'newGame' };
  },
  toggleQr({ on }) {
    game.showQr = on === undefined ? !game.showQr : !!on;
    return { type: 'sync' };
  },
  setFinal({ on }) {
    game.final = !!on;
    if (game.final) game.intro = false;
    return { type: game.final ? 'final' : 'sync' };
  },
  setIntro({ on }) {
    const next = !!on;
    if (next === game.intro) return null;
    game.intro = next;
    if (next) game.final = false;
    return { type: next ? 'intro' : 'start' };
  },
};

function applyAction(msg) {
  const { type, ...params } = msg || {};
  if (type === 'undo') {
    if (!undoStack.length) throw new Error('Nothing to undo.');
    game = JSON.parse(undoStack.pop());
    reconcile();
    game.fx = { type: 'undo', seq: ++fxSeq };
    return;
  }
  const handler = Object.prototype.hasOwnProperty.call(ACTIONS, type) ? ACTIONS[type] : null;
  if (!handler) throw new Error('Unknown action.');
  const before = JSON.stringify(game);
  const fx = handler(params);
  const changed = JSON.stringify(game) !== before;
  if (!changed && !fx) return;
  if (changed) {
    undoStack.push(before);
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }
  game.fx = { ...(fx || { type: 'sync' }), seq: ++fxSeq };
}

// ---------------------------------------------------------------- views

function buildView(full) {
  const q = currentQuestion();
  const r = roundFor(q, false);
  const byId = questionById();
  const teams = game.teams.slice(0, game.teamCount).map((t, i) => ({ ...t, index: i, roundsWon: 0 }));
  const history = [];
  game.order.forEach((id, pos) => {
    const rr = game.rounds[id];
    if (!rr || rr.awardedTo === null || rr.awardedTo === undefined) return;
    if (teams[rr.awardedTo]) teams[rr.awardedTo].roundsWon += 1;
    history.push({ number: pos + 1, question: byId.get(id).question, team: rr.awardedTo, points: rr.awardedPoints, multiplier: rr.multiplier });
  });

  const view = {
    teams,
    teamCount: game.teamCount,
    // The total question count is for the host only: the audience must not
    // know how many rounds are left.
    question: { id: q.id, text: q.question, number: game.pos + 1, total: full ? game.order.length : null, answerCount: q.answers.length, hard: !!q.hard },
    answers: q.answers.map((a, i) => {
      const shown = r.revealed[i] > 0;
      return {
        n: i + 1,
        revealed: shown,
        earned: r.revealed[i] === 1,
        text: full || shown ? a.text : null,
        points: full || shown ? a.points : null,
      };
    }),
    round: {
      strikes: r.strikes,
      multiplier: r.multiplier,
      control: r.control,
      awardedTo: r.awardedTo,
      awardedPoints: r.awardedPoints,
      pot: r.awardedTo === null ? potFor(q, r) : r.awardedPoints,
      steal: r.strikes >= 3 && r.awardedTo === null,
      allRevealed: r.revealed.every((v) => v > 0),
    },
    history,
    showQr: game.showQr,
    final: game.final,
    intro: game.intro,
    fx: game.fx,
    canUndo: undoStack.length > 0,
    pinSet: !!settings.pin,
    authorized: full,
  };
  if (full) {
    view.questionList = game.order.map((id, pos) => {
      const rr = game.rounds[id];
      const qq = byId.get(id);
      return { pos, text: qq.question, hard: !!qq.hard, awarded: !!(rr && rr.awardedTo !== null), touched: !!rr };
    });
  }
  return view;
}

// ---------------------------------------------------------------- network helpers

function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (/wi-?fi|wlan|wireless/i.test(name)) score += 50;
      if (/^(eth|en)|ethernet/i.test(name)) score += 20;
      if (/vmware|virtual|vbox|vethernet|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|tap|tun/i.test(name)) score -= 100;
      if (a.address.startsWith('192.168.56.')) score -= 60; // VirtualBox host-only default
      if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) score += 10;
      out.push({ name, address: a.address, score });
    }
  }
  out.sort((a, b) => b.score - a.score);
  if (process.env.HOST_IP) out.unshift({ name: 'HOST_IP', address: process.env.HOST_IP, score: 999 });
  return out;
}

function ownAddresses() {
  const set = new Set(['127.0.0.1', '::1']);
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs || []) set.add(a.address);
  return set;
}

// The laptop running the server is trusted (keyboard shortcuts, editor) unless
// LOCAL_TRUST=off, which makes it enter the PIN like any phone.
const TRUST_LOCAL = String(process.env.LOCAL_TRUST || '').toLowerCase() !== 'off';

function isLocalAddress(addr) {
  if (!TRUST_LOCAL) return false;
  const a = String(addr || '').replace(/^::ffff:/, '');
  return ownAddresses().has(a);
}

function pinMatches(pin) {
  if (!settings.pin) return true;
  const a = Buffer.from(String(pin || ''));
  const b = Buffer.from(settings.pin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- http

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
// Fonts ship with npm so the game looks right with no internet.
app.use('/fonts/bungee', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'bungee')));
app.use('/fonts/outfit', express.static(path.join(ROOT, 'node_modules', '@fontsource', 'outfit')));

app.get('/remote', (req, res) => res.sendFile(path.join(ROOT, 'public', 'remote.html')));
app.get('/editor', (req, res) => res.sendFile(path.join(ROOT, 'public', 'editor.html')));

app.get('/api/info', async (req, res) => {
  try {
    const addrs = lanAddresses();
    const urls = addrs.map((a) => ({ name: a.name, url: `http://${a.address}:${PORT}/remote` }));
    if (!urls.length) urls.push({ name: 'This computer', url: `http://localhost:${PORT}/remote` });
    const withQr = await Promise.all(
      urls.map(async (u) => ({
        ...u,
        qr: await QRCode.toString(u.url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#140d2b', light: '#ffffff' } }),
      }))
    );
    res.json({ port: PORT, urls: withQr });
  } catch (err) {
    res.status(500).json({ error: 'Could not build the join code.' });
  }
});

function requireControl(req, res, next) {
  if (!settings.pin || isLocalAddress(req.socket.remoteAddress) || pinMatches(req.get('x-pin'))) return next();
  res.status(401).json({ error: 'Enter the host PIN to edit questions.' });
}

app.get('/api/questions', requireControl, (req, res) => res.json(questions));

app.put('/api/questions', requireControl, (req, res) => {
  let list;
  try {
    list = normalizeQuestions(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    writeJsonAtomic(QUESTIONS_FILE, list);
  } catch (err) {
    return res.status(500).json({ error: 'Could not write questions.json.' });
  }
  questions = list;
  reconcile();
  game.fx = { type: 'sync', seq: ++fxSeq };
  persist();
  broadcast();
  res.json({ ok: true, count: questions.length, questions });
});

// ---------------------------------------------------------------- sockets

const server = http.createServer(app);
const io = new Server(server);

function isAuthorized(socket) {
  return !settings.pin || socket.data.local || socket.data.authed;
}

function sendState(socket) {
  const full = socket.data.role !== 'display' && isAuthorized(socket);
  socket.emit('state', buildView(full));
}

function broadcast() {
  for (const socket of io.sockets.sockets.values()) sendState(socket);
}

io.on('connection', (socket) => {
  const role = String(socket.handshake.query.role || 'remote');
  socket.data.role = role === 'display' ? 'display' : 'remote';
  socket.data.local = isLocalAddress(socket.handshake.address);
  socket.data.authed = false;
  sendState(socket);

  socket.on('auth', (pin, cb) => {
    const ok = !!settings.pin && pinMatches(pin);
    if (ok) socket.data.authed = true;
    if (typeof cb === 'function') cb({ ok: ok || !settings.pin });
    sendState(socket);
  });

  socket.on('setPin', (pin, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    if (!isAuthorized(socket)) return reply({ ok: false, error: 'Locked.' });
    const p = String(pin || '').trim();
    if (p && !/^\d{4,8}$/.test(p)) return reply({ ok: false, error: 'Use 4 to 8 digits.' });
    settings.pin = p;
    socket.data.authed = !!p;
    // Everyone else has to enter the new PIN again.
    for (const s of io.sockets.sockets.values()) if (s !== socket) s.data.authed = false;
    persist();
    broadcast();
    reply({ ok: true });
  });

  socket.on('action', (msg, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    if (!isAuthorized(socket)) return reply({ ok: false, error: 'This remote is locked. Enter the host PIN.' });
    try {
      applyAction(msg);
    } catch (err) {
      return reply({ ok: false, error: err.message });
    }
    persist();
    broadcast();
    reply({ ok: true });
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Is Friends Feuuud already running in another window?\n  Close it, or start on another port:  set PORT=4100 && npm start  (PowerShell: $env:PORT=4100; npm start)\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  const best = addrs[0] ? addrs[0].address : 'localhost';
  console.log('\n  FRIENDS FEUUUD survey showdown is running\n');
  console.log(`  Big screen (this laptop):  http://localhost:${PORT}/`);
  console.log(`  Phone remote:              http://${best}:${PORT}/remote`);
  console.log(`  Question editor:           http://localhost:${PORT}/editor`);
  if (addrs.length > 1) {
    console.log('\n  Other addresses on this machine (try these if the phone cannot connect):');
    for (const a of addrs.slice(1)) console.log(`    http://${a.address}:${PORT}/remote   (${a.name})`);
  }
  if (settings.pin) console.log('\n  The remote is locked with a PIN.');
  console.log(`\n  ${questions.length} questions loaded. Press Ctrl+C to stop.\n`);
});

process.on('SIGINT', () => {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    writeJsonAtomic(STATE_FILE, { game, undoStack, fxSeq, settings });
  } catch (_) { /* best effort */ }
  process.exit(0);
});

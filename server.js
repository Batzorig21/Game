const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// --- Card utilities ---
function makeDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ rank: r, suit: s });
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function rankValue(r) {
  return ['2','3','4','5','6','7','8','9','10','J','Q','K','A'].indexOf(r);
}

// --- Hand evaluation ---
function evaluateHand(cards) {
  // cards: array of {rank, suit}, pick best 5 from 7
  const all = cards.slice();
  let best = null;
  const combos = combinations(all, 5);
  for (const combo of combos) {
    const score = scoreHand(combo);
    if (!best || score[0] > best[0] || (score[0] === best[0] && compareArrays(score, best) > 0)) {
      best = score;
    }
  }
  return best;
}
function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first, ...c]),
    ...combinations(rest, k)
  ];
}
function compareArrays(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}
function scoreHand(cards) {
  const ranks = cards.map(c => rankValue(c.rank)).sort((a,b) => b-a);
  const suits = cards.map(c => c.suit);
  const flush = suits.every(s => s === suits[0]);
  const straight = ranks.every((r,i) => i === 0 || ranks[i-1] - r === 1) ||
    (ranks[0]===12 && ranks[1]===3 && ranks[2]===2 && ranks[3]===1 && ranks[4]===0);
  const counts = {};
  ranks.forEach(r => counts[r] = (counts[r]||0)+1);
  const groups = Object.entries(counts).sort((a,b) => b[1]-a[1] || b[0]-a[0]);
  const groupCounts = groups.map(g => +g[1]);
  const groupRanks = groups.map(g => +g[0]);

  if (flush && straight && ranks[0]===12 && ranks[1]===11) return [9,...groupRanks];
  if (flush && straight) return [8,...groupRanks];
  if (groupCounts[0]===4) return [7,...groupRanks];
  if (groupCounts[0]===3 && groupCounts[1]===2) return [6,...groupRanks];
  if (flush) return [5,...groupRanks];
  if (straight) return [4,...groupRanks];
  if (groupCounts[0]===3) return [3,...groupRanks];
  if (groupCounts[0]===2 && groupCounts[1]===2) return [2,...groupRanks];
  if (groupCounts[0]===2) return [1,...groupRanks];
  return [0,...groupRanks];
}
const HAND_NAMES = ['High Card','One Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

function findWinner(players, community) {
  let best = null, winners = [];
  for (const p of players) {
    if (p.folded) continue;
    const score = evaluateHand([...p.hand, ...community]);
    if (!best || compareArrays(score, best) > 0) { best = score; winners = [p]; }
    else if (compareArrays(score, best) === 0) winners.push(p);
  }
  return { winners, handName: HAND_NAMES[best[0]] };
}

// --- Game logic ---
function startRound(room) {
  room.deck = shuffle(makeDeck());
  room.community = [];
  room.pot = 0;
  room.stage = 'preflop'; // preflop, flop, turn, river, showdown
  room.currentBet = room.bigBlind;
  room.lastRaiser = null;

  const activePlayers = room.players.filter(p => p.chips > 0);
  activePlayers.forEach(p => { p.hand = [room.deck.pop(), room.deck.pop()]; p.bet = 0; p.folded = false; p.allIn = false; });

  // Rotate dealer
  room.dealerIdx = (room.dealerIdx + 1) % activePlayers.length;
  const sbIdx = (room.dealerIdx + 1) % activePlayers.length;
  const bbIdx = (room.dealerIdx + 2) % activePlayers.length;

  // Post blinds
  postBet(activePlayers[sbIdx], room.smallBlind, room);
  postBet(activePlayers[bbIdx], room.bigBlind, room);
  room.lastRaiser = activePlayers[bbIdx].id;

  room.actionIdx = (bbIdx + 1) % activePlayers.length;
  room.actionsThisRound = 0;

  broadcastState(room);
}

function postBet(player, amount, room) {
  const actual = Math.min(amount, player.chips);
  player.chips -= actual;
  player.bet += actual;
  room.pot += actual;
  if (player.chips === 0) player.allIn = true;
}

function nextAction(room) {
  const active = room.players.filter(p => !p.folded && !p.allIn);
  if (active.length <= 1) { endStage(room); return; }

  // Check if betting round is over
  const maxBet = Math.max(...room.players.filter(p=>!p.folded).map(p=>p.bet));
  const allCalled = active.every(p => p.bet === maxBet);
  if (allCalled && room.actionsThisRound >= active.length) { endStage(room); return; }

  room.actionIdx = (room.actionIdx + 1) % room.players.length;
  // Skip folded/allIn
  let tries = 0;
  while ((room.players[room.actionIdx].folded || room.players[room.actionIdx].allIn) && tries < room.players.length) {
    room.actionIdx = (room.actionIdx + 1) % room.players.length;
    tries++;
  }
  broadcastState(room);
}

function endStage(room) {
  room.players.forEach(p => { room.pot += 0; p.bet = 0; });
  room.currentBet = 0;
  room.actionsThisRound = 0;

  const activePlayers = room.players.filter(p => !p.folded);
  if (activePlayers.length === 1) {
    activePlayers[0].chips += room.pot;
    io.to(room.id).emit('roundEnd', { winners: [activePlayers[0].name], pot: room.pot, handName: 'Last Standing' });
    room.pot = 0;
    setTimeout(() => startRound(room), 3000);
    return;
  }

  if (room.stage === 'preflop') {
    room.stage = 'flop';
    room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
  } else if (room.stage === 'flop') {
    room.stage = 'turn';
    room.community.push(room.deck.pop());
  } else if (room.stage === 'turn') {
    room.stage = 'river';
    room.community.push(room.deck.pop());
  } else if (room.stage === 'river') {
    // Showdown
    const { winners, handName } = findWinner(room.players, room.community);
    const share = Math.floor(room.pot / winners.length);
    winners.forEach(w => { const p = room.players.find(x=>x.id===w.id); if(p) p.chips += share; });
    io.to(room.id).emit('roundEnd', {
      winners: winners.map(w=>w.name),
      pot: room.pot,
      handName,
      hands: room.players.filter(p=>!p.folded).map(p=>({ name:p.name, hand:p.hand }))
    });
    room.pot = 0;
    setTimeout(() => startRound(room), 4000);
    return;
  }

  // Reset bets for new stage
  room.players.forEach(p => p.bet = 0);
  room.currentBet = 0;
  room.actionIdx = (room.dealerIdx + 1) % room.players.length;
  while (room.players[room.actionIdx].folded || room.players[room.actionIdx].allIn) {
    room.actionIdx = (room.actionIdx + 1) % room.players.length;
  }
  broadcastState(room);
}

function broadcastState(room) {
  const currentPlayer = room.players[room.actionIdx];
  room.players.forEach((player, idx) => {
    const state = {
      roomId: room.id,
      stage: room.stage,
      community: room.community,
      pot: room.pot,
      currentBet: room.currentBet,
      currentPlayerId: currentPlayer ? currentPlayer.id : null,
      isYourTurn: currentPlayer && currentPlayer.id === player.id,
      yourHand: player.hand,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        isDealer: room.players.indexOf(p) === room.dealerIdx,
        cardCount: p.hand ? p.hand.length : 0,
      })),
    };
    io.to(player.id).emit('gameState', state);
  });
}

// --- Socket events ---
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).slice(2,7).toUpperCase();
    rooms[roomId] = {
      id: roomId,
      players: [],
      community: [],
      pot: 0,
      deck: [],
      stage: 'waiting',
      dealerIdx: -1,
      actionIdx: 0,
      currentBet: 0,
      actionsThisRound: 0,
      smallBlind: 10,
      bigBlind: 20,
    };
    socket.join(roomId);
    const player = { id: socket.id, name, chips: 1000, hand: [], bet: 0, folded: false, allIn: false };
    rooms[roomId].players.push(player);
    socket.roomId = roomId;
    socket.emit('roomCreated', { roomId });
    io.to(roomId).emit('lobbyUpdate', { players: rooms[roomId].players.map(p=>({ id:p.id, name:p.name, chips:p.chips })) });
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) { socket.emit('error', 'Өрөө олдсонгүй'); return; }
    if (room.stage !== 'waiting') { socket.emit('error', 'Тоглоом аль хэдийн эхэлсэн'); return; }
    if (room.players.length >= 6) { socket.emit('error', 'Өрөө дүүрэн байна'); return; }
    socket.join(roomId);
    const player = { id: socket.id, name, chips: 1000, hand: [], bet: 0, folded: false, allIn: false };
    room.players.push(player);
    socket.roomId = roomId;
    socket.emit('roomJoined', { roomId });
    io.to(roomId).emit('lobbyUpdate', { players: room.players.map(p=>({ id:p.id, name:p.name, chips:p.chips })) });
  });

  socket.on('startGame', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    if (room.players.length < 2) { socket.emit('error', 'Хамгийн багадаа 2 тоглогч хэрэгтэй'); return; }
    room.stage = 'preflop';
    startRound(room);
  });

  socket.on('action', ({ type, amount }) => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || room.players[room.actionIdx].id !== socket.id) return;

    if (type === 'fold') {
      player.folded = true;
    } else if (type === 'call') {
      const toCall = room.currentBet - player.bet;
      postBet(player, toCall, room);
    } else if (type === 'check') {
      // nothing
    } else if (type === 'raise') {
      const toCall = room.currentBet - player.bet;
      postBet(player, toCall + amount, room);
      room.currentBet = player.bet;
      room.lastRaiser = player.id;
      room.actionsThisRound = 0;
    } else if (type === 'allIn') {
      postBet(player, player.chips, room);
      if (player.bet > room.currentBet) room.currentBet = player.bet;
      player.allIn = true;
    }

    room.actionsThisRound++;
    nextAction(room);
  });

  socket.on('disconnect', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    if (room.players.length === 0) { delete rooms[socket.roomId]; return; }
    io.to(room.id).emit('playerLeft', { name: socket.name });
    if (room.stage !== 'waiting') broadcastState(room);
    else io.to(room.id).emit('lobbyUpdate', { players: room.players.map(p=>({ id:p.id, name:p.name, chips:p.chips })) });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`Poker server running on http://localhost:${PORT}`));

import express from 'express';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from 'socket.io';
import { Table } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const DISCONNECT_GRACE_MS = 60_000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const httpServer = createServer(app);
const io = new Server(httpServer);

/** @type {Map<string, Table>} */
const tables = new Map();
/** socket.id -> { tableId, playerId } */
const sessions = new Map();
/** playerId -> timeout usuwający gracza po utracie połączenia */
const dropTimers = new Map();

function getTable(id) {
  const key = (id || 'stol1').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20) || 'stol1';
  if (!tables.has(key)) tables.set(key, new Table(key));
  return tables.get(key);
}

function broadcast(table) {
  for (const [socketId, sess] of sessions) {
    if (sess.tableId !== table.id) continue;
    io.to(socketId).emit('state', table.stateFor(sess.playerId));
  }
}

io.on('connection', (socket) => {
  socket.on('join', ({ tableId, name, playerId }, cb = () => {}) => {
    const cleanName = String(name || '').trim().slice(0, 16);
    if (!cleanName) return cb({ error: 'Podaj nazwę gracza.' });

    const table = getTable(tableId);

    // Powrót do gry po rozłączeniu / odświeżeniu strony.
    const existing = playerId && table.players.find((p) => p.id === playerId);
    if (existing) {
      clearTimeout(dropTimers.get(existing.id));
      dropTimers.delete(existing.id);
      existing.connected = true;
      existing.name = cleanName;
      sessions.set(socket.id, { tableId: table.id, playerId: existing.id });
      socket.join(table.id);
      cb({ ok: true, playerId: existing.id, tableId: table.id });
      table.pushLog(`${existing.name} wraca do gry.`);
      broadcast(table);
      return;
    }

    const id = randomUUID();
    const res = table.addPlayer(id, cleanName);
    if (res.error) return cb(res);

    sessions.set(socket.id, { tableId: table.id, playerId: id });
    socket.join(table.id);
    cb({ ok: true, playerId: id, tableId: table.id });
    broadcast(table);
  });

  socket.on('ready', (ready, cb = () => {}) => {
    const sess = sessions.get(socket.id);
    if (!sess) return cb({ error: 'Nie jesteś przy stole.' });
    const table = tables.get(sess.tableId);
    table.setReady(sess.playerId, !!ready);
    if (table.canStart()) table.startHand();
    broadcast(table);
    cb({ ok: true });
  });

  socket.on('action', ({ action, amount }, cb = () => {}) => {
    const sess = sessions.get(socket.id);
    if (!sess) return cb({ error: 'Nie jesteś przy stole.' });
    const table = tables.get(sess.tableId);
    const res = table.act(sess.playerId, action, amount);
    broadcast(table);
    cb(res);
  });

  socket.on('chat', (text) => {
    const sess = sessions.get(socket.id);
    if (!sess) return;
    const table = tables.get(sess.tableId);
    const p = table.players.find((x) => x.id === sess.playerId);
    const msg = String(text || '').trim().slice(0, 140);
    if (!p || !msg) return;
    table.pushLog(`💬 ${p.name}: ${msg}`);
    broadcast(table);
  });

  socket.on('leave', () => dropSocket(socket.id, true));
  socket.on('disconnect', () => dropSocket(socket.id, false));
});

function dropSocket(socketId, immediate) {
  const sess = sessions.get(socketId);
  if (!sess) return;
  sessions.delete(socketId);
  const table = tables.get(sess.tableId);
  if (!table) return;

  const player = table.players.find((p) => p.id === sess.playerId);
  if (!player) return;

  if (immediate) {
    table.removePlayer(sess.playerId);
    if (table.players.length === 0) tables.delete(table.id);
    broadcast(table);
    return;
  }

  // Rozłączenie: czekamy chwilę na powrót, dopiero potem zwalniamy miejsce.
  player.connected = false;
  table.pushLog(`${player.name} stracił połączenie.`);
  broadcast(table);

  dropTimers.set(
    player.id,
    setTimeout(() => {
      dropTimers.delete(player.id);
      table.removePlayer(player.id);
      if (table.players.length === 0) tables.delete(table.id);
      else broadcast(table);
    }, DISCONNECT_GRACE_MS),
  );
}

// Zegar tury — po przekroczeniu limitu gramy za gracza (check albo fold).
setInterval(() => {
  for (const table of tables.values()) {
    if (table.stage && table.deadline && Date.now() > table.deadline) {
      if (table.timeoutCurrentPlayer()) broadcast(table);
    }
  }
}, 1000);

httpServer.listen(PORT, () => {
  console.log(`♠ Poker serwer działa na http://localhost:${PORT}`);
});

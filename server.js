const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// 游戏状态
let players = {}; // 存储玩家信息 { socketId: { charId, x, y, id } }
let playerOrder = []; // 玩家行动顺序
let currentTurnIndex = 0; // 当前回合的玩家索引
let gameStarted = false;
let lastDiceResult = null; // 记录骰子结果

// 可选角色列表
const CHARACTERS = [1, 2, 3, 4, 5];

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // 发送当前游戏状态给新连接者
    socket.emit('init', {
        players,
        gameStarted,
        currentTurn: gameStarted ? playerOrder[currentTurnIndex] : null,
        takenChars: Object.values(players).map(p => p.charId)
    });

    // 玩家选择角色加入
    socket.on('selectCharacter', (charId) => {
        if (gameStarted) return;
        // 检查角色是否已被占用
        const isTaken = Object.values(players).some(p => p.charId === charId);
        if (isTaken) return;

        // 初始化玩家位置（假设左下角起点大概位置，之后可拖拽）
        players[socket.id] = {
            id: socket.id,
            charId: charId,
            x: 850, // 初始X坐标 (根据你的图大概估算，可调整)
            y: 850  // 初始Y坐标
        };

        io.emit('updatePlayers', players);
        io.emit('takenChars', Object.values(players).map(p => p.charId));
    });

    // 开始游戏
    socket.on('startGame', () => {
        const playerIds = Object.keys(players);
        if (playerIds.length < 2) return; // 至少2人

        playerOrder = playerIds; // 简单起见，按加入顺序
        currentTurnIndex = 0;
        gameStarted = true;
        lastDiceResult = null;

        io.emit('gameStarted', {
            playerOrder,
            currentTurn: playerOrder[currentTurnIndex]
        });
    });

    // 投掷骰子
    socket.on('rollDice', (diceCount) => {
        if (!gameStarted) return;
        if (socket.id !== playerOrder[currentTurnIndex]) return; // 不是你的回合

        let roll = 0;
        let details = [];
        for (let i = 0; i < diceCount; i++) {
            let r = Math.floor(Math.random() * 6) + 1;
            roll += r;
            details.push(r);
        }

        lastDiceResult = { roll, details, player: socket.id };

        io.emit('diceRolled', lastDiceResult);
    });

    // 结束回合
    socket.on('endTurn', () => {
        if (!gameStarted) return;
        if (socket.id !== playerOrder[currentTurnIndex]) return;

        currentTurnIndex = (currentTurnIndex + 1) % playerOrder.length;
        lastDiceResult = null;

        io.emit('turnChanged', {
            currentTurn: playerOrder[currentTurnIndex]
        });
    });

    // 同步移动（拖拽）
    socket.on('movePlayer', (pos) => {
        if (players[socket.id]) {
            players[socket.id].x = pos.x;
            players[socket.id].y = pos.y;
            socket.broadcast.emit('playerMoved', { id: socket.id, x: pos.x, y: pos.y });
        }
    });

    // 断开连接
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete players[socket.id];

        // 如果游戏中有人退出，简单重置或移除（为演示简单，这里仅移除）
        if (gameStarted) {
            playerOrder = playerOrder.filter(id => id !== socket.id);
            if (playerOrder.length < 2) {
                gameStarted = false; // 人数不足，重置
                io.emit('gameReset');
            }
        }

        io.emit('updatePlayers', players);
        io.emit('takenChars', Object.values(players).map(p => p.charId));
    });
});

http.listen(3000, () => {
    console.log('listening on *:3000');
});
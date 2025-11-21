const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// --- 卡池定义 ---
const CARD_DEFINITIONS = [
    { name: "【所以说武士道就是恶魔之路】", desc: "去武士道", count: 2, color: "#d32f2f" },
    { name: "【罪孽深重的女人】", desc: "所有人一起去武士道", count: 1, color: "#7b1fa2" },
    { name: "【小猫咪】", desc: "选择一位玩家，每句话的结尾都要带上喵。若违反规定，角色不可崩点数+1。如果已经抽到类似卡片，则追加而不是替换。", count: 1, color: "#f06292" },
    { name: "【大小姐】", desc: "选择一位玩家，每句话的结尾都要带上desuwa。若违反规定，角色不可崩点数+1。如果已经抽到类似卡片，则追加而不是替换。", count: 1, color: "#f06292" },
    { name: "【咋瓦鲁多】", desc: "选择一位玩家，跳过此玩家的下一回合", count: 2, color: "#1976d2" },
    { name: "【好强的压】", desc: "选择一位玩家，摧毁此玩家拥有的其中一个【巡演地】，需重新挑战获取。若有多个，由抽卡者挑选。", count: 1, color: "#388e3c" },
    { name: "【以牙还牙】", desc: "反弹最近一次被施加的【小猫咪】【大小姐】【咋瓦鲁多】【好强的压】效果。如果是负面状态卡，解除自身效果。", count: 1, color: "#fbc02d" },
    { name: "【角色不可崩点数减少5点】", desc: "恭喜！你的角色不可崩点数 -5", count: 2, color: "#0097a7" },
    { name: "【千载一遇】", desc: "传送到离没有成功的【Live挑战】一格距离并结束回合。若全部完成，则去【顶点】旁一格。", count: 1, color: "#e64a19" }
];

const rooms = {};

// 洗牌算法
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 初始化牌堆
function initDeck() {
    let deck = [];
    CARD_DEFINITIONS.forEach(card => {
        for(let i=0; i<card.count; i++) {
            deck.push({ 
                name: card.name, 
                desc: card.desc, 
                color: card.color 
            });
        }
    });
    return shuffle(deck);
}

io.on('connection', (socket) => {
    // 房间管理逻辑
    socket.on('createRoom', ({ roomId, password }) => {
        if (rooms[roomId]) return socket.emit('err', '房间名已存在');
        rooms[roomId] = {
            password: password,
            players: {}, 
            playerOrder: [],
            currentTurnIndex: 0,
            gameStarted: false,
            deck: initDeck(),      // 初始化牌堆
            discardPile: []        // 弃牌堆
        };
        joinRoomLogic(socket, roomId);
    });

    socket.on('joinRoom', ({ roomId, password }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('err', '房间不存在');
        if (room.password !== password) return socket.emit('err', '密码错误');
        joinRoomLogic(socket, roomId);
    });

    function joinRoomLogic(socket, roomId) {
        socket.join(roomId);
        socket.data.roomId = roomId;
        const room = rooms[roomId];
        
        socket.emit('roomJoined', {
            roomId: roomId,
            players: room.players,
            gameStarted: room.gameStarted,
            currentTurn: room.gameStarted ? room.playerOrder[room.currentTurnIndex] : null,
            takenChars: Object.values(room.players).map(p => p.charId),
            playerOrder: room.gameStarted ? room.playerOrder : null,
            deckCount: room.deck.length // 告知前端剩余卡片数量
        });
    }

    function getRoom(socket) {
        return socket.data.roomId ? rooms[socket.data.roomId] : null;
    }

    // --- 游戏逻辑 ---

    socket.on('selectCharacter', (charId) => {
        const room = getRoom(socket);
        if (!room || room.gameStarted) return;
        const isTaken = Object.values(room.players).some(p => p.charId === charId);
        if (isTaken) return;
        room.players[socket.id] = { id: socket.id, charId: charId, x: 850, y: 850, score: 0 };
        io.to(socket.data.roomId).emit('updatePlayers', room.players);
        io.to(socket.data.roomId).emit('takenChars', Object.values(room.players).map(p => p.charId));
    });

    socket.on('startGame', () => {
        const room = getRoom(socket);
        if (!room) return;
        const playerIds = Object.keys(room.players);
        if (playerIds.length < 2) return;

        room.playerOrder = shuffle([...playerIds]);
        room.currentTurnIndex = 0;
        room.gameStarted = true;
        room.deck = initDeck(); // 重新洗牌
        room.discardPile = [];

        io.to(socket.data.roomId).emit('gameStarted', {
            playerOrder: room.playerOrder,
            currentTurn: room.playerOrder[room.currentTurnIndex]
        });
        io.to(socket.data.roomId).emit('log', { text: "游戏开始！牌堆已洗好。" });
    });

    socket.on('rollDice', (diceCount) => {
        const room = getRoom(socket);
        if (!room || !room.gameStarted) return;
        if (socket.id !== room.playerOrder[room.currentTurnIndex]) return;

        let roll = 0;
        let details = [];
        for(let i=0; i<diceCount; i++) {
            let r = Math.floor(Math.random() * 6) + 1;
            roll += r;
            details.push(r);
        }
        
        io.to(socket.data.roomId).emit('diceRolled', { roll, details, player: socket.id });
    });

    // --- 新增：抽卡逻辑 ---
    socket.on('drawCard', () => {
        const room = getRoom(socket);
        if (!room || !room.gameStarted) return;
        if (socket.id !== room.playerOrder[room.currentTurnIndex]) return; // 必须轮到自己

        // 如果牌堆空了，重洗弃牌堆
        if (room.deck.length === 0) {
            if (room.discardPile.length === 0) {
                // 彻底没牌了（理论上不会，除非都被玩家拿着？）
                room.deck = initDeck();
            } else {
                room.deck = shuffle([...room.discardPile]);
                room.discardPile = [];
            }
        }

        const card = room.deck.pop();
        room.discardPile.push(card); // 暂且认为抽完就进弃牌堆，或者效果结算完。简化处理。

        io.to(socket.data.roomId).emit('cardResult', {
            player: socket.id,
            card: card,
            remaining: room.deck.length
        });
    });

    socket.on('endTurn', () => {
        const room = getRoom(socket);
        if (!room || !room.gameStarted) return;
        if (socket.id !== room.playerOrder[room.currentTurnIndex]) return;

        room.currentTurnIndex = (room.currentTurnIndex + 1) % room.playerOrder.length;
        io.to(socket.data.roomId).emit('turnChanged', {
            currentTurn: room.playerOrder[room.currentTurnIndex]
        });
    });

    socket.on('movePlayer', (pos) => {
        const room = getRoom(socket);
        if (room && room.players[socket.id]) {
            room.players[socket.id].x = pos.x;
            room.players[socket.id].y = pos.y;
            socket.broadcast.to(socket.data.roomId).emit('playerMoved', { id: socket.id, x: pos.x, y: pos.y });
        }
    });

    socket.on('changeScore', (amount) => {
        const room = getRoom(socket);
        if (room && room.players[socket.id]) {
            const val = parseInt(amount);
            if (!isNaN(val)) {
                room.players[socket.id].score += val;
                io.to(socket.data.roomId).emit('updatePlayers', room.players);
            }
        }
    });

    socket.on('disconnect', () => {
        // ... (与之前相同，省略部分重复代码以节省空间) ...
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
             const room = rooms[roomId];
             if (room.players[socket.id]) {
                delete room.players[socket.id];
                if (room.gameStarted) {
                     // 简单重置逻辑
                     if (Object.keys(room.players).length < 2) {
                         room.gameStarted = false;
                         io.to(roomId).emit('gameReset', '玩家断开，游戏重置');
                     }
                }
                io.to(roomId).emit('updatePlayers', room.players);
                io.to(roomId).emit('takenChars', Object.values(room.players).map(p => p.charId));
             }
             if (io.sockets.adapter.rooms.get(roomId)?.size === 0) delete rooms[roomId];
        }
    });
});

http.listen(3000, () => {
    console.log('listening on *:3000');
});
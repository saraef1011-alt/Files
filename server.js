const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

let db;
try { db = require('./db'); } catch (e) {
  db = {
    getAccount: () => null,
    isValidUsername: n => typeof n === 'string' && n.length >= 2 && n.length <= 20,
    isValidAvatar: () => true,
    usernameTaken: () => false,
    createOrUpdateAccount: (id, data) => ({ accountId:id, username:data.username, avatar:data.avatar || '🐔', gamesPlayed:0, wins:0, losses:0 }),
    recordGameResult: () => null
  };
  console.warn('⚠️ db.js پیدا نشد؛ بخش پروفایل با حالت موقت اجرا می‌شود.');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });
app.use(express.json());
app.use(express.static('.'));

const rooms = {};
const onlinePlayers = {};
const pendingRequests = {};
const quickQueue = new Set();

const CARDS = Object.freeze({
  HEN:'مرغ', ROOSTER:'خروس', NEST:'لانه', FOX:'روباه', TRAP:'تله', SNAKE:'مار'
});

function shuffle(a) {
  a = [...a];
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function createDeck() {
  const d=[];
  for(let i=0;i<21;i++) d.push(CARDS.HEN);
  for(let i=0;i<21;i++) d.push(CARDS.ROOSTER);
  for(let i=0;i<12;i++) d.push(CARDS.NEST);
  for(let i=0;i<7;i++) d.push(CARDS.FOX);
  for(let i=0;i<3;i++) d.push(CARDS.TRAP);
  for(let i=0;i<2;i++) d.push(CARDS.SNAKE);
  return shuffle(d);
}
function playerList(){
  return Object.values(onlinePlayers).map(p=>({id:p.id,name:p.name,status:p.status,socketId:p.socketId,avatar:p.avatar||'🐔'}));
}
function updatePlayerList(){ io.emit('playerListUpdate', playerList()); }
function roomOf(id){
  for(const [roomId,r] of Object.entries(rooms)){
    if(r.players.some(p=>p.id===id)) return {roomId,room:r,role:'player'};
    if((r.watchers||[]).includes(id)) return {roomId,room:r,role:'watcher'};
  }
  return null;
}
function broadcast(roomId){
  if(!rooms[roomId]) return;
  io.to(roomId).emit('gameState', rooms[roomId]);
  io.to(roomId).emit('roomUpdate', rooms[roomId]);
}
function sameRoom(a,b){
  const ra=roomOf(a), rb=roomOf(b);
  return !!ra && !!rb && ra.roomId===rb.roomId;
}
function removeQueue(id){ quickQueue.delete(id); }
function deal(room,p,count=4){
  for(let i=0;i<count && room.deck.length;i++) p.hand.push(room.deck.pop());
}

function createRoom(a,b){
  const roomId=Math.random().toString(36).slice(2,8).toUpperCase();
  rooms[roomId]={
    roomId, host:a.id,
    players:[a,b].map(p=>({id:p.id,name:p.name,hand:[],eggs:0,chicks:0})),
    watchers:[], deck:createDeck(), discardPile:[], eggTokens:18,
    currentTurn:a.id, gameStarted:true, winner:null
  };
  const room=rooms[roomId];
  room.players.forEach(p=>deal(room,p,4));
  io.sockets.sockets.get(a.id)?.join(roomId);
  io.sockets.sockets.get(b.id)?.join(roomId);
  a.status=b.status='playing';
  updatePlayerList();
  io.to(roomId).emit('gameStarted',{roomId});
  broadcast(roomId);
  return roomId;
}
function refill(room,p){
  while(p.hand.length<4 && room.deck.length) p.hand.push(room.deck.pop());
  if(!room.deck.length && room.discardPile.length){
    room.deck=shuffle(room.discardPile); room.discardPile=[];
  }
}
function finishAction(room,p){
  refill(room,p);
  for(const x of room.players) if(x.chicks>=3) room.winner=x.id;
  if(!room.winner){
    const i=room.players.findIndex(x=>x.id===room.currentTurn);
    if(i>=0) room.currentTurn=room.players[(i+1)%room.players.length].id;
  }
  broadcast(room.roomId);
  if(room.winner){
    room.players.forEach(x=>{
      const op=onlinePlayers[x.id];
      if(op?.accountId && db.recordGameResult){
        try { const profile=db.recordGameResult(op.accountId,x.id===room.winner); if(profile) io.to(x.id).emit('profileData',{profile}); } catch(e) {}
      }
    });
  }
}

io.on('connection', socket=>{
  console.log('🔌 اتصال:',socket.id);

  socket.on('registerPlayer', ({playerName,accountId,avatar}={})=>{
    playerName=String(playerName||'بازیکن').trim().slice(0,20);
    const duplicate=Object.values(onlinePlayers).find(p=>p.name===playerName && p.id!==socket.id);
    if(duplicate) return socket.emit('registrationError','این نام کاربری در حال استفاده است.');
    onlinePlayers[socket.id]={id:socket.id,socketId:socket.id,name:playerName,status:'ready',accountId:accountId||null,avatar:avatar||'🐔'};
    socket.emit('registrationSuccess',{id:socket.id,name:playerName});
    updatePlayerList();
  });

  socket.on('getPlayerList',updatePlayerList);

  socket.on('loadProfile',({accountId}={})=>socket.emit('profileData',{profile:db.getAccount(accountId)}));
  socket.on('saveProfile',({accountId,username,avatar}={})=>{
    if(!accountId) return socket.emit('profileError','شناسه حساب نامعتبر است.');
    if(!db.isValidUsername(username)) return socket.emit('profileError','نام کاربری باید بین ۲ تا ۲۰ کاراکتر باشد.');
    if(avatar && !db.isValidAvatar(avatar)) return socket.emit('profileError','آواتار نامعتبر است.');
    if(db.usernameTaken(username,accountId)) return socket.emit('profileError','این نام کاربری قبلاً استفاده شده است.');
    const profile=db.createOrUpdateAccount(accountId,{username,avatar});
    socket.emit('profileData',{profile});
    if(onlinePlayers[socket.id]){onlinePlayers[socket.id].name=profile.username;onlinePlayers[socket.id].avatar=profile.avatar;updatePlayerList();}
  });
  socket.on('getProfile',({targetId}={})=>{
    const t=onlinePlayers[targetId]; if(!t) return socket.emit('profileInfoError','بازیکن پیدا نشد');
    const a=t.accountId?db.getAccount(t.accountId):null;
    socket.emit('profileInfo',{id:t.id,name:t.name,avatar:t.avatar||'🐔',gamesPlayed:a?.gamesPlayed||0,wins:a?.wins||0,losses:a?.losses||0});
  });

  socket.on('requestGame',({targetId}={})=>{
    const me=onlinePlayers[socket.id], target=onlinePlayers[targetId];
    if(!me||!target) return socket.emit('gameRequestError','بازیکن پیدا نشد.');
    if(me.id===target.id) return;
    if(!pendingRequests[targetId]) pendingRequests[targetId]=[];
    pendingRequests[targetId]=pendingRequests[targetId].filter(r=>r.fromId!==socket.id);
    pendingRequests[targetId].push({fromId:socket.id,fromName:me.name,timestamp:Date.now()});
    removeQueue(socket.id); me.status='requesting'; updatePlayerList();
    io.to(targetId).emit('gameRequest',{fromId:socket.id,fromName:me.name});
  });

  socket.on('acceptGame',({fromId}={})=>{
    const me=onlinePlayers[socket.id], from=onlinePlayers[fromId];
    if(!me||!from) return socket.emit('gameError','بازیکن پیدا نشد.');
    pendingRequests[socket.id]=(pendingRequests[socket.id]||[]).filter(r=>r.fromId!==fromId);
    removeQueue(fromId);
    const current=roomOf(socket.id);
    if(current?.role==='player') return socket.emit('busyGameChoice',{fromId,fromName:from.name,roomId:current.roomId,message:`${from.name} می‌خواهد وارد بازی شما شود`});
    me.status='playing';from.status='playing';createRoom(from,me);
    updatePlayerList();
  });

  socket.on('chooseGameOption',({fromId,option}={})=>{
    const me=onlinePlayers[socket.id], from=onlinePlayers[fromId], current=roomOf(socket.id);
    if(!me||!from||!current||current.role!=='player') return socket.emit('gameError','بازی فعالی پیدا نشد.');
    const room=current.room;
    if(option==='join'){
      if(room.players.length >= 3 && !room.players.some(p=>p.id===from.id)) return socket.emit('gameError','این بازی ۳ بازیکن دارد و جا ندارد.');
      if(!room.players.some(p=>p.id===from.id)){
        const old=roomOf(from.id);
        if(old?.role==='watcher') old.room.watchers=old.room.watchers.filter(x=>x!==from.id);
        else if(old) return socket.emit('gameError','این بازیکن در بازی دیگری است.');
        const p={id:from.id,name:from.name,hand:[],eggs:0,chicks:0}; deal(room,p,4); room.players.push(p);
      }
      from.status='playing'; io.sockets.sockets.get(from.id)?.join(current.roomId);
      io.to(from.id).emit('joinExistingGame',{roomId:current.roomId,room,mode:'player'}); broadcast(current.roomId);
    } else if(option==='watch'){
      room.watchers=room.watchers||[]; if(!room.watchers.includes(from.id)) room.watchers.push(from.id);
      from.status='watching'; io.sockets.sockets.get(from.id)?.join(current.roomId);
      io.to(from.id).emit('joinExistingGame',{roomId:current.roomId,room,mode:'watcher'}); broadcast(current.roomId);
    }
    updatePlayerList();
  });

  socket.on('rejectGame',({fromId}={})=>{
    const me=onlinePlayers[socket.id]; const from=onlinePlayers[fromId];
    if(me?.status==='requested') me.status='ready'; if(from?.status==='requesting') from.status='ready';
    if(pendingRequests[socket.id]) pendingRequests[socket.id]=pendingRequests[socket.id].filter(r=>r.fromId!==fromId);
    if(from) io.to(fromId).emit('gameRejected',{byName:me?.name||'بازیکن'}); updatePlayerList();
  });

  socket.on('quickGame',()=>{
    const me=onlinePlayers[socket.id];
    if(!me) return socket.emit('quickGameError','بازیکن پیدا نشد.');
    if(me.status!=='ready') return socket.emit('quickGameError','ابتدا آماده شوید.');
    quickQueue.add(socket.id); me.status='requesting'; socket.emit('quickGameQueued'); updatePlayerList();
    const ids=[...quickQueue].filter(id=>onlinePlayers[id]?.status==='requesting');
    if(ids.length>=2){const a=onlinePlayers[ids[0]],b=onlinePlayers[ids[1]];removeQueue(a.id);removeQueue(b.id);createRoom(a,b);}
    updatePlayerList();
  });

  socket.on('getGameState',({roomId}={})=>{if(rooms[roomId]) socket.emit('gameState',rooms[roomId]);});

  socket.on('gameAction',({roomId,action,data}={})=>{
    const room=rooms[roomId]; if(!room?.gameStarted) return;
    const p=room.players.find(x=>x.id===socket.id); if(!p||room.currentTurn!==socket.id||room.winner) return;
    let done=false;
    if(action==='lay'){
      const hi=p.hand.indexOf(CARDS.HEN),ri=p.hand.indexOf(CARDS.ROOSTER),ni=p.hand.indexOf(CARDS.NEST);
      if(hi>=0&&ri>=0&&ni>=0&&room.eggTokens>0){[hi,ri,ni].sort((a,b)=>b-a).forEach(i=>p.hand.splice(i,1));p.eggs++;room.eggTokens--;done=true;}
    } else if(action==='hatch'){
      if(p.eggs>0&&p.hand.filter(c=>c===CARDS.HEN).length>=2){let n=0;for(let i=p.hand.length-1;i>=0&&n<2;i--)if(p.hand[i]===CARDS.HEN){p.hand.splice(i,1);n++;}p.eggs--;p.chicks++;done=true;}
    } else if(action==='fox'){
      const i=p.hand.indexOf(CARDS.FOX),o=room.players.find(x=>x.id===data?.target && x.id!==p.id) || room.players.find(x=>x.id!==p.id); if(i>=0&&o?.eggs>0){p.hand.splice(i,1);const roosters=o.hand.filter(c=>c===CARDS.ROOSTER).length;if(roosters>=2){let n=0;for(let j=o.hand.length-1;j>=0&&n<2;j--)if(o.hand[j]===CARDS.ROOSTER){o.hand.splice(j,1);n++;}}else{o.eggs--;p.eggs++;}done=true;}
    } else if(action==='snake'){
      const i=p.hand.indexOf(CARDS.SNAKE),o=room.players.find(x=>x.id===data?.target && x.id!==p.id) || room.players.find(x=>x.id!==p.id),count=Math.max(1,Math.min(10,Number(data?.count)||1));
      if(i>=0&&o?.eggs>0){p.hand.splice(i,1);const n=Math.min(o.eggs,count);o.eggs-=n;room.eggTokens+=n;done=true;}
    } else if(action==='trap'){
      const i=p.hand.indexOf(CARDS.TRAP),o=room.players.find(x=>x.id===data?.target && x.id!==p.id) || room.players.find(x=>x.id!==p.id),card=data?.card;
      if(i>=0&&o&&[CARDS.HEN,CARDS.ROOSTER,CARDS.NEST,CARDS.FOX,CARDS.SNAKE].includes(card)){const j=o.hand.indexOf(card);if(j>=0){p.hand.splice(i,1);o.hand.splice(j,1);done=true;}}
    } else if(action==='draw'){
      if(room.deck.length){p.hand.push(room.deck.pop());done=true;}
    } else if(action==='discard'){
      const i=p.hand.indexOf(data?.card);if(i>=0){room.discardPile.push(p.hand.splice(i,1)[0]);done=true;}
    } else if(action==='endTurn'){done=true;}
    if(done) finishAction(room,p);
  });

  socket.on('chatMessage',({roomId,message}={})=>{
    const room=rooms[roomId],p=room?.players.find(x=>x.id===socket.id);if(!p)return;
    message=String(message||'').trim().slice(0,500);if(!message)return;
    io.to(roomId).emit('chatMessage',{sender:p.name,message,time:new Date().toLocaleTimeString('fa-IR')});
  });

  socket.on('rematchRequest',({roomId,targetId}={})=>{const me=onlinePlayers[socket.id],t=onlinePlayers[targetId];if(me&&t)io.to(targetId).emit('rematchRequest',{fromId:socket.id,fromName:me.name,roomId:roomId||null});});

  socket.on('leaveGame',({roomId}={})=>{
    const room=rooms[roomId];if(room){room.players=room.players.filter(p=>p.id!==socket.id);room.watchers=(room.watchers||[]).filter(x=>x!==socket.id);socket.leave(roomId);if(room.players.length===0)delete rooms[roomId];else{broadcast(roomId);io.to(roomId).emit('webrtc-peer-left',{peerId:socket.id});}}
    removeQueue(socket.id);if(onlinePlayers[socket.id])onlinePlayers[socket.id].status='ready';updatePlayerList();
  });

  // WebRTC signaling
  socket.on('webrtc-offer',({to,offer}={})=>{if(sameRoom(socket.id,to))io.to(to).emit('webrtc-offer',{from:socket.id,offer});});
  socket.on('webrtc-answer',({to,answer}={})=>{if(sameRoom(socket.id,to))io.to(to).emit('webrtc-answer',{from:socket.id,answer});});
  socket.on('webrtc-ice-candidate',({to,candidate}={})=>{if(sameRoom(socket.id,to))io.to(to).emit('webrtc-ice-candidate',{from:socket.id,candidate});});

  socket.on('disconnect',()=>{
    console.log('❌ قطع اتصال:',socket.id);
    removeQueue(socket.id);
    for(const targetId of Object.keys(pendingRequests)){
      const before=pendingRequests[targetId]||[];
      const after=before.filter(r=>r.fromId!==socket.id);
      if(after.length!==before.length){pendingRequests[targetId]=after;io.to(targetId).emit('gameRequestCancelled',{reason:'طرف مقابل قطع شد'});}
      if(!after.length)delete pendingRequests[targetId];
    }
    delete onlinePlayers[socket.id];
    for(const roomId of Object.keys(rooms)){
      const r=rooms[roomId];r.players=r.players.filter(p=>p.id!==socket.id);r.watchers=(r.watchers||[]).filter(x=>x!==socket.id);
      if(r.players.length===0)delete rooms[roomId];else{if(r.currentTurn===socket.id)r.currentTurn=r.players[0].id;broadcast(roomId);io.to(roomId).emit('webrtc-peer-left',{peerId:socket.id});}
    }
    updatePlayerList();
  });
});

app.get('/health',(req,res)=>res.json({ok:true,players:Object.keys(onlinePlayers).length,rooms:Object.keys(rooms).length}));
const PORT=process.env.PORT||3000;
server.listen(PORT,'0.0.0.0',()=>console.log(`🐔 سرور مرغ دونی روشن شد | http://localhost:${PORT}`));

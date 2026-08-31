const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'accounts.json');
let accounts = {};
try { if (fs.existsSync(file)) accounts = JSON.parse(fs.readFileSync(file,'utf8') || '{}'); } catch {}
function saveAccounts(){ try { fs.writeFileSync(file, JSON.stringify(accounts,null,2)); } catch {} }
function isValidAvatar(a){ return typeof a==='string' && a.length>0 && a.length<=2000000 && (!a.startsWith('data:') || /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(a)); }
function isValidUsername(n){ return typeof n==='string' && n.trim().length>=2 && n.trim().length<=20; }
function getAccount(id){ return id ? accounts[id] || null : null; }
function usernameTaken(n,ex){ const u=String(n||'').trim(); return Object.values(accounts).some(a=>a.username===u && a.accountId!==ex); }
function createOrUpdateAccount(id,{username,avatar}={}){ if(!accounts[id]) accounts[id]={accountId:id,username:username?username.trim():'بازیکن',avatar:avatar||'🐔',gamesPlayed:0,wins:0,losses:0,createdAt:Date.now()}; else { if(username) accounts[id].username=username.trim(); if(avatar) accounts[id].avatar=avatar; } saveAccounts(); return accounts[id]; }
function recordGameResult(id,win){ const a=accounts[id]; if(!a)return null; a.gamesPlayed=(a.gamesPlayed||0)+1; if(win)a.wins=(a.wins||0)+1; else a.losses=(a.losses||0)+1; saveAccounts(); return a; }
module.exports={getAccount,createOrUpdateAccount,usernameTaken,recordGameResult,isValidAvatar,isValidUsername};

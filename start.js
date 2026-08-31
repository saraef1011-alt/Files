const fs = require('fs');
const Module = require('module');
const path = require('path');

const originalPath = path.join(__dirname, 'server.js');
let source = fs.readFileSync(originalPath, 'utf8');
source = source.replace("if(room.players.length >= 3 && !room.players.some(p=>p.id===from.id)) return socket.emit('gameError','این بازی ۳ بازیکن دارد و جا ندارد.');", "if(!room.players.some(p=>p.id===from.id) && room.players.length >= 100) return socket.emit('gameError','ظرفیت بازی تکمیل شده است.');");

const marker = "app.use(express.static('.'));";
const injected = `
const __fs = require('fs');
app.get('/', (req, res) => {
  try {
    let html = __fs.readFileSync(__dirname + '/index.html', 'utf8');
    html = html.replace('</body>', '<script src="/fix.js?v=5"></script></body>');
    res.type('html').send(html);
  } catch (e) { res.status(500).send('index.html error'); }
});
`;
if (!source.includes('fix.js?v=5')) source = source.replace(marker, injected + marker);

const m = new Module(originalPath, module);
m.filename = originalPath;
m.paths = Module._nodeModulePaths(__dirname);
m._compile(source, originalPath);

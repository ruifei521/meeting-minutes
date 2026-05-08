const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/96BD6A740ED210E5BBBEC806D6D426B3');

ws.on('open', function open() {
  console.log('Connected, getting page content...');
  
  ws.send(JSON.stringify({
    id: 1,
    method: 'DOM.getDocument',
    params: {}
  }));
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  console.log('Message ID:', msg.id);
  if (msg.result && msg.result.root) {
    console.log('Got DOM root');
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 5000);
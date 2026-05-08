const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/56FE14B1F29D26DC1771F1C5390E88F3');

let msgId = 1;

ws.on('open', function open() {
  console.log('Connected to CDP');
  
  // Navigate to Upstash main console
  ws.send(JSON.stringify({
    id: msgId++,
    method: 'Page.navigate',
    params: { url: 'https://console.upstash.com' }
  }));
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  console.log('Received:', JSON.stringify(msg).substring(0, 200));
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 5000);
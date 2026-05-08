const WebSocket = require('ws');

const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/56FE14B1F29D26DC1771F1C5390E88F3');

let msgId = 1;

ws.on('open', function open() {
  console.log('Connected to CDP');
  
  // Navigate to Upstash
  ws.send(JSON.stringify({
    id: msgId++,
    method: 'Page.navigate',
    params: { url: 'https://console.upstash.com' }
  }));
  
  // Get cookies to verify login
  setTimeout(() => {
    ws.send(JSON.stringify({
      id: msgId++,
      method: 'Runtime.evaluate',
      params: { expression: 'document.title' }
    }));
  }, 3000);
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  if (msg.result && msg.result.result && msg.result.result.value) {
    console.log('Page title:', msg.result.result.value);
  }
  if (msg.method === 'Page.navigationScheduled') {
    console.log('Navigating to:', msg.params.url);
  }
});

ws.on('error', function error(err) {
  console.error('WS Error:', err.message);
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 8000);
const WebSocket = require('ws');

// Connect to the first page (Google sign-in)
const ws = new WebSocket('ws://127.0.0.1:9222/devtools/page/73D4FD89AEBD8C60C27D7B32E9EE1FA0');

ws.on('open', function open() {
  console.log('Connected, getting page title...');
  
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: 'document.title + " | URL: " + window.location.href' }
  }));
});

ws.on('message', function incoming(data) {
  const msg = JSON.parse(data);
  if (msg.result && msg.result.result && msg.result.result.value) {
    console.log('Result:', msg.result.result.value);
  }
});

setTimeout(() => {
  ws.close();
  process.exit(0);
}, 3000);